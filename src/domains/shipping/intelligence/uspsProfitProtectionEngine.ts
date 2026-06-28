import { getUspsEnv } from "../config/uspsEnv";
import { buildUspsProtectionExtraServices, normalizeUspsPrice } from "../utils/uspsUtils";
import { UspsApi } from "../providers/uspsApi";
import { UspsRateShopInput, UspsDecisionResult } from "../models/uspsTypes";
export class UspsProfitProtectionEngine {
  private readonly env = getUspsEnv();
  constructor(private readonly api = new UspsApi()) {}
  async decide(input: UspsRateShopInput): Promise<UspsDecisionResult> {
    const requireInsurance = input.requireInsurance ?? Boolean((input.itemValue ?? 0) >= this.env.USPS_INSURANCE_REQUIRED_MIN_VALUE_USD || input.fragile);
    const requireSignature = input.requireSignature ?? Boolean((input.itemValue ?? 0) >= this.env.USPS_SIGNATURE_REQUIRED_MIN_VALUE_USD);
    const requireRestrictedDelivery = input.requireRestrictedDelivery ?? Boolean((input.itemValue ?? 0) >= this.env.USPS_RESTRICTED_DELIVERY_REQUIRED_MIN_VALUE_USD);
    const request = {
      pricingOptions: [{ priceType: input.priceType ?? this.env.USPS_DEFAULT_PRICE_TYPE }],
      originZIPCode: input.originZIPCode,
      destinationZIPCode: input.destinationZIPCode,
      destinationEntryFacilityType: "NONE",
      shippingFilter: "PRICE",
      packageDescription: {
        mailClasses: this.env.USPS_DEFAULT_MAIL_CLASSES.split(",").map((x) => x.trim()).filter(Boolean),
        weight: input.weight, length: input.length, width: input.width, height: input.height,
        processingCategory: "MACHINABLE", itemValue: input.itemValue ?? 0,
        extraServices: buildUspsProtectionExtraServices({ itemValue: input.itemValue, requireInsurance, requireSignature, requireRestrictedDelivery }),
        hasNonstandardCharacteristics: false,
      },
    };
    const response: any = await this.api.shippingOptionsSearch(request);
    const rawOptions = response.options ?? response.shippingOptions ?? response.rateOptions ?? [];
    const options = rawOptions.map((option: any) => ({ option, price: normalizeUspsPrice(option) })).filter((x: any) => x.price !== undefined).sort((a: any,b: any) => Number(a.price)-Number(b.price));
    const cheapest = options[0] ?? null;
    const riskScore = this.basicRiskScore(input, requireInsurance, requireSignature);
    const profitScore = cheapest?.price ? Math.max(0, Math.min(100, 100 - Number(cheapest.price))) : 50;
    return {
      carrier: "USPS",
      selectedMailClass: cheapest?.option?.mailClass,
      selectedPriceUsd: cheapest?.price,
      cheapestPriceUsd: cheapest?.price,
      riskScore,
      profitScore,
      confidenceScore: cheapest ? 85 : 35,
      humanReviewRequired: riskScore >= this.env.USPS_HUMAN_REVIEW_RISK_SCORE,
      executiveHoldRequired: riskScore >= this.env.USPS_EXECUTIVE_HOLD_RISK_SCORE,
      reason: cheapest ? "USPS option selected after protection and risk scoring." : "No USPS priced option returned.",
      raw: { request, response, options },
    };
  }
  private basicRiskScore(input: UspsRateShopInput, requireInsurance: boolean, requireSignature: boolean): number {
    let score = 20;
    if ((input.itemValue ?? 0) >= this.env.USPS_INSURANCE_REQUIRED_MIN_VALUE_USD && !requireInsurance) score += 25;
    if ((input.itemValue ?? 0) >= this.env.USPS_SIGNATURE_REQUIRED_MIN_VALUE_USD && !requireSignature) score += 25;
    if (input.fragile) score += 15;
    if (input.weight > 20) score += 10;
    if (input.length * input.width * input.height > 1728) score += 10;
    return Math.min(score, 100);
  }
}
