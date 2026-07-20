export function calculateProtectedShippingCharge(input: {
  protectedBaseRateUsd: number;
  insuranceCostUsd: number;
  signatureCostUsd: number;
  surchargeReserveUsd: number;
  adjustmentReserveUsd: number;
  zoneProtectionBufferPct: number;
}): number {
  const subtotal =
    input.protectedBaseRateUsd +
    input.insuranceCostUsd +
    input.signatureCostUsd +
    input.surchargeReserveUsd +
    input.adjustmentReserveUsd;
  return subtotal * (1 + Math.max(0, input.zoneProtectionBufferPct));
}
