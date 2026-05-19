import { PoolClient } from 'pg';
import { buildHashChain } from '../lib/crypto';

export type ForensicActorType =
  | 'user'
  | 'worker'
  | 'system'
  | 'api'
  | 'service_account';

export interface CreateForensicEventInput {
  processRunId: string;
  processStepId?: number | null;
  correlationId?: string | null;
  causationId?: string | null;

  entityType: string;
  entityPk: string;

  eventType: string;
  actionType: string;

  actorType?: ForensicActorType | null;
  actorId?: string | null;
  actorName?: string | null;

  workerName?: string | null;
  workerInstanceId?: string | null;

  sourceTable?: string | null;
  sourcePk?: string | null;

  queueName?: string | null;
  jobId?: string | null;
  idempotencyKey?: string | null;

  beforeJson?: Record<string, unknown> | null;
  afterJson?: Record<string, unknown> | null;
  evidenceJson?: Record<string, unknown>;
  metricsJson?: Record<string, unknown>;
  flagsJson?: unknown[];
}

export class ForensicEventRepository {
  constructor(private readonly client: PoolClient) {}

  async getLastHash(processRunId: string): Promise<string | null> {
    const { rows } = await this.client.query(
      `
      select event_hash
      from arb.forensic_events
      where process_run_id = $1
      order by id desc
      limit 1
      `,
      [processRunId]
    );

    return rows[0]?.event_hash ?? null;
  }

  async getByRunId(processRunId: string) {
    const { rows } = await this.client.query(
      `
      select *
      from arb.forensic_events
      where process_run_id = $1
      order by id asc
      `,
      [processRunId]
    );

    return rows;
  }

  async getByEntity(entityType: string, entityPk: string) {
    const { rows } = await this.client.query(
      `
      select *
      from arb.forensic_events
      where entity_type = $1
        and entity_pk = $2
      order by id asc
      `,
      [entityType, entityPk]
    );

    return rows;
  }

  async create(input: CreateForensicEventInput) {
    const prevHash = await this.getLastHash(input.processRunId);
    const eventAt = new Date().toISOString();

    const beforeJson = input.beforeJson ?? {};
    const afterJson = input.afterJson ?? {};

    const diffRes = await this.client.query(
      `
      select arb.jsonb_diff_val($1::jsonb, $2::jsonb) as diff
      `,
      [JSON.stringify(beforeJson), JSON.stringify(afterJson)]
    );

    const diffJson = diffRes.rows[0]?.diff ?? {};

    const payloadForHash = {
      processRunId: input.processRunId,
      processStepId: input.processStepId ?? null,
      correlationId: input.correlationId ?? null,
      causationId: input.causationId ?? null,
      entityType: input.entityType,
      entityPk: input.entityPk,
      eventType: input.eventType,
      actionType: input.actionType,
      actorType: input.actorType ?? null,
      actorId: input.actorId ?? null,
      actorName: input.actorName ?? null,
      workerName: input.workerName ?? null,
      workerInstanceId: input.workerInstanceId ?? null,
      sourceTable: input.sourceTable ?? null,
      sourcePk: input.sourcePk ?? null,
      queueName: input.queueName ?? null,
      jobId: input.jobId ?? null,
      idempotencyKey: input.idempotencyKey ?? null,
      beforeJson,
      afterJson,
      diffJson,
      evidenceJson: input.evidenceJson ?? {},
      metricsJson: input.metricsJson ?? {},
      flagsJson: input.flagsJson ?? []
    };

    const eventHash = buildHashChain(prevHash, payloadForHash, eventAt);

    const { rows } = await this.client.query(
      `
      insert into arb.forensic_events (
        process_run_id,
        process_step_id,
        correlation_id,
        causation_id,
        entity_type,
        entity_pk,
        event_type,
        action_type,
        actor_type,
        actor_id,
        actor_name,
        worker_name,
        worker_instance_id,
        source_table,
        source_pk,
        queue_name,
        job_id,
        idempotency_key,
        before_json,
        after_json,
        diff_json,
        evidence_json,
        metrics_json,
        flags_json,
        prev_hash,
        event_hash,
        event_at
      )
      values (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,
        $14,$15,$16,$17,$18,
        $19::jsonb,$20::jsonb,$21::jsonb,$22::jsonb,$23::jsonb,$24::jsonb,
        $25,$26,$27
      )
      returning *
      `,
      [
        input.processRunId,
        input.processStepId ?? null,
        input.correlationId ?? null,
        input.causationId ?? null,
        input.entityType,
        input.entityPk,
        input.eventType,
        input.actionType,
        input.actorType ?? null,
        input.actorId ?? null,
        input.actorName ?? null,
        input.workerName ?? null,
        input.workerInstanceId ?? null,
        input.sourceTable ?? null,
        input.sourcePk ?? null,
        input.queueName ?? null,
        input.jobId ?? null,
        input.idempotencyKey ?? null,
        JSON.stringify(beforeJson),
        JSON.stringify(afterJson),
        JSON.stringify(diffJson),
        JSON.stringify(input.evidenceJson ?? {}),
        JSON.stringify(input.metricsJson ?? {}),
        JSON.stringify(input.flagsJson ?? []),
        prevHash,
        eventHash,
        eventAt
      ]
    );

    return rows[0];
  }

  async append(input: CreateForensicEventInput) {
    return this.create(input);
  }

  async validateHashChain(processRunId: string): Promise<{
    ok: boolean;
    mismatches: number;
  }> {
    const { rows } = await this.client.query(
      `
      with ordered as (
        select
          id,
          process_run_id,
          prev_hash,
          lag(event_hash) over (partition by process_run_id order by id) as expected_prev_hash
        from arb.forensic_events
        where process_run_id = $1
      )
      select count(*)::int as mismatch_count
      from ordered
      where expected_prev_hash is not null
        and coalesce(prev_hash, '') <> coalesce(expected_prev_hash, '')
      `,
      [processRunId]
    );

    const mismatches = rows[0]?.mismatch_count ?? 0;

    return {
      ok: mismatches === 0,
      mismatches
    };
  }
}
