export interface ProfitDecision {
  expectedShippingCostCents: number;
  protectedShippingCostCents: number;
  expectedNetProfitCents: number;
  worstCaseNetProfitCents: number;
  expectedMarginPct: number;
  worstCaseMarginPct: number;
  profitFloorCents: number;
  profitFloorPassed: boolean;
  repriceRequired: boolean;
  additionalShippingChargeRequiredCents: number;
  reasonCodes: string[];
}
