import { ExistingRateEngineAdapter } from "../../adapters/existingRateEngineAdapter";

test("missing carrier capabilities default to false, never true", async () => {
  const adapter = new ExistingRateEngineAdapter(
    { quote: async () => [{ carrierCode: "UPS", serviceCode: "2DAY", totalChargeUsd: 20, estimatedDeliveryDays: 2 }] },
    { timeoutMs: 1000, maxAttempts: 1, baseDelayMs: 1, sourceSystem: "test" }
  );
  const result = await adapter.getRates({
    requestId: "11111111-1111-1111-1111-111111111111",
    correlationId: "correlation-1",
    purpose: "ACTUAL_DESTINATION",
    originPostalCode: "22026",
    destination: { line1: "1 Main", city: "Miami", stateOrProvince: "FL", postalCode: "33101", countryCode: "US" },
    packages: [{ packageId: "p", actualWeightOz: 16, lengthIn: 5, widthIn: 5, heightIn: 5, dimensionsVerified: true, weightVerified: true }],
    shipDate: new Date(),
    declaredValueCents: 10000,
    signatureRequired: false,
    adultSignatureRequired: false,
    restrictedDeliveryRequired: false
  });
  expect(result.quotes[0]?.supportsSignature).toBe(false);
  expect(result.quotes[0]?.insuranceMechanisms).toEqual([]);
});
