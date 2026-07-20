export function calculateSignatureReserve(input: {
  required: boolean;
  adultRequired: boolean;
  restrictedDeliveryRequired: boolean;
}): number {
  if (!input.required) return 0;
  if (input.restrictedDeliveryRequired) return 12;
  if (input.adultRequired) return 8;
  return 6;
}
