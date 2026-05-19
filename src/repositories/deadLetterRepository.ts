import { PoolClient } from 'pg';

export interface InsertDeadLetterInput {
  queueName: string;
  jobId?: string | null;
  workerName?: string | null;

  processRunId?: string | number | null;
  processStepId?: number | null;
  entityType?: string | null;
  entityPk?: string | null;
  workerInstanceId?: string | null;
  errorCode?: string | null;

  errorMessage: string;
  stackTrace?: string | null;
  retryCount?: number;

  payload?: unknown;
  payloadJson?: Record<string, unknown> | null;
}

export class DeadLetterRepository {
  constructor(private readonly client: PoolClient) {}

  async insert(input: InsertDeadLetterInput) {
    const normalizedPayload = this.normalizePayload(input);
    const normalizedProcessRunId = this.normalizeProcessRunId(input.processRunId);

    const { rows } = await this.client.query(
      `
      insert into arb.dead_letter (
        process_run_id,
        process_step_id,
        queue_name,
        job_id,
        entity_type,
        entity_pk,
        worker_name,
        worker_instance_id,
        error_code,
        error_message,
        stack_trace,
        payload_json,
        retry_count,
        created_at
      )
      values (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,now()
      )
      returning *
      `,
      [
        normalizedProcessRunId,
        input.processStepId ?? null,
        input.queueName,
        input.jobId ?? null,
        input.entityType ?? null,
        input.entityPk ?? null,
        input.workerName ?? null,
        input.workerInstanceId ?? null,
        input.errorCode ?? null,
        input.errorMessage,
        input.stackTrace ?? null,
        JSON.stringify(normalizedPayload),
        input.retryCount ?? 0
      ]
    );

    return rows[0];
  }

  async getRecent(limit = 100) {
    const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 100;

    const { rows } = await this.client.query(
      `
      select *
      from arb.dead_letter
      order by id desc
      limit $1
      `,
      [safeLimit]
    );

    return rows;
  }

  async getByQueue(queueName: string, limit = 100) {
    const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 100;

    const { rows } = await this.client.query(
      `
      select *
      from arb.dead_letter
      where queue_name = $1
      order by id desc
      limit $2
      `,
      [queueName, safeLimit]
    );

    return rows;
  }

  async getByProcessRunId(processRunId: string, limit = 100) {
    const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 100;

    const { rows } = await this.client.query(
      `
      select *
      from arb.dead_letter
      where process_run_id = $1
      order by id desc
      limit $2
      `,
      [processRunId, safeLimit]
    );

    return rows;
  }

  async getByEntity(entityType: string, entityPk: string, limit = 100) {
    const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 100;

    const { rows } = await this.client.query(
      `
      select *
      from arb.dead_letter
      where entity_type = $1
        and entity_pk = $2
      order by id desc
      limit $3
      `,
      [entityType, entityPk, safeLimit]
    );

    return rows;
  }

  async findLatestByQueueAndJob(queueName: string, jobId: string) {
    const { rows } = await this.client.query(
      `
      select *
      from arb.dead_letter
      where queue_name = $1
        and job_id = $2
      order by id desc
      limit 1
      `,
      [queueName, jobId]
    );

    return rows[0] ?? null;
  }

  private normalizePayload(input: InsertDeadLetterInput): Record<string, unknown> {
    if (input.payloadJson && typeof input.payloadJson === 'object' && !Array.isArray(input.payloadJson)) {
      return input.payloadJson;
    }

    if (typeof input.payload === 'object' && input.payload !== null && !Array.isArray(input.payload)) {
      return input.payload as Record<string, unknown>;
    }

    if (input.payload !== undefined) {
      return { legacyPayload: input.payload };
    }

    return {};
  }

  private normalizeProcessRunId(value: string | number | null | undefined): string | null {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value;
    }

    return null;
  }
}
