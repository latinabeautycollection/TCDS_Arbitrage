import type { AcquisitionDecisionHealthRepository } from '../repositories/acquisitionDecisionHealthRepository';

export type AcquisitionDecisionReadinessLevel = 'AUTO_BUY_READY' | 'REVIEW_READY' | 'BLOCKED' | 'EXPIRED';

export interface AcquisitionDecisionReadinessResult {
  ok: boolean;
  level: AcquisitionDecisionReadinessLevel;
  checkedAt: string;
  failures: string[];
  warnings: string[];
  stats: Record<string, number>;
}

/**
 * Domain 1 readiness check.
 * Distinguishes full auto-buy readiness from review-only readiness.
 */
export async function evaluateAcquisitionDecisionReadiness(input: {
  repository: AcquisitionDecisionHealthRepository;
  workerName: string;
  maxHeartbeatAgeSeconds: number;
  maxPendingOpportunities: number;
  maxDeadLettersLastHour: number;
}): Promise<AcquisitionDecisionReadinessResult> {
  const failures: string[] = [];
  const warnings: string[] = [];

  const dbOk = await input.repository.ping();
  if (!dbOk) failures.push('DATABASE_NOT_READY');

  const heartbeatAge = await input.repository.getLatestHeartbeatAgeSeconds(input.workerName);
  if (heartbeatAge === null) failures.push('ACQ_DECISION_WORKER_HEARTBEAT_MISSING');
  else if (heartbeatAge > input.maxHeartbeatAgeSeconds) failures.push('ACQ_DECISION_WORKER_HEARTBEAT_STALE');

  const pending = await input.repository.countPendingOpportunities();
  if (pending > input.maxPendingOpportunities) warnings.push('ACQ_PENDING_OPPORTUNITY_BACKLOG_HIGH');

  const deadLetters = await input.repository.countRecentDeadLetters();
  if (deadLetters > input.maxDeadLettersLastHour) failures.push('ACQ_DEAD_LETTERS_HIGH');
  else if (deadLetters > 0) warnings.push('ACQ_DEAD_LETTERS_PRESENT');

  const level = computeLevel({ failures, warnings, heartbeatAge });

  return {
    ok: level === 'AUTO_BUY_READY' || level === 'REVIEW_READY',
    level,
    checkedAt: new Date().toISOString(),
    failures,
    warnings,
    stats: {
      heartbeatAgeSeconds: heartbeatAge ?? -1,
      pendingOpportunities: pending,
      deadLettersLastHour: deadLetters,
    },
  };
}

function computeLevel(input: { failures: string[]; warnings: string[]; heartbeatAge: number | null }): AcquisitionDecisionReadinessLevel {
  if (input.failures.includes('DATABASE_NOT_READY')) return 'BLOCKED';
  if (input.failures.includes('ACQ_DECISION_WORKER_HEARTBEAT_MISSING')) return 'EXPIRED';
  if (input.failures.length > 0) return 'BLOCKED';
  if (input.warnings.length > 0) return 'REVIEW_READY';
  return 'AUTO_BUY_READY';
}
