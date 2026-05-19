import { PoolClient } from 'pg';

export interface InsertListingEvidenceInput {
  processRunId: string;
  processStepId?: number | null;
  forensicEventId: number;
  listingId?: string | null;
  sourceListingNormalizedId?: number | null;
  candidateId?: number | null;
  sourcePlatform?: string | null;
  sourceExternalId?: string | null;
  title?: string | null;
  normalizedTitle?: string | null;
  brand?: string | null;
  model?: string | null;
  categoryKey?: string | null;
  conditionText?: string | null;
  currentPrice?: number | null;
  buyNowPrice?: number | null;
  inboundShippingUsd?: number | null;
  totalCost?: number | null;
  payloadJson?: Record<string, unknown>;
}

export class ListingEvidenceRepository {
  constructor(private readonly client: PoolClient) {}

  async insert(input: InsertListingEvidenceInput) {
    const { rows } = await this.client.query(
      `
      insert into arb.listing_evidence (
        process_run_id,
        process_step_id,
        forensic_event_id,
        listing_id,
        source_listing_normalized_id,
        candidate_id,
        source_platform,
        source_external_id,
        title,
        normalized_title,
        brand,
        model,
        category_key,
        condition_text,
        current_price,
        buy_now_price,
        inbound_shipping_usd,
        total_cost,
        payload_json
      )
      values (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19::jsonb
      )
      returning *
      `,
      [
        input.processRunId,
        input.processStepId ?? null,
        input.forensicEventId,
        input.listingId ?? null,
        input.sourceListingNormalizedId ?? null,
        input.candidateId ?? null,
        input.sourcePlatform ?? null,
        input.sourceExternalId ?? null,
        input.title ?? null,
        input.normalizedTitle ?? null,
        input.brand ?? null,
        input.model ?? null,
        input.categoryKey ?? null,
        input.conditionText ?? null,
        input.currentPrice ?? null,
        input.buyNowPrice ?? null,
        input.inboundShippingUsd ?? null,
        input.totalCost ?? null,
        JSON.stringify(input.payloadJson ?? {})
      ]
    );

    return rows[0];
  }

  async getById(id: number) {
    const { rows } = await this.client.query(
      `
      select *
      from arb.listing_evidence
      where id = $1
      `,
      [id]
    );
    return rows[0] ?? null;
  }

  async getByProcessRunId(processRunId: string) {
    const { rows } = await this.client.query(
      `
      select *
      from arb.listing_evidence
      where process_run_id = $1
      order by id asc
      `,
      [processRunId]
    );
    return rows;
  }

  async getByEntity(input: {
    listingId?: string | null;
    candidateId?: number | null;
    sourceListingNormalizedId?: number | null;
  }) {
    const clauses: string[] = [];
    const values: unknown[] = [];
    let index = 1;

    if (input.listingId != null) {
      clauses.push(`listing_id = $${index++}`);
      values.push(input.listingId);
    }

    if (input.candidateId != null) {
      clauses.push(`candidate_id = $${index++}`);
      values.push(input.candidateId);
    }

    if (input.sourceListingNormalizedId != null) {
      clauses.push(`source_listing_normalized_id = $${index++}`);
      values.push(input.sourceListingNormalizedId);
    }

    if (clauses.length === 0) {
      throw new Error(
        'ListingEvidenceRepository.getByEntity requires at least one identifier'
      );
    }

    const { rows } = await this.client.query(
      `
      select *
      from arb.listing_evidence
      where ${clauses.join(' or ')}
      order by id asc
      `,
      values
    );

    return rows;
  }
}
