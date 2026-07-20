import type { CarrierCode } from "./intelligenceContext";

export type QuotePurpose = "ZONE_ANCHOR" | "ACTUAL_DESTINATION";
export type InsuranceMechanism = "NONE" | "CARRIER_DECLARED_VALUE" | "THIRD_PARTY";

export interface RateQuote {
  quoteId: string;
  requestId: string;
  purpose: QuotePurpose;
  carrierCode: CarrierCode;
  serviceCode: string;
  serviceName: string;
  totalChargeCents: number;
  baseChargeCents?: number;
  surchargeTotalCents?: number;
  insuranceCostCents?: number;
  signatureCostCents?: number;
  currency: "USD";
  quotedAt: Date;
  validUntil?: Date;
  estimatedDeliveryStartAt?: Date;
  estimatedDeliveryEndAt?: Date;
  committedDeliveryAt?: Date;
  estimatedDeliveryBusinessDays?: number;
  commitmentType: "GUARANTEED" | "ESTIMATED" | "UNKNOWN";
  trackingQualityScore?: number;
  onTimeProbability?: number;
  supportsSignature: boolean;
  supportsAdultSignature: boolean;
  supportsRestrictedDelivery: boolean;
  insuranceMechanisms: InsuranceMechanism[];
  declaredValueLimitCents?: number;
  destinationPostalCode: string;
  destinationAnchor?: string;
  sourceSystem: string;
  raw?: Record<string, unknown>;
}

export interface QuoteFailure {
  requestId: string;
  carrierCode?: string;
  errorCode: string;
  retryable: boolean;
  message: string;
}

export interface RateQuoteBatch {
  quotes: RateQuote[];
  failures: QuoteFailure[];
  completedAt: Date;
  complete: boolean;
}

export interface ZoneRateSnapshot {
  anchorKey: "CALIFORNIA" | "FLORIDA" | "WISCONSIN" | string;
  postalCode: string;
  batch: RateQuoteBatch;
  capturedAt: Date;
}

export interface PricingIntelligence {
  selectedQuote?: RateQuote;
  protectedBaseRateCents: number;
  insuranceCostCents: number;
  signatureCostCents: number;
  surchargeReserveCents: number;
  adjustmentReserveCents: number;
  protectedShippingChargeCents: number;
  shippingMarginCents: number;
  quoteConfidenceScore: number;
  quoteDataComplete: boolean;
  quoteDataFresh: boolean;
  zoneSnapshots: ZoneRateSnapshot[];
  reasonCodes: string[];
}
