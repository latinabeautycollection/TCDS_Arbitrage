export function calculateShippingMargin(
  shippingPaidUsd: number,
  protectedShippingChargeUsd: number
): number {
  return shippingPaidUsd - protectedShippingChargeUsd;
}
