import type { Pool } from 'pg';
import { R2StorageOptimizationRepository } from '../repositories/r2StorageOptimizationRepository';
import { R2LifecycleDecisionService } from '../services/r2LifecycleDecisionService';
import { getR2OptimizationConfig } from '../config/r2OptimizationConfig';

export class R2RetentionOptimizerWorker {
  private readonly repo: R2StorageOptimizationRepository;
  private readonly decisionService = new R2LifecycleDecisionService();

  constructor(private readonly pool: Pool, private readonly deleteObject?: (bucket: string, key: string) => Promise<void>, private readonly moveToIa?: (bucket: string, key: string) => Promise<void>) {
    this.repo = new R2StorageOptimizationRepository(pool);
  }

  async runOnce(processRunId?: string): Promise<{ seen: number; movedToIa: number; deleted: number; held: number; kept: number }> {
    const cfg = getR2OptimizationConfig();
    const candidates = await this.repo.claimRetentionCandidates(cfg.R2_RETENTION_BATCH_SIZE);
    const stats = { seen: candidates.length, movedToIa: 0, deleted: 0, held: 0, kept: 0 };
    for (const c of candidates) {
      const d = this.decisionService.decide(c);
      await this.repo.recordLifecycleDecision({ registryId: c.id, decision: d.decision, reasonCodes: d.reasonCodes, processRunId, decisionJson: d as unknown as Record<string, unknown>, estimatedMonthlySavingsUsd: d.estimatedMonthlySavingsUsd });
      if (d.decision === 'FORENSIC_HOLD') {
        await this.repo.markLifecycleStatus(c.id, 'hold', { isForensicHold: true, forensicHoldReason: d.forensicHoldReason, retentionUntil: d.retentionUntil?.toISOString() });
        stats.held++;
      } else if (d.decision === 'MOVE_TO_IA') {
        if (this.moveToIa) await this.moveToIa(c.bucket_name, c.object_key);
        await this.repo.markLifecycleStatus(c.id, 'ia_confirmed', { storageClass: 'InfrequentAccess' });
        stats.movedToIa++;
      } else if (d.decision === 'DELETE') {
        if (this.deleteObject) await this.deleteObject(c.bucket_name, c.object_key);
        await this.repo.markLifecycleStatus(c.id, 'deleted');
        stats.deleted++;
      } else {
        await this.repo.markLifecycleStatus(c.id, (c as any).lifecycle_status ?? 'active');
        stats.kept++;
      }
    }
    return stats;
  }
}
