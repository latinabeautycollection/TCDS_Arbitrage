import { CarrierSelectionIntelligenceEngine } from "../../engines/carrierSelectionIntelligenceEngine";

test("zone anchor quotes can never be selected as actual carrier rates", () => {
  const engine = new CarrierSelectionIntelligenceEngine();
  const result = engine.select({
    quotes: [{
      quoteId: "anchor",
      requestId: "r",
      purpose: "ZONE_ANCHOR",
      carrierCode: "UPS",
      serviceCode: "2DAY",
      serviceName: "UPS 2 Day",
      totalChargeCents: 100,
      currency: "USD",
      quotedAt: new Date(),
      estimatedDeliveryBusinessDays: 2,
      commitmentType: "ESTIMATED",
      supportsSignature: true,
      supportsAdultSignature: true,
      supportsRestrictedDelivery: true,
      insuranceMechanisms: ["THIRD_PARTY"],
      destinationPostalCode: "95814",
      sourceSystem: "test"
    }],
    now: new Date(),
    maxQuoteAgeMinutes: 30,
    destinationClass: "CONTIGUOUS_US",
    requirements: {
      signatureRequired: false,
      adultSignatureRequired: false,
      restrictedDeliveryRequired: false,
      insuranceRequired: false,
      insuranceMechanism: "NONE",
      insuredValueCents: 0
    }
  });
  expect(result.noEligibleRate).toBe(true);
  expect(result.selected).toBeUndefined();
});
