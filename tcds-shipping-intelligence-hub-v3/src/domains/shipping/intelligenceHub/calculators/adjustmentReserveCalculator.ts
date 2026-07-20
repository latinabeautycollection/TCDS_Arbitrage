export function calculateAdjustmentReserve(input: {
  protectedBaseRateUsd: number;
  dimensionsVerified: boolean;
  weightVerified: boolean;
  historicalVariancePct?: number;
}): number {
  let pct = Math.max(0.03, input.historicalVariancePct ?? 0.05);
  if (!input.dimensionsVerified) pct += 0.10;
  if (!input.weightVerified) pct += 0.08;
  return input.protectedBaseRateUsd * Math.min(pct, 0.30);
}
