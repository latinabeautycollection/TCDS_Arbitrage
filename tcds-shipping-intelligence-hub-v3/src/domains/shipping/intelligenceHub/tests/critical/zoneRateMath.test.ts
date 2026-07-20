import { calculateWorstCaseAnchorRate } from "../../calculators/worstCaseRateCalculator";

test("protected anchor rate is max of each anchor's cheapest eligible rate", () => {
  const make = (anchorKey: string, prices: number[]) => ({
    anchorKey,
    postalCode: "00000",
    capturedAt: new Date(),
    batch: {
      quotes: prices.map((p, i) => ({
        quoteId: `${anchorKey}-${i}`, requestId: "r", purpose: "ZONE_ANCHOR" as const,
        carrierCode: "UPS", serviceCode: `S${i}`, serviceName: "S", totalChargeCents: p,
        currency: "USD" as const, quotedAt: new Date(), estimatedDeliveryBusinessDays: 2,
        commitmentType: "ESTIMATED" as const, supportsSignature: true,
        supportsAdultSignature: true, supportsRestrictedDelivery: false,
        insuranceMechanisms: ["THIRD_PARTY" as const], destinationPostalCode: "00000",
        sourceSystem: "test"
      })),
      failures: [], completedAt: new Date(), complete: true
    }
  });
  const result = calculateWorstCaseAnchorRate([
    make("CA", [3000, 5000]),
    make("FL", [2500, 7000]),
    make("WI", [4000, 4500])
  ]);
  expect(result.amountCents).toBe(4000);
});
