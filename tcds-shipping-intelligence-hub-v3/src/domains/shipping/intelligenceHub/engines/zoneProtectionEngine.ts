import { randomUUID } from "node:crypto";
import { pricingZoneAnchors } from "../config/pricingZoneConfig";
import type { RateQuoteGateway } from "../contracts/rateQuoteGateway";
import type { ShippingIntelligenceContext } from "../models/intelligenceContext";
import type { ZoneRateSnapshot } from "../models/pricingIntelligence";

export class ZoneProtectionEngine {
  constructor(private readonly rateGateway: RateQuoteGateway) {}

  async quoteAnchors(
    context: ShippingIntelligenceContext,
    protection: {
      signatureRequired: boolean;
      adultSignatureRequired: boolean;
      restrictedDeliveryRequired: boolean;
    }
  ): Promise<ZoneRateSnapshot[]> {
    const snapshots = await Promise.all(
      pricingZoneAnchors.filter((a) => a.enabled).map(async (anchor) => {
        const requestId = randomUUID();
        const batch = await this.rateGateway.getRates({
          requestId,
          correlationId: context.correlationId,
          purpose: "ZONE_ANCHOR",
          originPostalCode: context.originPostalCode,
          destination: {
            line1: "RATE ESTIMATE ONLY",
            city: anchor.label,
            stateOrProvince: anchor.stateCode,
            postalCode: anchor.postalCode,
            countryCode: "US",
            residential: true,
            verifiedMarketplaceAddress: true
          },
          packages: context.packages,
          shipDate: context.shipDate,
          declaredValueCents: context.salePriceCents,
          signatureRequired: protection.signatureRequired,
          adultSignatureRequired: protection.adultSignatureRequired,
          restrictedDeliveryRequired: protection.restrictedDeliveryRequired
        });
        batch.quotes.forEach((q) => { q.destinationAnchor = anchor.key; });
        return { anchorKey: anchor.key, postalCode: anchor.postalCode, batch, capturedAt: new Date() };
      })
    );
    return snapshots;
  }
}
