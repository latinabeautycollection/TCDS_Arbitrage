export function calculateRealizedShippingProfit(input: {
  shippingPaidUsd: number;
  labelCostUsd: number;
  insuranceCostUsd: number;
  signatureCostUsd: number;
  packagingCostUsd: number;
  adjustmentsUsd: number;
}): number {
  return input.shippingPaidUsd -
    input.labelCostUsd -
    input.insuranceCostUsd -
    input.signatureCostUsd -
    input.packagingCostUsd -
    input.adjustmentsUsd;
}
