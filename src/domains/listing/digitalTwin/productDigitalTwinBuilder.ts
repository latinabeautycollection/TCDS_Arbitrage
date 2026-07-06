import { ProductDigitalTwin } from '../models/enterpriseListingTypes';

export class ProductDigitalTwinBuilder {
  build(row: any): ProductDigitalTwin {
    const title = row.title ?? row.listing_title ?? row.normalized_title ?? '';
    const imageUrls: string[] = Array.isArray(row.photo_urls) ? row.photo_urls : Array.isArray(row.image_urls) ? row.image_urls : row.image_url ? [row.image_url] : [];
    return {
      sourceListingNormalizedId: Number(row.source_listing_normalized_id ?? row.id),
      candidateId: row.candidate_id ? Number(row.candidate_id) : undefined,
      listingId: row.listing_id,
      categoryKey: row.category_key ?? row.category,
      ebayCategoryId: row.ebay_category_id ?? row.category_id,
      identity: {
        title,
        brand: row.brand,
        model: row.model,
        mpn: row.mpn,
        gtin: row.gtin,
        epid: row.epid,
        canonicalProductKey: row.canonical_product_key,
        confidenceScore: Number(row.identity_confidence ?? row.confidence_score ?? 0.5),
      },
      economics: {
        acquisitionPriceUsd: numberOrUndefined(row.acquisition_price ?? row.current_price ?? row.buy_now_price),
        expectedSalePriceUsd: numberOrUndefined(row.expected_sale_price ?? row.recommended_sale_price_usd ?? row.listing_price_usd),
        minAcceptablePriceUsd: numberOrUndefined(row.min_acceptable_price_usd),
        expectedProfitUsd: numberOrUndefined(row.expected_profit_usd ?? row.estimated_net_profit_usd),
        roiPct: numberOrUndefined(row.roi_pct ?? row.estimated_roi_percent),
        marginPct: numberOrUndefined(row.margin_pct ?? row.estimated_margin_percent),
      },
      market: {
        soldCompCount: numberOrUndefined(row.sold_comp_count ?? row.accepted_comp_count),
        activeCompCount: numberOrUndefined(row.active_comp_count),
        medianSoldPriceUsd: numberOrUndefined(row.median_sold_price ?? row.median_comp_price_usd),
        sellThroughRate: numberOrUndefined(row.sell_through_rate),
        expectedDaysToSell: numberOrUndefined(row.expected_days_to_sell ?? row.estimated_days_to_sell),
      },
      condition: {
        sourceConditionText: row.condition_text,
        normalizedCondition: row.condition_id ?? row.condition_grade,
        defects: extractList(row.defects_json ?? row.risk_flags_json),
        missingAccessories: extractList(row.missing_accessories_json),
        disclosureRequired: Boolean(row.condition_text || row.risk_flags_json),
        conditionConfidenceScore: Number(row.condition_confidence_score ?? 0.7),
      },
      photos: imageUrls.map((url, index) => ({ originalUrl: url, role: index === 0 ? 'PRIMARY' : 'DETAIL' })),
      risk: {
        returnRiskScore: Number(row.return_risk_score ?? row.return_probability ?? 0.15),
        disputeRiskScore: Number(row.dispute_risk_score ?? row.dispute_probability ?? 0.12),
        accountRiskScore: Number(row.account_risk_score ?? 0.1),
        riskFlags: extractList(row.risk_flags_json ?? row.risk_flags),
      },
      listing: { bulletPoints: [], itemSpecifics: {}, seoKeywords: [] },
    };
  }
}

function numberOrUndefined(value: unknown): number | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}
function extractList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === 'string') return value ? [value] : [];
  return [];
}
