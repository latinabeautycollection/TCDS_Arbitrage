export class UspsLearningEngine {
  computeLaneRisk(args: { delayRate?: number; lossRate?: number; damageRate?: number; returnRate?: number; claimRate?: number }): number {
    return Math.max(0, Math.min(100, (args.delayRate ?? 0)*20 + (args.lossRate ?? 0)*35 + (args.damageRate ?? 0)*25 + (args.returnRate ?? 0)*10 + (args.claimRate ?? 0)*10));
  }
  computeRecommendationScore(args: { onTimeRate?: number; claimSuccessRate?: number; riskScore?: number; avgProfitLeakageUsd?: number }): number {
    return Math.max(0, Math.min(100, (args.onTimeRate ?? 0.75)*40 + (args.claimSuccessRate ?? 0.5)*20 + (100-(args.riskScore ?? 50))*0.35 - Math.min(args.avgProfitLeakageUsd ?? 0, 50)*0.5));
  }
}
