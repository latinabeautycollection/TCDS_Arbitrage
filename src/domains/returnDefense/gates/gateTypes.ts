
export type PreSaleGateStage =
  | "RETAIL_SOURCE_QUALITY"
  | "ACQUISITION_PROFIT_DEFENSE"
  | "SOURCE_RECOVERY_WINDOW"
  | "RECEIVING_IDENTITY"
  | "INVENTORY_INTEGRITY";

export interface GateEvaluation {
  riskScore: number;
  hardBlock: boolean;
  reasonCodes: string[];
  controls: Array<Record<string, unknown>>;
  recommendedGateStatus: "ALLOW"|"ALLOW_WITH_CONTROLS"|"REVIEW"|"HOLD"|"BLOCK";
}
