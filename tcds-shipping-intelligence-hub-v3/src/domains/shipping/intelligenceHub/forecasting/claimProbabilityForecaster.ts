export function forecastClaimProbability(input: {
  carrierClaimRate?: number;
  laneClaimRate?: number;
  categoryDamageRate?: number;
  fraudScore: number;
  packageRiskScore: number;
}): number {
  const base = Math.max(input.carrierClaimRate ?? 0.01, input.laneClaimRate ?? 0.01);
  const probability =
    base +
    (input.categoryDamageRate ?? 0) * 0.35 +
    input.fraudScore / 1000 +
    input.packageRiskScore / 1200;
  return Math.min(0.95, Math.max(0, probability));
}
