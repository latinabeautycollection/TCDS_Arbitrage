export function evaluateProfitFloor(input: {
  worstCaseNetProfitUsd: number;
  expectedSaleRevenueUsd: number;
  minimumNetProfitUsd: number;
  minimumMarginPct: number;
}): { passed: boolean; marginPct: number; reasonCodes: string[] } {
  const marginPct = input.expectedSaleRevenueUsd > 0
    ? (input.worstCaseNetProfitUsd / input.expectedSaleRevenueUsd) * 100
    : -100;
  const passed =
    input.worstCaseNetProfitUsd >= input.minimumNetProfitUsd &&
    marginPct >= input.minimumMarginPct;
  return {
    passed,
    marginPct,
    reasonCodes: passed ? [] : ["PROTECTED_PROFIT_FLOOR_FAILED"]
  };
}
