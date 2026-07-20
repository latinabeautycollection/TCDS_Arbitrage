export interface RiskDecision {
  totalRiskScore: number;
  deliveryRiskScore: number;
  fraudRiskScore: number;
  claimRiskScore: number;
  adjustmentRiskScore: number;
  weatherRiskScore: number;
  riskBand: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  reasonCodes: string[];
}
