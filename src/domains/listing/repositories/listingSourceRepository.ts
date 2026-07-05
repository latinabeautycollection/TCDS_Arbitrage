import { getPool } from './db';
import { ListingSourceInput } from '../models/listingTypes';

export class ListingSourceRepository {
  async getSourceInput(sourceListingNormalizedId: number): Promise<ListingSourceInput> {
    // NOTE: live arb.listing_normalized has no mpn/gtin/description_clean columns;
    // pull those from raw_last_payload when available, else null.
    const sql = `
      SELECT ln.id, ln.title, ln.listing_title, ln.brand, ln.model, ln.condition_text, ln.category,
             ln.image_url, ln.raw_last_payload, ln.listing_url,
             ad.id AS arbitrage_decision_id, ad.expected_sale_price, ad.expected_profit_usd, ad.total_cost_basis_usd, ad.risk_flags
      FROM arb.listing_normalized ln
      LEFT JOIN LATERAL (
        SELECT * FROM arb.arbitrage_decision ad
        WHERE ad.source_listing_normalized_id = ln.id
        ORDER BY ad.created_at DESC LIMIT 1
      ) ad ON true
      WHERE ln.id = $1`;
    const { rows } = await getPool().query(sql, [sourceListingNormalizedId]);
    if (!rows[0]) throw new Error(`source listing not found: ${sourceListingNormalizedId}`);
    const r = rows[0];
    const raw = r.raw_last_payload || {};
    const imageUrls = [r.image_url, ...(raw.image_urls || raw.photo_urls || [])].filter(Boolean);
    return {
      sourceListingNormalizedId: Number(r.id),
      arbitrageDecisionId: r.arbitrage_decision_id ? Number(r.arbitrage_decision_id) : null,
      title: r.listing_title || r.title,
      brand: r.brand,
      model: r.model,
      mpn: raw.mpn || null,
      gtin: raw.gtin || raw.upc || null,
      conditionText: r.condition_text,
      category: r.category,
      imageUrls,
      descriptionClean: raw.description || raw.description_text || null,
      listingUrl: r.listing_url,
      recommendedSalePriceUsd: Number(r.expected_sale_price || 0),
      minAcceptablePriceUsd: null,
      totalCostBasisUsd: r.total_cost_basis_usd ? Number(r.total_cost_basis_usd) : null,
      expectedProfitUsd: r.expected_profit_usd ? Number(r.expected_profit_usd) : null,
      riskFlags: Array.isArray(r.risk_flags) ? r.risk_flags : [],
    };
  }
}
