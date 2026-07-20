export function forecastShippingCost(input: {
  currentQuoteUsd: number;
  recentAverageUsd?: number;
  recentP90Usd?: number;
  fuelTrendPct?: number;
  seasonalMultiplier?: number;
}): { expectedUsd: number; conservativeUsd: number } {
  const seasonal = Math.max(1, input.seasonalMultiplier ?? 1);
  const fuel = 1 + Math.max(0, input.fuelTrendPct ?? 0);
  const expectedBase = input.recentAverageUsd ?? input.currentQuoteUsd;
  const conservativeBase = Math.max(input.currentQuoteUsd, input.recentP90Usd ?? input.currentQuoteUsd);
  return {
    expectedUsd: expectedBase * seasonal * fuel,
    conservativeUsd: conservativeBase * seasonal * fuel
  };
}
