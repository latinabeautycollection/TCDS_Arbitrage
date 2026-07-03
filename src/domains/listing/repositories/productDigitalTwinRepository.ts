import { Pool } from 'pg';
import { getPool } from './db';
import { ProductDigitalTwin } from '../models/enterpriseListingTypes';

export class ProductDigitalTwinRepository {
  constructor(private readonly db: Pool = getPool()) {}

  async upsert(twin: ProductDigitalTwin, processRunId?: string): Promise<void> {
    await this.db.query(`
      insert into arb.product_digital_twin(source_listing_normalized_id, candidate_id, listing_id, category_key, ebay_category_id, twin_json, identity_confidence_score, conversion_score, risk_score, process_run_id, updated_at)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now())
      on conflict(source_listing_normalized_id) do update set
        candidate_id = excluded.candidate_id,
        listing_id = excluded.listing_id,
        category_key = excluded.category_key,
        ebay_category_id = excluded.ebay_category_id,
        twin_json = excluded.twin_json,
        identity_confidence_score = excluded.identity_confidence_score,
        conversion_score = excluded.conversion_score,
        risk_score = excluded.risk_score,
        process_run_id = excluded.process_run_id,
        updated_at = now()
    `, [twin.sourceListingNormalizedId, twin.candidateId ?? null, twin.listingId ?? null, twin.categoryKey ?? null, twin.ebayCategoryId ?? null, twin as any, twin.identity.confidenceScore, twin.listing.conversionScore ?? null, twin.risk.disputeRiskScore, processRunId ?? null]);
  }

  async get(sourceListingNormalizedId: number): Promise<ProductDigitalTwin | null> {
    const res = await this.db.query(`select twin_json from arb.product_digital_twin where source_listing_normalized_id=$1`, [sourceListingNormalizedId]);
    return res.rows[0]?.twin_json ?? null;
  }
}
