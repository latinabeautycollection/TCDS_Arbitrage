export const riskThresholdConfig = {
  autoApproveMax: 39,
  aiReviewMin: 40,
  humanReviewMin: 70,
  executiveHoldMin: 85,
  highClaimProbability: 0.12,
  weakOnTimeProbability: 0.90,
  weakTrackingQualityScore: 70,
  maxDimAdjustmentRiskScore: 50,
  maxFraudScoreForAutoApproval: 45
} as const;
