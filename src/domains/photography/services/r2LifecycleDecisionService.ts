import type { RetentionCandidate } from '../repositories/r2StorageOptimizationRepository';
import { getR2OptimizationConfig } from '../config/r2OptimizationConfig';

export type R2LifecycleDecision = 'KEEP_STANDARD' | 'MOVE_TO_IA' | 'DELETE' | 'FORENSIC_HOLD' | 'SKIP' | 'ERROR';

export interface LifecycleDecisionResult {
  decision: R2LifecycleDecision;
  reasonCodes: string[];
  targetStorageClass?: 'Standard' | 'InfrequentAccess';
  retentionUntil?: Date;
  isForensicHold?: boolean;
  forensicHoldReason?: string;
  estimatedMonthlySavingsUsd?: number;
}

function ageDays(createdAt: string): number {
  return Math.floor((Date.now() - new Date(createdAt).getTime()) / 86400000);
}

function monthlyCost(bytes: number, klass: 'Standard' | 'InfrequentAccess'): number {
  const cfg = getR2OptimizationConfig();
  const gb = bytes / 1024 / 1024 / 1024;
  return gb * (klass === 'InfrequentAccess' ? cfg.R2_STORAGE_IA_GB_MONTH_USD : cfg.R2_STORAGE_STANDARD_GB_MONTH_USD);
}

export class R2LifecycleDecisionService {
  decide(candidate: RetentionCandidate): LifecycleDecisionResult {
    const cfg = getR2OptimizationConfig();
    const age = ageDays(candidate.created_at);
    const role = candidate.object_role;
    const value = Number(candidate.estimated_value_usd ?? 0);
    const reasons: string[] = [];

    if (candidate.is_forensic_hold) {
      return { decision: 'FORENSIC_HOLD', reasonCodes: ['EXISTING_FORENSIC_HOLD'], isForensicHold: true };
    }

    if (candidate.dispute_count > 0 || candidate.return_count > 0) {
      return {
        decision: 'FORENSIC_HOLD',
        reasonCodes: ['RETURN_OR_DISPUTE_ACTIVITY'],
        isForensicHold: true,
        forensicHoldReason: 'Return/dispute activity detected; retain photo evidence.',
        retentionUntil: new Date(Date.now() + cfg.R2_EVIDENCE_HOLD_DAYS * 86400000),
      };
    }

    if (value >= cfg.R2_HIGH_VALUE_USD && ['original', 'evidence', 'processed'].includes(role)) {
      return {
        decision: 'FORENSIC_HOLD',
        reasonCodes: ['HIGH_VALUE_ITEM'],
        isForensicHold: true,
        forensicHoldReason: `Estimated item value ${value} exceeds high-value threshold.`,
        retentionUntil: new Date(Date.now() + cfg.R2_HIGH_VALUE_EVIDENCE_HOLD_DAYS * 86400000),
      };
    }

    if (role === 'temp' && age >= cfg.R2_TEMP_RETENTION_DAYS) return { decision: 'DELETE', reasonCodes: ['TEMP_EXPIRED'] };
    if (role === 'deadletter' && age >= cfg.R2_DEADLETTER_RETENTION_DAYS) return { decision: 'DELETE', reasonCodes: ['DEADLETTER_EXPIRED'] };
    if (role === 'review' && age >= cfg.R2_REVIEW_RETENTION_DAYS) return { decision: 'DELETE', reasonCodes: ['REVIEW_EXPIRED'] };

    if (['original', 'processed', 'evidence'].includes(role) && candidate.storage_class === 'Standard') {
      const threshold = role === 'processed' ? cfg.R2_PROCESSED_ACTIVE_DAYS : cfg.R2_ORIGINAL_ACTIVE_DAYS;
      if (age >= threshold) {
        reasons.push(`${role.toUpperCase()}_OLD_ENOUGH_FOR_IA`);
        return {
          decision: 'MOVE_TO_IA',
          reasonCodes: reasons,
          targetStorageClass: 'InfrequentAccess',
          estimatedMonthlySavingsUsd: Math.max(0, monthlyCost(candidate.size_bytes, 'Standard') - monthlyCost(candidate.size_bytes, 'InfrequentAccess')),
        };
      }
    }

    if (role === 'processed' && age >= 730 && ['ENDED', 'SOLD', null, undefined].includes(candidate.listing_status as any) && candidate.order_status !== 'RETURNED') {
      return { decision: 'DELETE', reasonCodes: ['PROCESSED_EXPIRED_AFTER_CLOSED_LISTING'] };
    }

    return { decision: 'KEEP_STANDARD', reasonCodes: ['ACTIVE_OR_NOT_ELIGIBLE'] };
  }
}
