import type { DestinationIntelligence } from "../models/destinationIntelligence";

export function evaluateDestinationEligibility(destination: DestinationIntelligence): {
  eligible: boolean;
  manualReview: boolean;
  reasonCodes: string[];
} {
  if (!destination.eligible) return { eligible: false, manualReview: false, reasonCodes: destination.reasonCodes };
  if (destination.destinationClass === "APO_FPO_DPO") {
    return { eligible: false, manualReview: true, reasonCodes: ["MILITARY_ADDRESS_MANUAL_REVIEW"] };
  }
  if (destination.destinationClass === "INTERNATIONAL_OTHER") {
    return { eligible: false, manualReview: true, reasonCodes: ["EBAY_INTERNATIONAL_SHIPPING_REQUIRED"] };
  }
  return { eligible: true, manualReview: false, reasonCodes: [] };
}
