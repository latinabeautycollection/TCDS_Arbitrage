export function scoreLanePerformance(input?: {
  onTimeRate: number;
  exceptionRate: number;
  claimRate: number;
  sampleSize: number;
}): number {
  if (!input || input.sampleSize < 10) return 55;
  const confidence = Math.min(1, input.sampleSize / 100);
  const raw = input.onTimeRate * 100 - input.exceptionRate * 35 - input.claimRate * 50;
  return Math.max(0, Math.min(100, raw * confidence + 55 * (1 - confidence)));
}
