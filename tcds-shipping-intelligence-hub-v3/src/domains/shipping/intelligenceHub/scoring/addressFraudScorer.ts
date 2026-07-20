export function scoreAddressFraud(input: {
  verifiedMarketplaceAddress: boolean;
  mailboxBlocked: boolean;
  freightForwarder: boolean;
  highFraudCategory: boolean;
  totalPaidUsd: number;
}): number {
  let score = 0;
  if (!input.verifiedMarketplaceAddress) score += 55;
  if (input.mailboxBlocked) score += 45;
  if (input.freightForwarder) score += 35;
  if (input.highFraudCategory && input.totalPaidUsd >= 250) score += 20;
  return Math.min(100, score);
}
