import { PoolClient } from 'pg';

export interface AppendMutationLedgerInput {
  processRunId?: string | null;
  correlationId?: string | null;
  tableName: string;
  rowPk: string;
  operationType: 'INSERT' | 'UPDATE' | 'UPSERT' | 'DELETE';
  changedFields?: string[];
  changeSummary?: Record<string, unknown>;
  actorType: 'user' | 'worker' | 'system' | 'api' | 'service_account';
  actorId?: string | null;
  workerName?: string | null;
  workerInstanceId?: string | null;
}

export class MutationLedgerRepository {
  constructor(private readonly client: PoolClient) {}

  async append(input: AppendMutationLedgerInput) {
    await this.client.query(
      `
      insert into arb.db_mutation_ledger (
        process_run_id,
        correlation_id,
        table_name,
        row_pk,
        operation_type,
        changed_fields,
        change_summary,
        actor_type,
        actor_id,
        worker_name,
        worker_instance_id
      )
      values ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11)
      `,
      [
        input.processRunId ?? null,
        input.correlationId ?? null,
        input.tableName,
        input.rowPk,
        input.operationType,
        input.changedFields ?? [],
        JSON.stringify(input.changeSummary ?? {}),
        input.actorType,
        input.actorId ?? null,
        input.workerName ?? null,
        input.workerInstanceId ?? null
      ]
    );
  }
}
