export interface ShippingEvidenceSnapshot {
  entityType: string;
  entityPk: string;
  sourceListingNormalizedId?: number | null;
  shipmentId?: number | null;
  carrierCode?: string | null;
  serviceCode?: string | null;
  serviceName?: string | null;
  quotedLabelCostUsd?: number | null;
  estimatedDeliveryDays?: number | null;
  onTimeProbability?: number | null;
  trackingQualityScore?: number | null;
  claimRiskScore?: number | null;
  payloadJson?: Record<string, unknown>;
}
