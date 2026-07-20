import type { DestinationClass } from "../models/destinationIntelligence";
import { protectionPolicyConfig } from "../config/protectionPolicyConfig";

export interface SignatureDecision {
  required: boolean;
  adultRequired: boolean;
  restrictedDeliveryRequired: boolean;
  reasonCodes: string[];
}

export function decideSignature(input: {
  totalPaidUsd: number;
  destinationClass: DestinationClass;
  highFraudCategory: boolean;
  marketplace: string;
}): SignatureDecision {
  const outsideContiguous = input.destinationClass !== "CONTIGUOUS_US";
  const ebayMandatory =
    input.marketplace === "EBAY" &&
    input.totalPaidUsd >= protectionPolicyConfig.ebayMandatorySignatureThresholdUsd;
  const internalHighValue =
    input.totalPaidUsd >= protectionPolicyConfig.directSignatureThresholdUsd;
  const fraudThreshold =
    input.highFraudCategory &&
    input.totalPaidUsd >= protectionPolicyConfig.highFraudElectronicsSignatureThresholdUsd;

  const required = outsideContiguous || ebayMandatory || internalHighValue || fraudThreshold;
  const restricted =
    input.totalPaidUsd >= protectionPolicyConfig.restrictedDeliveryThresholdUsd;
  return {
    required,
    adultRequired: required && (input.totalPaidUsd >= 250 || input.highFraudCategory),
    restrictedDeliveryRequired: restricted,
    reasonCodes: [
      ...(outsideContiguous ? ["NON_CONTIGUOUS_SIGNATURE"] : []),
      ...(ebayMandatory ? ["EBAY_750_SIGNATURE_REQUIREMENT"] : []),
      ...(internalHighValue ? ["TCDS_HIGH_VALUE_SIGNATURE"] : []),
      ...(fraudThreshold ? ["HIGH_FRAUD_CATEGORY_SIGNATURE"] : []),
      ...(restricted ? ["RESTRICTED_DELIVERY_1000"] : [])
    ]
  };
}
