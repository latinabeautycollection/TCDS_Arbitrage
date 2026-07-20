import { protectionPolicyConfig } from "../config/protectionPolicyConfig";

export interface InsuranceDecision {
  required: boolean;
  insuredValueUsd: number;
  preferredSource: "THIRD_PARTY" | "CARRIER" | "NONE";
  reasonCodes: string[];
}

export function decideInsurance(salePriceUsd: number): InsuranceDecision {
  const required = salePriceUsd >= protectionPolicyConfig.insuranceThresholdUsd;
  return {
    required,
    insuredValueUsd: required ? salePriceUsd : 0,
    preferredSource: required ? "THIRD_PARTY" : "NONE",
    reasonCodes: required ? ["INSURANCE_REQUIRED_AT_SALE_PRICE"] : []
  };
}
