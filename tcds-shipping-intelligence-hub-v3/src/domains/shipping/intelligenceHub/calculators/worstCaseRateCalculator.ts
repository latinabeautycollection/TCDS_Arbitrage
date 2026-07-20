import type { DestinationClass } from "../models/destinationIntelligence";
import type { ZoneRateSnapshot } from "../models/pricingIntelligence";
import { isServiceEligible } from "../policies/serviceLevelPolicy";

export function calculateWorstCaseAnchorRate(
  snapshots: ZoneRateSnapshot[],
  destinationClass: DestinationClass = "CONTIGUOUS_US"
): {
  amountCents: number;
  anchorKey?: string;
  complete: boolean;
  reasonCodes: string[];
} {
  const perAnchor = snapshots.map((snapshot) => {
    const eligible = snapshot.batch.quotes
      .filter((q) => isServiceEligible(q, destinationClass))
      .sort((a, b) => a.totalChargeCents - b.totalChargeCents);
    return { snapshot, cheapestEligible: eligible[0] };
  });

  const missing = perAnchor.filter((x) => !x.cheapestEligible || !x.snapshot.batch.complete);
  const available = perAnchor.filter((x) => x.cheapestEligible);

  if (available.length === 0) {
    return { amountCents: 0, complete: false, reasonCodes: ["NO_ELIGIBLE_ZONE_QUOTES"] };
  }

  const worst = available.reduce((a, b) =>
    b.cheapestEligible!.totalChargeCents > a.cheapestEligible!.totalChargeCents ? b : a
  );

  return {
    amountCents: worst.cheapestEligible!.totalChargeCents,
    anchorKey: worst.snapshot.anchorKey,
    complete: missing.length === 0,
    reasonCodes: [
      "MAX_OF_CHEAPEST_ELIGIBLE_ANCHOR_RATES",
      ...(missing.length ? ["INCOMPLETE_ZONE_QUOTE_SET"] : [])
    ]
  };
}
