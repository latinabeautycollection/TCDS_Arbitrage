import type { RateQuote } from "../models/pricingIntelligence";

export function carrierMeetsProtectionRequirements(
  quote: RateQuote,
  requirements: {
    signatureRequired: boolean;
    adultSignatureRequired: boolean;
    restrictedDeliveryRequired: boolean;
    insuranceRequired: boolean;
    insuranceMechanism: "NONE" | "THIRD_PARTY" | "CARRIER_DECLARED_VALUE";
    insuredValueCents: number;
  }
): boolean {
  if (quote.purpose !== "ACTUAL_DESTINATION") return false;
  if (requirements.signatureRequired && !quote.supportsSignature) return false;
  if (requirements.adultSignatureRequired && !quote.supportsAdultSignature) return false;
  if (requirements.restrictedDeliveryRequired && !quote.supportsRestrictedDelivery) return false;

  if (requirements.insuranceRequired && requirements.insuranceMechanism === "CARRIER_DECLARED_VALUE") {
    if (!quote.insuranceMechanisms.includes("CARRIER_DECLARED_VALUE")) return false;
    if ((quote.declaredValueLimitCents ?? 0) < requirements.insuredValueCents) return false;
  }

  return true;
}
