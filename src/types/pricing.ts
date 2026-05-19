export interface PricingEvidenceSnapshot {
  entityType: string;
  entityPk: string;
  sourceListingNormalizedId?: number | null;
  candidateId?: number | null;
  decisionId?: string | null;
  priceType: string;
  amountUsd?: number | null;
  ebayFeeUsd?: number | null;
  paymentFeeUsd?: number | null;
  shippingUsd?: number | null;
  totalCostBasisUsd?: number | null;
  expectedProfitUsd?: number | null;
  roiPct?: number | null;
  marginPct?: number | null;
  payloadJson?: Record<string, unknown>;
}
