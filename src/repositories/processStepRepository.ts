import { PoolClient } from 'pg';
import { uuid } from '../lib/crypto';

export type ProcessStepStatus =
  | 'PENDING'
  | 'RUNNING'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'DEAD_LETTERED'
  | 'CANCELLED';

export interface CreateProcessStepInput {
  processRunId: string;
  stepName: string;
  queueName: string;
  entityType?: string | null;
  entityPk?: string | null;
  payloadJson?: Record<string, unknown>;
  idempotencyKey?: string | null;
  attemptNo?: number;
}

export interface ClaimResult {
  id: number;
  claimToken: string;
}

export class ProcessStepRepository {
  constructor(private readonly client: PoolClient) {}

  async create(input: CreateProcessStepInput) {
    const { rows } = await this.client.query(
      `
      insert into arb.process_steps (
        process_run_id,
        step_name,
        queue_name,
        entity_type,
        entity_pk,
        status,
        attempt_no,
        idempotency_key,
        payload_json
      )
      values (
        $1,$2,$3,$4,$5,'PENDING',$6,$7,$8::jsonb
      )
      returning *
      `,
      [
        input.processRunId,
        input.stepName,
        input.queueName,
        input.entityType ?? null,
        input.entityPk ?? null,
        input.attemptNo ?? 1,
        input.idempotencyKey ?? null,
        JSON.stringify(input.payloadJson ?? {})
      ]
    );

    return rows[0];
  }

  async claimNext(workerName: string, queueName: string): Promise<any | null> {
    const claimToken = uuid();

    const { rows } = await this.client.query(
      `
      with candidate as (
        select id
        from arb.process_steps
        where status in ('PENDING','FAILED')
          and queue_name = $2
          and (
            claim_token is null
            or claim_expires_at is null
            or claim_expires_at < now()
          )
        order by created_at asc
        for update skip locked
        limit 1
      )
      update arb.process_steps ps
      set
        status = 'RUNNING',
        claim_token = $3::uuid,
        claimed_at = now(),
        claimed_by = $1,
        claim_expires_at = now() + interval '5 minutes',
        started_at = coalesce(ps.started_at, now()),
        updated_at = now()
      from candidate
      where ps.id = candidate.id
      returning ps.*
      `,
      [workerName, queueName, claimToken]
    );

    return rows[0] ?? null;
  }

  async claimById(processStepId: number, workerName: string) {
    const claimToken = uuid();

    const { rows } = await this.client.query(
      `
      update arb.process_steps
      set
        status = 'RUNNING',
        claim_token = $2::uuid,
        claimed_at = now(),
        claimed_by = $1,
        claim_expires_at = now() + interval '5 minutes',
        started_at = coalesce(started_at, now()),
        updated_at = now()
      where id = $3
        and status in ('PENDING','FAILED')
        and (
          claim_token is null
          or claim_expires_at is null
          or claim_expires_at < now()
        )
      returning *
      `,
      [workerName, claimToken, processStepId]
    );

    return rows[0] ?? null;
  }

  async complete(processStepId: number, resultJson?: Record<string, unknown>) {
    const { rows } = await this.client.query(
      `
      update arb.process_steps
      set
        status = 'SUCCEEDED',
        result_json = $2::jsonb,
        completed_at = now(),
        updated_at = now()
      where id = $1
      returning *
      `,
      [processStepId, JSON.stringify(resultJson ?? {})]
    );

    return rows[0];
  }

  async fail(
    processStepId: number,
    errorCode: string,
    errorMessage: string,
    resultJson?: Record<string, unknown>
  ) {
    const { rows } = await this.client.query(
      `
      update arb.process_steps
      set
        status = 'FAILED',
        error_code = $2,
        error_message = $3,
        result_json = coalesce(result_json, '{}'::jsonb) || $4::jsonb,
        completed_at = now(),
        updated_at = now()
      where id = $1
      returning *
      `,
      [
        processStepId,
        errorCode,
        errorMessage,
        JSON.stringify(resultJson ?? {})
      ]
    );

    return rows[0];
  }

  async deadLetter(
    processStepId: number,
    errorCode: string,
    errorMessage: string
  ) {
    const { rows } = await this.client.query(
      `
      update arb.process_steps
      set
        status = 'DEAD_LETTERED',
        error_code = $2,
        error_message = $3,
        completed_at = now(),
        updated_at = now()
      where id = $1
      returning *
      `,
      [processStepId, errorCode, errorMessage]
    );

    return rows[0];
  }

  async cancel(processStepId: number, reason?: string) {
    const { rows } = await this.client.query(
      `
      update arb.process_steps
      set
        status = 'CANCELLED',
        error_message = coalesce($2, error_message),
        completed_at = now(),
        updated_at = now()
      where id = $1
      returning *
      `,
      [processStepId, reason ?? null]
    );

    return rows[0];
  }

  async getByRunId(processRunId: string) {
    const { rows } = await this.client.query(
      `
      select *
      from arb.process_steps
      where process_run_id = $1
      order by created_at asc
      `,
      [processRunId]
    );

    return rows;
  }

  async claim(processStepId: number, workerName: string) {
    return this.claimById(processStepId, workerName);
  }

  async findStaleLocks() {
    const { rows } = await this.client.query(
      `
      select *
      from arb.process_steps
      where status = 'RUNNING'
        and claim_expires_at < now()
      `
    );

    return rows;
  }
}
