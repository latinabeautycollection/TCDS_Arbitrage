export interface CarrierPerformance {
  onTimeDeliveryRate: number;
  lateDeliveryRate: number;
  exceptionRate: number;
  inrRiskRate: number;
  damageClaimRate: number;
}

export function scoreCarrierReliability(perf?: CarrierPerformance): number {
  if (!perf) return 60;
  const score =
    perf.onTimeDeliveryRate * 100 -
    perf.lateDeliveryRate * 35 -
    perf.exceptionRate * 40 -
    perf.inrRiskRate * 50 -
    perf.damageClaimRate * 50;
  return Math.max(0, Math.min(100, score));
}
