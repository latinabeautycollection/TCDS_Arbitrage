export type ShipmentValueBand = "LOW" | "INSURED" | "HIGH_VALUE" | "EBAY_SIGNATURE" | "RESTRICTED";

export function classifyShipmentValue(totalPaidUsd: number): ShipmentValueBand {
  if (totalPaidUsd >= 1000) return "RESTRICTED";
  if (totalPaidUsd >= 750) return "EBAY_SIGNATURE";
  if (totalPaidUsd >= 250) return "HIGH_VALUE";
  if (totalPaidUsd >= 100) return "INSURED";
  return "LOW";
}
