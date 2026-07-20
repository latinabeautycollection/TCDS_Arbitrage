import type { AddressInput, PackageInput } from "../models/intelligenceContext";
import type { QuotePurpose, RateQuoteBatch } from "../models/pricingIntelligence";

export interface RateQuoteRequest {
  requestId: string;
  correlationId: string;
  purpose: QuotePurpose;
  originPostalCode: string;
  destination: AddressInput;
  packages: PackageInput[];
  shipDate: Date;
  declaredValueCents: number;
  signatureRequired: boolean;
  adultSignatureRequired: boolean;
  restrictedDeliveryRequired: boolean;
  allowedCarriers?: string[];
}

export interface RateQuoteGateway {
  getRates(request: RateQuoteRequest): Promise<RateQuoteBatch>;
}
