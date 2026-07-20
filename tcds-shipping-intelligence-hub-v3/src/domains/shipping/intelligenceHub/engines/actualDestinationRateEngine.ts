import { randomUUID } from "node:crypto";
import type { RateQuoteGateway } from "../contracts/rateQuoteGateway";
import type { ShippingIntelligenceContext } from "../models/intelligenceContext";
import type { RateQuoteBatch } from "../models/pricingIntelligence";

export class ActualDestinationRateEngine {
  constructor(private readonly rateGateway: RateQuoteGateway) {}

  async quote(
    context: ShippingIntelligenceContext,
    protection: {
      signatureRequired: boolean;
      adultSignatureRequired: boolean;
      restrictedDeliveryRequired: boolean;
    }
  ): Promise<RateQuoteBatch> {
    if (!context.destination) throw new Error("Actual destination is required");
    return this.rateGateway.getRates({
      requestId: randomUUID(),
      correlationId: context.correlationId,
      purpose: "ACTUAL_DESTINATION",
      originPostalCode: context.originPostalCode,
      destination: context.destination,
      packages: context.packages,
      shipDate: context.shipDate,
      declaredValueCents: context.salePriceCents,
      signatureRequired: protection.signatureRequired,
      adultSignatureRequired: protection.adultSignatureRequired,
      restrictedDeliveryRequired: protection.restrictedDeliveryRequired
    });
  }
}
