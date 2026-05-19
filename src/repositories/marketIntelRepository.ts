import { PoolClient } from 'pg';

export class MarketIntelRepository {
  constructor(private readonly client: PoolClient) {}

  async getRun(runId: number) {
    const { rows } = await this.client.query(
      `select * from arb.market_intel_runs where id = $1`,
      [runId]
    );
    return rows[0] ?? null;
  }

  async getSnapshot(snapshotId: number) {
    const { rows } = await this.client.query(
      `select * from arb.ebay_market_snapshots where id = $1`,
      [snapshotId]
    );
    return rows[0] ?? null;
  }

  async getProductsByRun(runId: number) {
    const { rows } = await this.client.query(
      `
      select *
      from arb.market_snapshot_products
      where run_id = $1
      order by id asc
      `,
      [runId]
    );
    return rows;
  }

  async claimProduct(
    productId: number,
    processName: string,
    processRunId: string,
    claimedBy: string,
    claimTtlSeconds = 300
  ) {
    const { rows } = await this.client.query(
      `select * from arb.claim_market_snapshot_product($1,$2,$3,$4,$5)`,
      [productId, processName, processRunId, claimedBy, claimTtlSeconds]
    );
    return rows[0] ?? null;
  }

  async updateRunLinkage(input: {
    marketIntelRunId: number;
    processRunId: string;
    actorType?: string | null;
    actorId?: string | null;
    actorName?: string | null;
  }) {
    const { rows } = await this.client.query(
      `
      update arb.market_intel_runs
      set
        process_run_id = $2,
        actor_type = $3,
        actor_id = $4,
        actor_name = $5,
        updated_at = now()
      where id = $1
      returning *
      `,
      [
        input.marketIntelRunId,
        input.processRunId,
        input.actorType ?? null,
        input.actorId ?? null,
        input.actorName ?? null
      ]
    );
    return rows[0];
  }

  async updateSnapshotLinkage(input: {
    snapshotId: number;
    processRunId: string;
    actorType?: string | null;
    actorId?: string | null;
    actorName?: string | null;
  }) {
    const { rows } = await this.client.query(
      `
      update arb.ebay_market_snapshots
      set
        process_run_id = $2,
        actor_type = $3,
        actor_id = $4,
        actor_name = $5
      where id = $1
      returning *
      `,
      [
        input.snapshotId,
        input.processRunId,
        input.actorType ?? null,
        input.actorId ?? null,
        input.actorName ?? null
      ]
    );
    return rows[0];
  }
}
