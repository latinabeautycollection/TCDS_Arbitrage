export function calculateSurchargeReserve(input: {
  quotedSurchargeUsd?: number;
  remoteArea: boolean;
  residential: boolean;
  protectedBaseRateUsd: number;
}): number {
  const explicit = Math.max(0, input.quotedSurchargeUsd ?? 0);
  const remoteReserve = input.remoteArea ? Math.max(5, input.protectedBaseRateUsd * 0.08) : 0;
  const residentialReserve = input.residential ? Math.max(2, input.protectedBaseRateUsd * 0.03) : 0;
  return explicit + remoteReserve + residentialReserve;
}
