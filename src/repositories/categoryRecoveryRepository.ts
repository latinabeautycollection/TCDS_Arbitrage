import type { PoolClient } from 'pg';

export interface ProcessRunRow { run_id: string; }
export interface StageResult { staged_count: number; }
export interface ApplyResult { updated_items: number; requeued_listings: number; }
export interface RollbackResult { rolled_back_items: number; }

export interface RecoveryAuditRow {
  id: number;
  listing_id: string;
  candidate_id: number | null;
  listing_external_id: string | null;
  condition_gate: string | null;
  condition_reason: string | null;
  condition_score: string | null;
  propertyroom_category_key_before: string | null;
  propertyroom_category_key_after: string | null;
  candidate_source_category_key_before: string | null;
  candidate_source_category_key_after: string | null;
  normalized_category_before: string | null;
  normalized_category_after: string | null;
  category_recovery_strategy: string;
  category_recovery_reason: string;
  recovery_confidence: string;
  requeue_target: string;
  status: string;
  rollback_payload: Record<string, unknown>;
  evidence_json: Record<string, unknown>;
}

export class CategoryRecoveryRepository {
  public async createProcessRun(client: PoolClient, processName: string, workerName: string, actorId: string, detailsJson: Record<string, unknown>): Promise<string> {
    const result = await client.query<ProcessRunRow>(`
      INSERT INTO arb.process_runs (
        process_name, process_stage, status, actor_type, actor_id, actor_name,
        worker_name, worker_instance_id, details_json, started_at, created_at, updated_at
      )
      VALUES ($1, 'started', 'STARTED', 'worker', $2, $3, $4, $5, $6::jsonb, now(), now(), now())
      RETURNING run_id
    `, [processName, actorId, actorId, workerName, actorId, JSON.stringify(detailsJson)]);
    return result.rows[0]!.run_id;
  }

  public async markProcessRunCompleted(client: PoolClient, runId: string, status: 'SUCCEEDED' | 'FAILED' | 'PARTIAL', counts: Record<string, unknown>): Promise<void> {
    await client.query(`
      UPDATE arb.process_runs
      SET status = $2, completed_at = now(), updated_at = now(),
          details_json = COALESCE(details_json, '{}'::jsonb) || $3::jsonb
      WHERE run_id = $1
    `, [runId, status, JSON.stringify(counts)]);
  }

  public async createStep(client: PoolClient, runId: string, stepName: string, queueName: string, payload: Record<string, unknown>): Promise<void> {
    await client.query(`
      INSERT INTO arb.process_steps (
        process_run_id, step_name, queue_name, status, payload_json, started_at, created_at, updated_at
      ) VALUES ($1, $2, $3, 'RUNNING', $4::jsonb, now(), now(), now())
    `, [runId, stepName, queueName, JSON.stringify(payload)]);
  }

  public async finishStep(client: PoolClient, runId: string, stepName: string, status: 'SUCCEEDED' | 'FAILED', resultJson: Record<string, unknown>): Promise<void> {
    await client.query(`
      UPDATE arb.process_steps
      SET status = $3, completed_at = now(), updated_at = now(), result_json = $4::jsonb
      WHERE process_run_id = $1 AND step_name = $2 AND status = 'RUNNING'
    `, [runId, stepName, status, JSON.stringify(resultJson)]);
  }

  public async initRecoveryRun(client: PoolClient, runId: string, mode: string, batchSize: number, limit: number, filtersJson: Record<string, unknown>): Promise<void> {
    await client.query(`
      INSERT INTO arb.category_recovery_run (process_run_id, mode, batch_size, candidate_limit, filters_json)
      VALUES ($1, $2, $3, $4, $5::jsonb)
    `, [runId, mode, batchSize, limit, JSON.stringify(filtersJson)]);
  }

  public async stageCandidates(client: PoolClient, runId: string, limit: number, minRecoveryConfidence: number): Promise<number> {
    const result = await client.query<StageResult>(
      `SELECT staged_count FROM arb.stage_category_recovery_candidates($1, $2, $3, ARRAY['WATCH','REJECT'])`,
      [runId, limit, minRecoveryConfidence],
    );
    return Number(result.rows[0]?.staged_count ?? 0);
  }

  public async applyRecovery(client: PoolClient, runId: string, actorId: string, workerName: string): Promise<ApplyResult> {
    const result = await client.query<ApplyResult>(
      `SELECT updated_items, requeued_listings FROM arb.apply_category_recovery($1, 'worker', $2, $2, $3, $2)`,
      [runId, actorId, workerName],
    );
    return result.rows[0] ?? { updated_items: 0, requeued_listings: 0 };
  }

  public async rollbackRecovery(client: PoolClient, runId: string, actorId: string, workerName: string): Promise<RollbackResult> {
    const result = await client.query<RollbackResult>(
      `SELECT rolled_back_items FROM arb.rollback_category_recovery($1, 'worker', $2, $2, $3, $2)`,
      [runId, actorId, workerName],
    );
    return result.rows[0] ?? { rolled_back_items: 0 };
  }

  public async fetchRecoveryAuditRows(client: PoolClient, runId: string): Promise<RecoveryAuditRow[]> {
    const result = await client.query<RecoveryAuditRow>(`
      SELECT id, listing_id, candidate_id, listing_external_id, condition_gate, condition_reason, condition_score,
             propertyroom_category_key_before, propertyroom_category_key_after,
             candidate_source_category_key_before, candidate_source_category_key_after,
             normalized_category_before, normalized_category_after,
             category_recovery_strategy, category_recovery_reason, recovery_confidence,
             requeue_target, status, rollback_payload, evidence_json
      FROM arb.category_recovery_run_item
      WHERE process_run_id = $1
      ORDER BY id ASC
    `, [runId]);
    return result.rows;
  }

  public async updateRecoveryRunSummary(client: PoolClient, runId: string, summary: Record<string, unknown>): Promise<void> {
    await client.query(`
      UPDATE arb.category_recovery_run
      SET completed_at = now(),
          rows_seen = COALESCE(($2::jsonb ->> 'rows_seen')::integer, rows_seen),
          rows_staged = COALESCE(($2::jsonb ->> 'rows_staged')::integer, rows_staged),
          rows_updated = COALESCE(($2::jsonb ->> 'rows_updated')::integer, rows_updated),
          rows_requeued = COALESCE(($2::jsonb ->> 'rows_requeued')::integer, rows_requeued),
          rows_skipped = COALESCE(($2::jsonb ->> 'rows_skipped')::integer, rows_skipped),
          rows_failed = COALESCE(($2::jsonb ->> 'rows_failed')::integer, rows_failed)
      WHERE process_run_id = $1
    `, [runId, JSON.stringify(summary)]);
  }
}
