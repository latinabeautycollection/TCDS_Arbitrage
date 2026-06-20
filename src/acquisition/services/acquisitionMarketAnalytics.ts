import type { CompSelectionResult, MarketProfile } from '../contracts/acquisitionDecision';

export function computeAcquisitionMarketProfile(comps: CompSelectionResult): MarketProfile {
  const soldPrices = comps.soldComps.map((c) => c.priceUsd).filter(valid).sort((a,b)=>a-b);
  const activePrices = comps.activeComps.map((c) => c.priceUsd).filter(valid).sort((a,b)=>a-b);
  const soldCount = soldPrices.length;
  const activeCount = activePrices.length;
  const soldMedian = quantile(soldPrices, 0.5);
  const soldP25 = quantile(soldPrices, 0.25);
  const soldP75 = quantile(soldPrices, 0.75);
  const activeMedian = quantile(activePrices, 0.5);
  const activeToSoldRatio = soldCount > 0 ? round(activeCount / soldCount, 4) : null;
  const sellThroughRate = soldCount + activeCount > 0 ? round(soldCount / (soldCount + activeCount), 4) : 0;
  const volatilityScore = computeVolatility(soldP25, soldP75, soldMedian);
  const saturationScore = activeToSoldRatio === null ? 1 : clamp(activeToSoldRatio / 5, 0, 1);
  const liquidityScore = clamp((sellThroughRate * 0.55) + (Math.min(soldCount / 20, 1) * 0.35) + ((1 - saturationScore) * 0.10), 0, 1);
  const estimatedDaysToSale = soldCount > 0 ? Math.max(3, Math.round(30 / Math.max(0.05, sellThroughRate))) : null;
  return { soldCount, activeCount, activeToSoldRatio, sellThroughRate, soldMedian, soldP25, soldP75, activeMedian, volatilityScore, saturationScore, liquidityScore: round(liquidityScore, 4), estimatedDaysToSale };
}
function computeVolatility(p25: number | null, p75: number | null, median: number | null): number { if (!p25 || !p75 || !median || median <= 0) return 1; return clamp(round((p75 - p25) / median, 4), 0, 1); }
function valid(v: number): boolean { return Number.isFinite(v) && v > 0; }
function quantile(values: number[], q: number): number | null { if (!values.length) return null; const pos = (values.length - 1) * q; const base = Math.floor(pos); const rest = pos - base; const lower = values[base]!; const upper = values[base + 1] ?? lower; return round(lower + rest * (upper - lower), 2); }
function clamp(v: number, min: number, max: number): number { return Math.max(min, Math.min(max, v)); }
function round(v: number, p = 2): number { const f = 10 ** p; return Math.round(v * f) / f; }
