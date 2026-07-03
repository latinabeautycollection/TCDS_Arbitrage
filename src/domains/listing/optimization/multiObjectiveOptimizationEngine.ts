import { MultiObjectiveScore, OptimizationObjectiveWeights, ProductDigitalTwin } from '../models/enterpriseListingTypes';

const DEFAULT_WEIGHTS: OptimizationObjectiveWeights = { seo: 0.18, conversion: 0.24, profit: 0.22, risk: 0.18, accountHealth: 0.10, velocity: 0.08 };

export class MultiObjectiveOptimizationEngine {
  score(twin: ProductDigitalTwin, weights: OptimizationObjectiveWeights = DEFAULT_WEIGHTS): MultiObjectiveScore {
    const seoScore = clamp((twin.listing.seoKeywords.length / 12) * 0.55 + Object.keys(twin.listing.itemSpecifics).length / 20 * 0.45);
    const conversionScore = clamp((twin.listing.conversionScore ?? 0.5) + (twin.photos.length >= 4 ? 0.1 : 0) + (twin.condition.defects.length > 0 ? 0.05 : 0));
    const profitScore = clamp(((twin.economics.marginPct ?? 20) / 45) * 0.6 + ((twin.economics.roiPct ?? 25) / 75) * 0.4);
    const riskAdjustedScore = clamp(1 - (twin.risk.returnRiskScore * 0.35 + twin.risk.disputeRiskScore * 0.45 + twin.risk.accountRiskScore * 0.20));
    const accountHealthScore = clamp(1 - twin.risk.accountRiskScore);
    const velocityScore = clamp(1 - Math.min((twin.market.expectedDaysToSell ?? 21) / 60, 1));
    const totalScore = clamp(seoScore * weights.seo + conversionScore * weights.conversion + profitScore * weights.profit + riskAdjustedScore * weights.risk + accountHealthScore * weights.accountHealth + velocityScore * weights.velocity);
    const explanation = [
      `SEO ${seoScore.toFixed(2)} based on keyword and item-specific coverage`,
      `Conversion ${conversionScore.toFixed(2)} based on image count, clarity, and disclosure`,
      `Profit ${profitScore.toFixed(2)} based on margin and ROI`,
      `Risk-adjusted ${riskAdjustedScore.toFixed(2)} based on return/dispute/account risk`,
      `Velocity ${velocityScore.toFixed(2)} based on expected days to sell`,
    ];
    return { seoScore, conversionScore, profitScore, riskAdjustedScore, accountHealthScore, velocityScore, totalScore, explanation };
  }
}
function clamp(n: number): number { return Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0)); }
