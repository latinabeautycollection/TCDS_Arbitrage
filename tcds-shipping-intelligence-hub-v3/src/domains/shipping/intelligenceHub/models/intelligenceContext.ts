export type IntelligenceHubMode =
  | "DISABLED"
  | "OBSERVE_ONLY"
  | "SHADOW"
  | "RECOMMEND"
  | "ENFORCE_NON_BLOCKING"
  | "ENFORCE_BLOCKING";

export type EvaluationStage =
  | "PRESALE"
  | "SOLD_ORDER"
  | "LABEL_AUTHORIZATION"
  | "RECONCILIATION";

export type CarrierCode = "USPS" | "UPS" | "FEDEX" | "DHL" | "SHIPENGINE" | string;

export interface AddressInput {
  name?: string;
  company?: string;
  line1: string;
  line2?: string;
  city: string;
  stateOrProvince: string;
  postalCode: string;
  countryCode: string;
  residential?: boolean;
  verifiedMarketplaceAddress?: boolean;
}

export interface PackageInput {
  packageId: string;
  actualWeightOz: number;
  lengthIn: number;
  widthIn: number;
  heightIn: number;
  packagingCode?: string;
  fragile?: boolean;
  hazardous?: boolean;
  serialNumbers?: string[];
  dimensionsVerified: boolean;
  weightVerified: boolean;
  measuredAt?: Date;
  scaleDeviceId?: string;
}

export interface ShippingIntelligenceContext {
  correlationId: string;
  idempotencyKey: string;
  processRunId?: string;
  listingId?: string;
  candidateId?: number;
  sourceListingNormalizedId?: number;
  ebayListingFk?: number;
  ebayOrderFk?: number;
  shipmentId?: number;
  sku?: string;
  categoryKey?: string;
  itemTitle?: string;

  salePriceCents: number;
  itemSubtotalCents: number;
  shippingPaidCents: number;
  taxCents: number;
  totalPaidCents: number;
  acquisitionCostCents: number;
  marketplaceFeesCents: number;
  inboundShippingCents: number;
  packagingCostCents: number;
  returnReserveCents: number;
  disputeReserveCents: number;

  originPostalCode: string;
  destination?: AddressInput;
  packages: PackageInput[];
  shipDate: Date;
  orderPlacedAt?: Date;
  handlingCutoffTime?: string;
  requestedDeliveryBy?: Date;
  highFraudCategory?: boolean;
  marketplace: "EBAY" | "AMAZON" | "SHOPIFY" | string;
  mode: IntelligenceHubMode;
  metadata?: Record<string, unknown>;
}
