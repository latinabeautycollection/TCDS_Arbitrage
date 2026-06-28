import { getDhlEnv } from "../config/dhlEnv";
import { detectDhlTrackingRisk } from "../utils/dhlUtils";

export class DhlProfitProtectionEngine {
  private readonly env = getDhlEnv();

  scoreTracking(statusCode?: string, status?: string, daysSinceUpdate = 0) {
    const code = detectDhlTrackingRisk(statusCode, status);
    let riskScore =
      code === "DELIVERED" ? 5 :
      code === "FAILED" ? 90 :
      code === "RETURN" ? 80 :
      code === "CUSTOMS" ? 55 :
      code === "DELAYED" ? 70 :
      code === "PRE_TRANSIT" ? 35 : 25;

    riskScore = Math.min(100, riskScore + daysSinceUpdate * 5);

    return {
      carrier: "DHL" as const,
      selectedService: undefined,
      selectedPriceUsd: undefined,
      riskScore,
      profitScore: Math.max(0, 100 - riskScore),
      confidenceScore: 80,
      humanReviewRequired: riskScore >= this.env.DHL_HUMAN_REVIEW_RISK_SCORE,
      executiveHoldRequired: riskScore >= this.env.DHL_EXECUTIVE_HOLD_RISK_SCORE,
      reason: `DHL tracking risk classified as ${code}.`,
      raw: { statusCode, status, daysSinceUpdate, code },
    };
  }
}
