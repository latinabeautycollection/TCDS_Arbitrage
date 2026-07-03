import { Pool } from 'pg';
import { getPool } from '../repositories/db';

export class ExecutiveListingAnalyticsService {
  constructor(private readonly db: Pool = getPool()) {}
  async getExecutiveSnapshot(): Promise<Record<string, unknown>> {
    const result = await this.db.query(`
      select
        count(*) filter (where el.listing_status='LIVE')::int as live_listings,
        count(*) filter (where el.listing_status='SOLD')::int as sold_listings,
        coalesce(avg(lce.expected_conversion_probability),0)::float as avg_conversion_probability,
        coalesce(avg(dre.dispute_risk_score),0)::float as avg_dispute_risk_score,
        coalesce(sum(lfr.conversions),0)::int as conversions,
        coalesce(sum(lfr.return_count),0)::int as returns,
        coalesce(sum(lfr.dispute_count),0)::int as disputes
      from arb.ebay_listing el
      left join arb.listing_conversion_evidence lce on lce.ebay_listing_fk=el.id
      left join arb.dispute_risk_evidence dre on dre.ebay_listing_fk=el.id
      left join arb.listing_feedback_rollups lfr on lfr.ebay_listing_fk=el.id
    `);
    return result.rows[0] ?? {};
  }
}
