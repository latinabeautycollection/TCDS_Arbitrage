import { PoolClient } from 'pg';

export class ListingRepository {
  constructor(private readonly client: PoolClient) {}

  async getById(listingId: string) {
    const { rows } = await this.client.query(
      `select * from arb.listings where id = $1`,
      [listingId]
    );
    return rows[0] ?? null;
  }

  async getByExternalId(listingExternalId: string) {
    const { rows } = await this.client.query(
      `select * from arb.listings where listing_external_id = $1`,
      [listingExternalId]
    );
    return rows[0] ?? null;
  }

  async getNormalizedByExternalId(listingExternalId: string) {
    const { rows } = await this.client.query(
      `
      select *
      from arb.listing_normalized
      where listing_external_id = $1
      order by id desc
      limit 1
      `,
      [listingExternalId]
    );
    return rows[0] ?? null;
  }

  async getRawByListingId(rawId: string) {
    const { rows } = await this.client.query(
      `select * from arb.listings_raw where id = $1`,
      [rawId]
    );
    return rows[0] ?? null;
  }

  async updateProcessMetadata(input: {
    listingId: string;
    processName: string;
    processStage: string;
    processRunId: string;
    actorType?: string | null;
    actorId?: string | null;
    actorName?: string | null;
    phaseSummary?: string | null;
  }) {
    const { rows } = await this.client.query(
      `
      update arb.listings
      set
        last_process_name = $2,
        last_process_stage = $3,
        last_process_run_id = $4,
        last_actor_type = $5,
        last_actor_id = $6,
        last_actor_name = $7,
        phase_summary_current = coalesce($8, phase_summary_current),
        updated_at = now()
      where id = $1
      returning *
      `,
      [
        input.listingId,
        input.processName,
        input.processStage,
        input.processRunId,
        input.actorType ?? null,
        input.actorId ?? null,
        input.actorName ?? null,
        input.phaseSummary ?? null
      ]
    );
    return rows[0];
  }
}
