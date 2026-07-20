import { ProfitProtectionIntelligenceEngine } from "../../engines/profitProtectionIntelligenceEngine";

describe("ProfitProtectionIntelligenceEngine", () => {
  test("flags undercharged shipping", () => {
    const engine = new ProfitProtectionIntelligenceEngine({
      mode: "SHADOW",
      policyVersion: "p1",
      modelVersion: "m1",
      rulesetVersion: "r1",
      minimumNetProfitUsd: 50,
      minimumMarginPct: 15,
      handlingCutoffEastern: "14:00",
      defaultHandlingBusinessDays: 2,
      maxCarrierQuoteAgeMinutes: 30,
      maxZoneSnapshotAgeHours: 24,
      highValueThresholdUsd: 250,
      ebaySignatureThresholdUsd: 750
    });
    // Canonical units: money = integer cents, weight = ounces.
    // Intent: protected shipping $40.00 (4000c) - buyer-paid shipping $5.00 (500c) = $35.00 (3500c).
    const result = engine.evaluate({
      correlationId: "x",
      idempotencyKey: "x-idem",
      salePriceCents: 30000,
      itemSubtotalCents: 30000,
      shippingPaidCents: 500,
      taxCents: 0,
      totalPaidCents: 30500,
      acquisitionCostCents: 10000,
      marketplaceFeesCents: 4500,
      inboundShippingCents: 1000,
      packagingCostCents: 500,
      returnReserveCents: 1500,
      disputeReserveCents: 500,
      originPostalCode: "33101",
      destination: {
        line1: "1 Main", city: "Miami", stateOrProvince: "FL",
        postalCode: "33101", countryCode: "US"
      },
      packages: [{
        packageId: "p1", actualWeightOz: 80, lengthIn: 10, widthIn: 10, heightIn: 10,
        dimensionsVerified: true, weightVerified: true
      }],
      shipDate: new Date("2026-07-20T00:00:00Z"),
      marketplace: "EBAY",
      mode: "SHADOW"
    }, 2000, 4000);
    expect(result.additionalShippingChargeRequiredCents).toBe(3500);
  });
});
