import { PoolClient } from 'pg';

export type ProcessRunStatus =
  | 'STARTED'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'PARTIAL'
  | 'CANCELLED';

export type ActorType =
  | 'user'
  | 'worker'
  | 'system'
  | 'api'
  | 'service_account';

export interface CreateProcessRunInput {
  processName: string;
  processStage?: string | null;
  parentRunId?: string | null;
  correlationId?: string | null;
  actorType: ActorType;
  actorId?: string | null;
  actorName?: string | null;
  workerName?: string | null;
  workerInstanceId?: string | null;
  hostName?: string | null;
  attemptNo?: number;
  codeVersion?: string | null;
  rulesetVersion?: string | null;
  modelVersion?: string | null;
  entityType?: string | null;
  entityCount?: number;
  rowsSeen?: number;
  rowsSucceeded?: number;
  rowsFailed?: number;
  detailsJson?: Record<string, unknown>;
  idempotencyKey?: string | null;
}

export interface TransitionRunInput {
  runId: string;
  status: ProcessRunStatus;
  processStage?: string | null;
  errorClass?: string | null;
  errorSummary?: string | null;
  detailsJson?: Record<string, unknown>;
}

export class ProcessRunRepository {
  constructor(private readonly client: PoolClient) {}

  async createOrGetIdempotent(input: CreateProcessRunInput) {
    const sql = `
      insert into arb.process_runs (
        process_name,
        process_stage,
        status,
        parent_run_id,
        correlation_id,
        actor_type,
        actor_id,
        actor_name,
        worker_name,
        worker_instance_id,
        host_name,
        attempt_no,
        code_version,
        ruleset_version,
        model_version,
        entity_type,
        entity_count,
        rows_seen,
        rows_succeeded,
        rows_failed,
        details_json,
        idempotency_key,
        started_at
      )
      values (
        $1,$2,'STARTED',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20::jsonb,$21,now()
      )
      on conflict (process_name, idempotency_key)
      where idempotency_key is not null
      do update set
        updated_at = now()
      returning *
    `;

    const values = [
      input.processName,
      input.processStage ?? null,
      input.parentRunId ?? null,
      input.correlationId ?? null,
      input.actorType,
      input.actorId ?? null,
      input.actorName ?? null,
      input.workerName ?? null,
      input.workerInstanceId ?? null,
      input.hostName ?? null,
      input.attemptNo ?? 1,
      input.codeVersion ?? null,
      input.rulesetVersion ?? null,
      input.modelVersion ?? null,
      input.entityType ?? null,
      input.entityCount ?? 0,
      input.rowsSeen ?? 0,
      input.rowsSucceeded ?? 0,
      input.rowsFailed ?? 0,
      JSON.stringify(input.detailsJson ?? {}),
      input.idempotencyKey ?? null
    ];

    const { rows } = await this.client.query(sql, values);
    return rows[0];
  }

  async getByRunId(runId: string) {
    const { rows } = await this.client.query(
      `select * from arb.process_runs where run_id = $1`,
      [runId]
    );
    return rows[0] ?? null;
  }

  async findRecentByProcess(processName: string, limit = 50) {
    const { rows } = await this.client.query(
      `
      select *
      from arb.process_runs
      where process_name = $1
      order by created_at desc
      limit $2
      `,
      [processName, limit]
    );
    return rows;
  }

  async updateStage(
    runId: string,
    processStage: string,
    detailsJson?: Record<string, unknown>
  ) {
    const { rows } = await this.client.query(
      `
      update arb.process_runs
      set
        process_stage = $2,
        details_json = coalesce(details_json, '{}'::jsonb) || $3::jsonb,
        updated_at = now()
      where run_id = $1
      returning *
      `,
      [runId, processStage, JSON.stringify(detailsJson ?? {})]
    );
    return rows[0];
  }

  async incrementCounters(
    runId: string,
    delta: {
      rowsSeen?: number;
      rowsSucceeded?: number;
      rowsFailed?: number;
      entityCount?: number;
    }
  ) {
    const { rows } = await this.client.query(
      `
      update arb.process_runs
      set
        rows_seen = rows_seen + $2,
        rows_succeeded = rows_succeeded + $3,
        rows_failed = rows_failed + $4,
        entity_count = entity_count + $5,
        updated_at = now()
      where run_id = $1
      returning *
      `,
      [
        runId,
        delta.rowsSeen ?? 0,
        delta.rowsSucceeded ?? 0,
        delta.rowsFailed ?? 0,
        delta.entityCount ?? 0
      ]
    );
    return rows[0];
  }

  async transition(input: TransitionRunInput) {
    const shouldFail = input.status === 'FAILED';

    const { rows } = await this.client.query(
      `
      update arb.process_runs
      set
        status = $2,
        process_stage = coalesce($3, process_stage),
        error_class = case when $2 = 'FAILED' then $4 else error_class end,
        error_summary = case when $2 = 'FAILED' then $5 else error_summary end,
        completed_at = case
          when $2 in ('SUCCEEDED','PARTIAL','CANCELLED') then now()
          else completed_at
        end,
        failed_at = case
          when $2 = 'FAILED' then now()
          else failed_at
        end,
        details_json = coalesce(details_json, '{}'::jsonb) || $6::jsonb,
        updated_at = now()
      where run_id = $1
      returning *
      `,
      [
        input.runId,
        input.status,
        input.processStage ?? null,
        shouldFail ? input.errorClass ?? null : null,
        shouldFail ? input.errorSummary ?? null : null,
        JSON.stringify(input.detailsJson ?? {})
      ]
    );

    return rows[0];
  }

  async markSucceeded(runId: string, detailsJson?: Record<string, unknown>) {
    return this.transition({ runId, status: 'SUCCEEDED', detailsJson });
  }

  async markPartial(runId: string, detailsJson?: Record<string, unknown>) {
    return this.transition({ runId, status: 'PARTIAL', detailsJson });
  }

  async markCancelled(runId: string, detailsJson?: Record<string, unknown>) {
    return this.transition({ runId, status: 'CANCELLED', detailsJson });
  }

  async markFailed(
    runId: string,
    errorClass: string,
    errorSummary: string,
    detailsJson?: Record<string, unknown>
  ) {
    return this.transition({
      runId,
      status: 'FAILED',
      errorClass,
      errorSummary,
      detailsJson
    });
  }

  async updateCounts(input: {
    runId: string;
    rowsSeen?: number;
    rowsSucceeded?: number;
    rowsFailed?: number;
    entityCount?: number;
    detailsJson?: Record<string, unknown>;
  }) {
    const { rows } = await this.client.query(
      `update arb.process_runs set rows_seen = rows_seen + $2, rows_succeeded = rows_succeeded + $3, rows_failed = rows_failed + $4, entity_count = entity_count + $5, details_json = coalesce(details_json, '{}'::jsonb) || $6::jsonb, updated_at = now() where run_id = $1 returning *`,
      [input.runId, input.rowsSeen ?? 0, input.rowsSucceeded ?? 0, input.rowsFailed ?? 0, input.entityCount ?? 0, JSON.stringify(input.detailsJson ?? {})]
    );
    return rows[0];
  }

  async markCertification(
    runId: string,
    certificationStatus: string,
    certificationReportJson: Record<string, unknown>
  ) {
    const { rows } = await this.client.query(
      `
      update arb.process_runs
      set
        certification_status = $2,
        certification_report_json = $3::jsonb,
        updated_at = now()
      where run_id = $1
      returning *
      `,
      [runId, certificationStatus, JSON.stringify(certificationReportJson)]
    );
    return rows[0];
  }
}
