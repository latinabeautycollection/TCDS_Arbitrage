import type { RiskTier } from "../contracts/preventionControlPlane";

export function riskTierForScore(score: number): RiskTier {
  if (!Number.isFinite(score) || score < 0 || score > 100) {
    throw new RangeError("Risk score must be between 0 and 100");
  }
  if (score < 20) return "GREEN";
  if (score < 40) return "GUARDED";
  if (score < 60) return "ELEVATED";
  if (score < 80) return "HIGH";
  return "CRITICAL";
}
