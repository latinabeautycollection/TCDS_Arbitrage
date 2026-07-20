export function scoreDecisionConfidence(input: {
  eligibleQuoteCount: number;
  zoneAnchorCount: number;
  addressValidated: boolean;
  dimensionsVerified: boolean;
  weightVerified: boolean;
  historicalSampleSize: number;
}): number {
  let score = 20;
  score += Math.min(20, input.eligibleQuoteCount * 4);
  score += Math.min(15, input.zoneAnchorCount * 5);
  if (input.addressValidated) score += 15;
  if (input.dimensionsVerified) score += 10;
  if (input.weightVerified) score += 10;
  score += Math.min(10, input.historicalSampleSize / 10);
  return Math.min(100, score);
}
