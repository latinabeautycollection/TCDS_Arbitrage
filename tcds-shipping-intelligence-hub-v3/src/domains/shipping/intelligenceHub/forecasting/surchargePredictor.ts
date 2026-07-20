export function predictSurchargeUsd(input: {
  baseRateUsd: number;
  residential: boolean;
  remoteArea: boolean;
  oversize: boolean;
}): number {
  return (input.residential ? Math.max(2, input.baseRateUsd * 0.03) : 0) +
    (input.remoteArea ? Math.max(5, input.baseRateUsd * 0.08) : 0) +
    (input.oversize ? Math.max(15, input.baseRateUsd * 0.20) : 0);
}
