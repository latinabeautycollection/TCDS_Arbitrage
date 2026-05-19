import { PoolClient } from 'pg';
import { createHash } from 'crypto';

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

export class QueueIdempotencyRepository {
  constructor(private readonly client: PoolClient) {}

  async reserve(input: {
    queueName: string;
    idempotencyKey: string;
    jobId?: string | null;
    processRunId?: string | null;
    entityType?: string | null;
    entityPk?: string | null;
    payload?: Record<string, unknown>;
  }) {
    const payloadHash = input.payload ? sha256(JSON.stringify(input.payload)) : null;

    const { rows } = await this.client.query(
      `
      insert into arb.queue_idempotency (
        queue_name,
        idempotency_key,
        job_id,
        process_run_id,
        entity_type,
        entity_pk,
        payload_hash
      )
      values ($1,$2,$3,$4,$5,$6,$7)
      on conflict (queue_name, idempotency_key)
      do update set
        queue_name = excluded.queue_name
      returning *
      `,
      [
        input.queueName,
        input.idempotencyKey,
        input.jobId ?? null,
        input.processRunId ?? null,
        input.entityType ?? null,
        input.entityPk ?? null,
        payloadHash
      ]
    );

    return rows[0];
  }

  async find(queueName: string, idempotencyKey: string) {
    const { rows } = await this.client.query(
      `
      select *
      from arb.queue_idempotency
      where queue_name = $1
        and idempotency_key = $2
      limit 1
      `,
      [queueName, idempotencyKey]
    );
    return rows[0] ?? null;
  }
}
