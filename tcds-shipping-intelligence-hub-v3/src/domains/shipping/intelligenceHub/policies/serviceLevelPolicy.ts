import type { DestinationClass } from "../models/destinationIntelligence";
import type { RateQuote } from "../models/pricingIntelligence";

export function isServiceEligible(
  quote: RateQuote,
  destinationClass: DestinationClass
): boolean {
  const days = quote.estimatedDeliveryBusinessDays;
  if (!Number.isFinite(days) || days === undefined || days < 0) return false;

  if (destinationClass === "CONTIGUOUS_US") {
    return days <= 2 && quote.commitmentType !== "UNKNOWN";
  }

  if (["ALASKA", "HAWAII", "PUERTO_RICO", "USVI", "GUAM", "CANADA"].includes(destinationClass)) {
    return days <= 7;
  }

  return false;
}
