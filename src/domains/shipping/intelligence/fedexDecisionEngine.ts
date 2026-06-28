import { getFedExEnv } from "../config/fedexEnv";
import { FedExApi } from "../providers/fedexApi";
import { FedExRateShopInput, FedExDecisionResult } from "../models/fedexTypes";
import { mapFedExRateOptions } from "../mappers/fedexMapper";

export class FedExDecisionEngine {
  private readonly env = getFedExEnv();

  constructor(private readonly api = new FedExApi()) {}

  async decide(input: FedExRateShopInput): Promise<FedExDecisionResult> {
    const request = this.buildRateRequest(input);
    const response = await this.api.rates(request);
    const options = mapFedExRateOptions(response);
    const cheapest = options[0] ?? null;

    const riskScore = this.basicRiskScore(input);
    const profitScore = cheapest?.priceUsd ? Math.max(0, Math.min(100, 100 - cheapest.priceUsd)) : 50;

    return {
      carrier: "FEDEX",
      selectedServiceType: cheapest?.serviceType,
      selectedPriceUsd: cheapest?.priceUsd,
      cheapestPriceUsd: cheapest?.priceUsd,
      riskScore,
      profitScore,
      confidenceScore: cheapest ? 85 : 35,
      humanReviewRequired: riskScore >= this.env.FEDEX_HUMAN_REVIEW_RISK_SCORE,
      executiveHoldRequired: riskScore >= this.env.FEDEX_EXECUTIVE_HOLD_RISK_SCORE,
      reason: cheapest ? "FedEx service selected after rate and protection scoring." : "No FedEx priced option returned.",
      raw: { request, response, options },
    };
  }

  buildRateRequest(input: FedExRateShopInput) {
    return {
      accountNumber: { value: this.env.FEDEX_ACCOUNT_NUMBER },
      requestedShipment: {
        shipper: {
          address: {
            postalCode: input.originPostalCode,
            countryCode: input.originCountryCode ?? "US",
          },
        },
        recipient: {
          address: {
            postalCode: input.destinationPostalCode,
            countryCode: input.destinationCountryCode ?? "US",
            residential: input.residential ?? false,
          },
        },
        pickupType: this.env.FEDEX_DEFAULT_PICKUP_TYPE,
        rateRequestType: [this.env.FEDEX_DEFAULT_RATE_REQUEST_TYPE],
        requestedPackageLineItems: [{
          weight: { units: "LB", value: input.weightLb },
          dimensions: {
            length: input.lengthIn,
            width: input.widthIn,
            height: input.heightIn,
            units: "IN",
          },
          declaredValue: input.itemValueUsd ? { amount: input.itemValueUsd, currency: "USD" } : undefined,
        }],
      },
      carrierCodes: ["FDXE", "FDXG"],
    };
  }

  private basicRiskScore(input: FedExRateShopInput): number {
    let score = 20;
    if ((input.itemValueUsd ?? 0) >= this.env.FEDEX_INSURANCE_REQUIRED_MIN_VALUE_USD) score += 10;
    if ((input.itemValueUsd ?? 0) >= this.env.FEDEX_SIGNATURE_REQUIRED_MIN_VALUE_USD) score += 10;
    if (input.fragile) score += 15;
    if (input.weightLb > 20) score += 10;
    if (input.lengthIn * input.widthIn * input.heightIn > 1728) score += 10;
    return Math.min(score, 100);
  }
}
