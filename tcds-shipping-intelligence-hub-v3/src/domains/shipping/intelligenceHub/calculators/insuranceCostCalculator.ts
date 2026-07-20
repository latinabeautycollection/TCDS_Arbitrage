export function calculateInsuranceCost(
  insuredValueUsd: number,
  thirdPartyRatePerHundredUsd = 0.80,
  minimumPremiumUsd = 1.25
): number {
  if (insuredValueUsd <= 0) return 0;
  return Math.max(minimumPremiumUsd, Math.ceil(insuredValueUsd / 100) * thirdPartyRatePerHundredUsd);
}
