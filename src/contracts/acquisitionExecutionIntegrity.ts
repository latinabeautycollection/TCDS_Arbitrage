export type ShippingClass =
  | 'ENVELOPE'
  | 'SMALL_PARCEL'
  | 'MEDIUM_BOX'
  | 'LARGE_BOX'
  | 'OVERSIZE'
  | 'FREIGHT'
  | 'FRAGILE'
  | 'HIGH_VALUE'
  | 'UNKNOWN';

export type CarrierCode = 'USPS' | 'UPS' | 'FEDEX' | 'DHL' | 'LOCAL' | 'UNKNOWN';

export type ForensicEventType =
  | 'SOURCE_CAPTURED'
  | 'SOURCE_IMAGE_CAPTURED'
  | 'PURCHASE_DECISION_CAPTURED'
  | 'ITEM_RECEIVED'
  | 'UNBOXING_CAPTURED'
  | 'SERIAL_CAPTURED'
  | 'CONDITION_CAPTURED'
  | 'LISTING_DRAFT_GENERATED'
  | 'PACKAGED'
  | 'SHIPPING_LABEL_CREATED'
  | 'SHIPPED'
  | 'DELIVERED'
  | 'RETURN_REQUESTED'
  | 'DISPUTE_OPENED'
  | 'DISPUTE_EVIDENCE_SUBMITTED'
  | 'DISPUTE_RESOLVED';

export type EvidenceType =
  | 'RAW_HTML'
  | 'SCREENSHOT'
  | 'IMAGE'
  | 'VIDEO'
  | 'SERIAL_NUMBER'
  | 'IMEI'
  | 'MAC_ADDRESS'
  | 'TRACKING'
  | 'LABEL'
  | 'WEIGHT_MEASUREMENT'
  | 'MESSAGE'
  | 'JSON_SNAPSHOT'
  | 'NOTE';

export interface MoneyBreakdown {
  inboundShippingUsd: number;
  outboundShippingUsd: number;
  packagingCostUsd: number;
  insuranceReserveUsd: number;
  signatureReserveUsd: number;
  returnReserveUsd: number;
  disputeReserveUsd: number;
  damageReserveUsd: number;
}

export interface ShippingModelInput {
  listingId: string;
  categoryKey: string | null;
  title: string | null;
  descriptionClean?: string | null;
  conditionText?: string | null;
  sourceShippingUsd?: number | null;
  estimatedSalePriceUsd?: number | null;
  itemCostUsd?: number | null;
  weightLb?: number | null;
  lengthIn?: number | null;
  widthIn?: number | null;
  heightIn?: number | null;
  fragileSignal?: boolean;
  highValueThresholdUsd?: number;
  destinationZone?: number | null;
}

export interface ShippingModelOutput extends MoneyBreakdown {
  shippingClass: ShippingClass;
  outboundCarrierPreference: CarrierCode;
  dimensionalWeightLb: number | null;
  billableWeightLb: number | null;
  oversized: boolean;
  fragile: boolean;
  highValue: boolean;
  shippingRiskScore: number;
  shippingConfidenceScore: number;
  reasonCodes: string[];
  evidence: Record<string, unknown>;
}

export interface ListingGenerationInput {
  listingId: string;
  sourceTitle: string;
  brand?: string | null;
  model?: string | null;
  categoryKey?: string | null;
  conditionText?: string | null;
  descriptionClean?: string | null;
  includedItems?: string[];
  defects?: string[];
  testedFunctions?: string[];
  missingItems?: string[];
  serialNumbers?: string[];
  shippingClass?: ShippingClass;
  forensicEvidenceReady?: boolean;
  maxTitleLength?: number;
}

export interface ListingGenerationOutput {
  title: string;
  subtitle: string | null;
  bulletPoints: string[];
  descriptionHtml: string;
  conditionDisclosure: string;
  includedItemsDisclosure: string;
  defectDisclosure: string | null;
  testingDisclosure: string;
  defenseLanguage: string[];
  seoKeywords: string[];
  listingRiskFlags: string[];
  descriptionQualityScore: number;
  evidence: Record<string, unknown>;
}

export interface ReturnRiskInput {
  categoryKey: string | null;
  conditionText?: string | null;
  identityConfidenceScore: number;
  compConfidenceScore: number;
  shippingRiskScore: number;
  descriptionQualityScore: number;
  estimatedSalePriceUsd: number;
  fragile?: boolean;
  highValue?: boolean;
  ambiguitySignals?: string[];
}

export interface ReturnRiskOutput {
  returnProbability: number;
  disputeProbability: number;
  returnReserveUsd: number;
  disputeReserveUsd: number;
  damageReserveUsd: number;
  returnRiskScore: number;
  reasonCodes: string[];
  evidence: Record<string, unknown>;
}

export interface DisputeDefenseInput {
  listingId: string;
  categoryKey: string | null;
  decisionRank?: string | null;
  estimatedSalePriceUsd: number;
  shippingOutput: ShippingModelOutput;
  listingOutput: ListingGenerationOutput;
  returnRiskOutput: ReturnRiskOutput;
  forensicCompletenessScore: number;
  serialRequired?: boolean;
}

export interface DisputeDefenseOutput {
  defensibilityScore: number;
  sellerProtectionScore: number;
  requiredEvidence: ForensicEventType[];
  missingEvidence: ForensicEventType[];
  recommendedAction: 'PROCEED' | 'REVIEW' | 'BLOCK_UNTIL_EVIDENCE_COMPLETE';
  reasonCodes: string[];
  evidence: Record<string, unknown>;
}

export interface ForensicEvidenceInput {
  listingId: string;
  eventType: ForensicEventType;
  evidenceType: EvidenceType;
  storageUrl?: string | null;
  rawText?: string | null;
  rawJson?: Record<string, unknown> | null;
  hashSha256?: string | null;
  actor?: string | null;
  correlationId?: string | null;
  metadata?: Record<string, unknown>;
}

export interface ForensicEvidenceRecord extends Required<Omit<ForensicEvidenceInput, 'storageUrl' | 'rawText' | 'rawJson' | 'hashSha256' | 'actor' | 'correlationId' | 'metadata'>> {
  storageUrl: string | null;
  rawText: string | null;
  rawJson: Record<string, unknown> | null;
  hashSha256: string;
  actor: string | null;
  correlationId: string | null;
  metadata: Record<string, unknown>;
  createdAtIso: string;
}
