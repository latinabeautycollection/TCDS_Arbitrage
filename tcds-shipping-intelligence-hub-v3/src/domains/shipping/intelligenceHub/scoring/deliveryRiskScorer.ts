export function scoreDeliveryRisk(input: {
  onTimeProbability?: number;
  trackingQualityScore?: number;
  destinationRiskScore: number;
  packageRiskScore: number;
}): number {
  const onTimePenalty = (1 - (input.onTimeProbability ?? 0.85)) * 45;
  const trackingPenalty = (100 - (input.trackingQualityScore ?? 60)) * 0.20;
  return Math.min(100,
    onTimePenalty + trackingPenalty + input.destinationRiskScore * 0.25 + input.packageRiskScore * 0.25
  );
}
