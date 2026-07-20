export interface PricingZoneAnchor {
  key: string;
  stateCode: string;
  postalCode: string;
  label: string;
  enabled: boolean;
}

export const pricingZoneAnchors: readonly PricingZoneAnchor[] = [
  { key: "CALIFORNIA", stateCode: "CA", postalCode: "95814", label: "California West", enabled: true },
  { key: "FLORIDA", stateCode: "FL", postalCode: "33101", label: "Florida South", enabled: true },
  { key: "WISCONSIN", stateCode: "WI", postalCode: "53202", label: "Wisconsin Midwest", enabled: true }
];

export const pricingZonePolicy = {
  useHighestEligibleAnchorRate: true,
  minimumAnchorCount: 3,
  staleAfterHours: 24,
  remoteSurchargePassThrough: true,
  zoneProtectionBufferPct: 0.05
} as const;
