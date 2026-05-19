export interface ListingEvidenceSnapshot {
  listingId?: string | null;
  candidateId?: number | null;
  sourceListingNormalizedId?: number | null;
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
