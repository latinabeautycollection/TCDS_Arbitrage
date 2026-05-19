import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { CategoryRecoveryService } from '../services/categoryRecoveryService';

export class CategoryRecoveryWorker {
  public constructor(private readonly pool: Pool) {}

  public async execute(): Promise<void> {
    const actorId = `category-recovery-${randomUUID()}`;
    const service = new CategoryRecoveryService(this.pool);
    const summary = await service.run(actorId);

    process.stdout.write(`${JSON.stringify({
      level: 'info',
      msg: 'category recovery completed',
      processRunId: summary.processRunId,
      mode: summary.mode,
      rowsSeen: summary.rowsSeen,
      rowsStaged: summary.rowsStaged,
      rowsUpdated: summary.rowsUpdated,
      rowsRequeued: summary.rowsRequeued,
      rowsRolledBack: summary.rowsRolledBack,
      requeueTargets: summary.requeueTargets,
      conditionGates: summary.conditionGates,
      artifactDir: summary.artifactDir,
      ts: new Date().toISOString(),
    })}\n`);
  }
}
