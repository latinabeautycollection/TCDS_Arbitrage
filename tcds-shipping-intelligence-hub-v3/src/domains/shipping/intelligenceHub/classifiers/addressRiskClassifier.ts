import type { AddressInput } from "../models/intelligenceContext";
import type { DestinationIntelligence } from "../models/destinationIntelligence";

export function classifyAddressRisk(
  address: AddressInput,
  destination: DestinationIntelligence
): { riskScore: number; reasonCodes: string[] } {
  let score = 0;
  const reasons: string[] = [];

  if (!address.verifiedMarketplaceAddress) {
    score += 40;
    reasons.push("UNVERIFIED_MARKETPLACE_ADDRESS");
  }
  if (destination.mailboxClass !== "PHYSICAL") {
    score += 45;
    reasons.push(`MAILBOX_${destination.mailboxClass}`);
  }
  if (destination.destinationClass !== "CONTIGUOUS_US") {
    score += 15;
    reasons.push("EXTENDED_OR_INTERNATIONAL_DESTINATION");
  }
  if (!address.line2 && /\b(APT|UNIT|STE|SUITE)\b/i.test(address.line1)) {
    score += 10;
    reasons.push("SECONDARY_ADDRESS_AMBIGUITY");
  }
  return { riskScore: Math.min(score, 100), reasonCodes: reasons };
}
