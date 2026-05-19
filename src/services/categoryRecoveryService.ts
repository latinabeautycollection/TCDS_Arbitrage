import fs from 'node:fs/promises';
import path from 'node:path';
import type { Pool, PoolClient } from 'pg';
import { categoryRecoveryConfig, type CategoryRecoveryConfig } from '../config/categoryRecoveryConfig';
import { CategoryRecoveryRepository, type RecoveryAuditRow } from '../repositories/categoryRecoveryRepository';

export interface RecoveryRunSummary {
  processRunId: string;
  mode: 'preview' | 'apply' | 'rollback';
  rowsSeen: number;
  rowsStaged: number;
  rowsUpdated: number;
  rowsRequeued: number;
  rowsRolledBack: number;
  rowsSkipped: number;
  rowsFailed: number;
  artifactDir: string;
  requeueTargets: Record<string, number>;
  conditionGates: Record<string, number>;
}

export class CategoryRecoveryService {
  private readonly repo = new CategoryRecoveryRepository();

  public constructor(
    private readonly pool: Pool,
    private readonly config: CategoryRecoveryConfig = categoryRecoveryConfig,
  ) {}

  public async run(actorId: string): Promise<RecoveryRunSummary> {
    const client = await this.pool.connect();
    try {
      return await this.runWithClient(client, actorId);
    } finally {
      client.release();
    }
  }

  private async runWithClient(client: PoolClient, actorId: string): Promise<RecoveryRunSummary> {
    const processRunId = await this.repo.createProcessRun(client, this.config.processName, this.config.workerName, actorId, {
      mode: this.config.mode,
      batchSize: this.config.batchSize,
      limit: this.config.limit,
      minRecoveryConfidence: this.config.minRecoveryConfidence,
      decisions: this.config.onlyDecisions,
      allowManualReviewRequeue: this.config.allowManualReviewRequeue,
    });

    await this.repo.initRecoveryRun(client, processRunId, this.config.mode, this.config.batchSize, this.config.limit, {
      decisions: this.config.onlyDecisions,
      minRecoveryConfidence: this.config.minRecoveryConfidence,
      allowManualReviewRequeue: this.config.allowManualReviewRequeue,
    });

    const summary: RecoveryRunSummary = {
      processRunId,
      mode: this.config.mode,
      rowsSeen: 0,
      rowsStaged: 0,
      rowsUpdated: 0,
      rowsRequeued: 0,
      rowsRolledBack: 0,
      rowsSkipped: 0,
      rowsFailed: 0,
      artifactDir: path.join(this.config.artifactDir, processRunId),
      requeueTargets: {},
      conditionGates: {},
    };

    try {
      await fs.mkdir(summary.artifactDir, { recursive: true });

      if (this.config.mode === 'rollback') {
        await this.repo.createStep(client, processRunId, 'rollback', 'category-recovery', { mode: 'rollback' });
        const rollback = await this.repo.rollbackRecovery(client, processRunId, actorId, this.config.workerName);
        summary.rowsRolledBack = Number(rollback.rolled_back_items ?? 0);
        await this.repo.finishStep(client, processRunId, 'rollback', 'SUCCEEDED', rollback as unknown as Record<string, unknown>);
      } else {
        await this.repo.createStep(client, processRunId, 'stage_candidates', 'category-recovery', {
          limit: this.config.limit,
          minRecoveryConfidence: this.config.minRecoveryConfidence,
        });
        const staged = await this.repo.stageCandidates(client, processRunId, this.config.limit, this.config.minRecoveryConfidence);
        summary.rowsStaged = staged;
        summary.rowsSeen = staged;
        await this.repo.finishStep(client, processRunId, 'stage_candidates', 'SUCCEEDED', { staged });

        const auditRows = await this.repo.fetchRecoveryAuditRows(client, processRunId);
        this.summarizeAuditRows(summary, auditRows);
        await this.writeArtifacts(summary.artifactDir, processRunId, auditRows, { staged });

        if (this.config.mode === 'apply' && staged > 0) {
          await this.repo.createStep(client, processRunId, 'apply_recovery', 'category-recovery', { staged });
          const applied = await this.repo.applyRecovery(client, processRunId, actorId, this.config.workerName);
          summary.rowsUpdated = Number(applied.updated_items ?? 0);
          summary.rowsRequeued = Number(applied.requeued_listings ?? 0);
          await this.repo.finishStep(client, processRunId, 'apply_recovery', 'SUCCEEDED', applied as unknown as Record<string, unknown>);
        }
      }

      await this.repo.updateRecoveryRunSummary(client, processRunId, {
        rows_seen: summary.rowsSeen,
        rows_staged: summary.rowsStaged,
        rows_updated: summary.rowsUpdated,
        rows_requeued: summary.rowsRequeued,
        rows_skipped: summary.rowsSkipped,
        rows_failed: summary.rowsFailed,
      });

      await this.repo.markProcessRunCompleted(client, processRunId, 'SUCCEEDED', summary as unknown as Record<string, unknown>);
      await this.writeSummary(summary);
      return summary;
    } catch (error) {
      summary.rowsFailed += 1;
      await this.repo.markProcessRunCompleted(client, processRunId, 'FAILED', {
        ...summary,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  private summarizeAuditRows(summary: RecoveryRunSummary, rows: RecoveryAuditRow[]): void {
    for (const row of rows) {
      const target = row.requeue_target ?? 'unknown';
      summary.requeueTargets[target] = (summary.requeueTargets[target] ?? 0) + 1;
      const gate = row.condition_gate ?? 'unknown';
      summary.conditionGates[gate] = (summary.conditionGates[gate] ?? 0) + 1;
    }
  }

  private async writeArtifacts(artifactDir: string, processRunId: string, rows: RecoveryAuditRow[], meta: Record<string, unknown>): Promise<void> {
    await fs.mkdir(artifactDir, { recursive: true });

    const rollback = rows.map((row) => ({
      id: row.id,
      listing_id: row.listing_id,
      candidate_id: row.candidate_id,
      rollback_payload: row.rollback_payload,
    }));

    const csvHeader = [
      'id','listing_id','candidate_id','listing_external_id','condition_gate','condition_reason','condition_score',
      'propertyroom_category_key_before','propertyroom_category_key_after',
      'candidate_source_category_key_before','candidate_source_category_key_after',
      'normalized_category_before','normalized_category_after',
      'category_recovery_strategy','category_recovery_reason','recovery_confidence','requeue_target','status',
    ];

    const csvLines = [
      csvHeader.join(','),
      ...rows.map((row) => [
        row.id,
        row.listing_id,
        row.candidate_id ?? '',
        JSON.stringify(row.listing_external_id ?? ''),
        JSON.stringify(row.condition_gate ?? ''),
        JSON.stringify(row.condition_reason ?? ''),
        JSON.stringify(row.condition_score ?? ''),
        JSON.stringify(row.propertyroom_category_key_before ?? ''),
        JSON.stringify(row.propertyroom_category_key_after ?? ''),
        JSON.stringify(row.candidate_source_category_key_before ?? ''),
        JSON.stringify(row.candidate_source_category_key_after ?? ''),
        JSON.stringify(row.normalized_category_before ?? ''),
        JSON.stringify(row.normalized_category_after ?? ''),
        JSON.stringify(row.category_recovery_strategy),
        JSON.stringify(row.category_recovery_reason),
        row.recovery_confidence,
        JSON.stringify(row.requeue_target),
        JSON.stringify(row.status),
      ].join(',')),
    ];

    await fs.writeFile(path.join(artifactDir, 'rollback.json'), JSON.stringify({ processRunId, rollback }, null, 2), 'utf8');
    await fs.writeFile(path.join(artifactDir, 'changed_rows.csv'), csvLines.join('\n'), 'utf8');
    await fs.writeFile(path.join(artifactDir, 'staged_rows.json'), JSON.stringify({ processRunId, meta, rows }, null, 2), 'utf8');
  }

  private async writeSummary(summary: RecoveryRunSummary): Promise<void> {
    await fs.mkdir(summary.artifactDir, { recursive: true });
    await fs.writeFile(path.join(summary.artifactDir, 'summary.json'), JSON.stringify(summary, null, 2), 'utf8');
  }
}
