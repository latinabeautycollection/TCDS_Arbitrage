import type { Pool } from 'pg';
import { sha256 } from './hashStable';
import type { ForensicLedgerWriteInput } from '../contracts/capitalSafety.types';

export class ForensicLedgerService {
  public constructor(private readonly pool: Pool) {}

  public async append(input: ForensicLedgerWriteInput): Promise<{ ledgerHash: string }> {
    const previous = await this.pool.query(
      `select ledger_hash from arb.forensic_mutation_ledger where entity_type=$1 and entity_id=$2 order by id desc limit 1`,
      [input.entityType, input.entityId],
    );

    const previousLedgerHash = previous.rows[0]?.ledger_hash ?? null;
    const beforeHash = input.before === undefined ? null : sha256(input.before);
    const afterHash = sha256(input.after);
    const payloadHash = sha256(input.payload ?? {});
    const ledgerHash = sha256({
      correlationId: input.correlationId,
      entityType: input.entityType,
      entityId: input.entityId,
      mutationType: input.mutationType,
      actor: input.actor,
      beforeHash,
      afterHash,
      payloadHash,
      previousLedgerHash,
    });

    await this.pool.query(
      `
      insert into arb.forensic_mutation_ledger (
        correlation_id, entity_type, entity_id, mutation_type, actor,
        before_hash, after_hash, payload_hash, payload_json,
        previous_ledger_hash, ledger_hash, created_at
      ) values ($1::uuid,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,now())
      on conflict (ledger_hash) do nothing
      `,
      [
        input.correlationId,
        input.entityType,
        input.entityId,
        input.mutationType,
        input.actor,
        beforeHash,
        afterHash,
        payloadHash,
        JSON.stringify(input.payload ?? {}),
        previousLedgerHash,
        ledgerHash,
      ],
    );

    return { ledgerHash };
  }

  public async verifyContinuity(entityType: string, entityId: string): Promise<boolean> {
    const rows = await this.pool.query(
      `select previous_ledger_hash, ledger_hash from arb.forensic_mutation_ledger where entity_type=$1 and entity_id=$2 order by id asc`,
      [entityType, entityId],
    );
    let prev: string | null = null;
    for (const row of rows.rows) {
      if ((row.previous_ledger_hash ?? null) !== prev) return false;
      prev = row.ledger_hash;
    }
    return true;
  }
}
