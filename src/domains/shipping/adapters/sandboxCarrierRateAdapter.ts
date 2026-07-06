import type { CarrierRateAdapter } from "../engines/shippingDestinationModelEngine";

// Rough VA-origin destination zones (sandbox-only, deterministic).
const FAR_WEST = new Set(["CA","OR","WA","NV","AZ","ID","UT","MT","WY","AK","HI"]);
const MID = new Set(["TX","CO","NM","ND","SD","NE","KS","OK","MN","IA","MO","AR","LA","WI","IL"]);

function zoneMultiplier(state: string): number {
  const s = (state || "").toUpperCase();
  if (FAR_WEST.has(s)) return 1.7;
  if (MID.has(s)) return 1.3;
  return 1.0;
}
function round2(n: number): number { return Math.round((n + Number.EPSILON) * 100) / 100; }

/**
 * Deterministic SANDBOX rate adapter: synthetic, repeatable rates from package
 * weight + VA-origin zone. No real carrier API calls. Swap for a live carrier
 * adapter (ShipEngine/USPS) when going to production.
 */
export const sandboxCarrierRateAdapter: CarrierRateAdapter = {
  async getRates({ destination, package: pkg }) {
    const weightLbs = Math.max(0.25, Number((pkg as any).weightLbs ?? (pkg as any).weight_lbs ?? 1));
    const zone = zoneMultiplier((destination as any).stateCode);
    const usps = round2(7.5 + 0.9 * weightLbs * zone);
    const fedex = round2(9.0 + 1.05 * weightLbs * zone);
    const days = 2 + Math.round(zone);
    return [
      { carrierCode: "USPS",  serviceCode: "GROUND_ADVANTAGE", serviceName: "USPS Ground Advantage", quotedCostUsd: usps,  estimatedDeliveryDays: days + 1, rawRateJson: { sandbox: true, weightLbs, zone } },
      { carrierCode: "FEDEX", serviceCode: "GROUND",           serviceName: "FedEx Ground",           quotedCostUsd: fedex, estimatedDeliveryDays: days,     rawRateJson: { sandbox: true, weightLbs, zone } },
    ];
  },
};
