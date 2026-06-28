import type { AcquisitionCategoryPolicy, CompSelectionResult, FinancialModelOutput, MarketProfile, NormalizedIdentity, RuleEvaluation, SafetyEvaluation } from '../contracts/acquisitionDecision';

export function evaluateAcquisitionRules(input: {
  identity: NormalizedIdentity;
  comps: CompSelectionResult;
  market: MarketProfile;
  financial: FinancialModelOutput;
  policy: AcquisitionCategoryPolicy;
  safety: SafetyEvaluation;
  relativeStrength?: number;
}): RuleEvaluation {
  const reasonCodes: string[] = [];
  const riskFlags: string[] = [];
  const reviewReasons: string[] = [];
  const rejectReasons: string[] = [];

  if (input.safety.blockingReasons.length) rejectReasons.push(...input.safety.blockingReasons.map(prefix('CAPITAL_SAFETY')));
  if (input.safety.reviewReasons.length || !input.safety.ok) {
    reviewReasons.push(...input.safety.reviewReasons.map(prefix('CAPITAL_SAFETY_REVIEW')));
  }
  if (input.identity.identityConfidence < input.policy.minIdentityConfidence) reviewReasons.push('LOW_IDENTITY_CONFIDENCE');
  if (input.identity.conditionState === 'parts_only') rejectReasons.push('PARTS_ONLY_OR_REPAIR');
  if (input.identity.bundleState === 'accessory_only') rejectReasons.push('ACCESSORY_ONLY');
  if (input.identity.requiredAttributesMissing.length > 0) reviewReasons.push(...input.identity.requiredAttributesMissing);
  if (input.comps.compQualityScore < input.policy.minCompQuality) reviewReasons.push('LOW_COMP_QUALITY');
  if (input.market.soldCount < input.policy.minSoldCount) reviewReasons.push('LOW_SOLD_COMP_COUNT');
  if (input.market.activeToSoldRatio !== null && input.market.activeToSoldRatio > input.policy.maxActiveSoldRatio) rejectReasons.push('HIGH_ACTIVE_TO_SOLD_RATIO');
  if (input.market.volatilityScore > input.policy.maxVolatility) reviewReasons.push('HIGH_VOLATILITY');
  if (input.market.estimatedDaysToSale !== null && input.market.estimatedDaysToSale > 90) reviewReasons.push('SLOW_SELL_THROUGH');
  if (!['shipengine','policy_estimate'].includes(input.financial.shippingSignal.source)) reviewReasons.push('SHIPENGINE_RATE_REQUIRED_FOR_BUY');
  if (input.financial.shippingSignal.confidence < 0.7 && input.financial.shippingSignal.source !== 'policy_estimate') reviewReasons.push('SHIPPING_UNCERTAINTY');
  if (input.financial.estimatedProfitUsd === null || input.financial.estimatedProfitUsd < input.policy.minProfitUsd) rejectReasons.push('INSUFFICIENT_PROFIT');
  if (input.financial.estimatedRoi === null || input.financial.estimatedRoi < input.policy.minRoi) rejectReasons.push('ROI_BELOW_THRESHOLD');
  if (input.financial.deployableUnits <= 0) rejectReasons.push('NO_DEPLOYABLE_UNITS');
  if ((input.financial.estimatedProfitUsd ?? 0) > input.policy.minProfitUsd * input.policy.highProfitReviewMultiplier && input.comps.compQualityScore < 0.80) reviewReasons.push('REVIEW_REQUIRED_OUTLIER_PROFIT');

  reasonCodes.push(...input.comps.reasonCodes);
  riskFlags.push(...input.comps.riskFlags, ...input.identity.ambiguityFlags, ...input.financial.shippingSignal.riskFlags, ...rejectReasons, ...reviewReasons);

  const confidenceScore = confidence(input.identity.identityConfidence, input.comps.compQualityScore, input.market.liquidityScore, 1 - input.market.volatilityScore, input.safety.safetyScore);
  const riskScore = risk(input.market.volatilityScore, input.market.saturationScore, 1 - input.financial.shippingSignal.confidence, riskFlags.length);
  const priorityScore = priority(input.financial, input.market, confidenceScore, riskScore, input.policy.categoryRankWeight, input.relativeStrength ?? 1);
  let status: RuleEvaluation['status'] = 'REJECT';
  if (rejectReasons.length === 0 && reviewReasons.length === 0 && confidenceScore >= input.policy.minIdentityConfidence && input.safety.ok && input.safety.safetyScore >= input.policy.minSafetyScoreForBuy && ['shipengine','policy_estimate'].includes(input.financial.shippingSignal.source)) status = 'BUY';
  else if (rejectReasons.length === 0 && (input.financial.estimatedProfitUsd ?? 0) > 0) status = 'REVIEW';
  else if ((input.financial.estimatedProfitUsd ?? 0) > 0 && input.market.soldCount >= Math.max(2, Math.floor(input.policy.minSoldCount / 2))) status = 'WATCH';

  if (status === 'BUY') reasonCodes.push('BUY_RULES_PASSED');
  if (status === 'REVIEW') reasonCodes.push('REVIEW_REQUIRED');
  if (status === 'WATCH') reasonCodes.push('WATCH_ONLY');
  if (status === 'REJECT') reasonCodes.push('REJECT_RULES_HIT');

  return { status, rank: rank(status, priorityScore, input.financial.estimatedRoi ?? 0), reasonCodes: unique(reasonCodes), riskFlags: unique(riskFlags), confidenceScore: round(confidenceScore, 4), confidenceBand: confidenceScore >= 0.82 ? 'HIGH' : confidenceScore >= 0.65 ? 'MEDIUM' : 'LOW', riskScore: round(riskScore, 4), priorityScore: round(priorityScore, 4), explanationSummary: summarize(status, input.financial.estimatedProfitUsd, input.financial.estimatedRoi, confidenceScore, rejectReasons, reviewReasons) };
}

function confidence(...values: number[]): number { return clamp(values.reduce((a,b)=>a+b,0) / values.length, 0, 1); }
function risk(volatility: number, saturation: number, shippingUncertainty: number, flagCount: number): number { return clamp(volatility * 0.30 + saturation * 0.25 + shippingUncertainty * 0.20 + Math.min(1, flagCount / 12) * 0.25, 0, 1); }
function priority(financial: FinancialModelOutput, market: MarketProfile, confidenceScore: number, riskScore: number, categoryWeight: number, relativeStrength: number): number { const profit = normalize(financial.deployableProfitUsd, 0, 500); const roi = normalize(financial.estimatedRoi ?? 0, 0, 0.8); const velocity = normalize(financial.velocityEfficiency ?? 0, 0, 20); const liquidity = market.liquidityScore; const capital = normalize(financial.capitalEfficiency ?? 0, 0, 0.8); return clamp((profit * 0.26 + roi * 0.18 + velocity * 0.16 + liquidity * 0.14 + capital * 0.12 + confidenceScore * 0.14) * 100 * categoryWeight * relativeStrength * (1 - riskScore * 0.45), 0, 100); }
function rank(status: RuleEvaluation['status'], priorityScore: number, roi: number): RuleEvaluation['rank'] { if (status === 'BUY') { if (priorityScore >= 85 && roi >= 0.45) return 'BUY_A_PLUS'; if (priorityScore >= 70) return 'BUY_A'; return 'BUY_B'; } if (status === 'WATCH') return priorityScore >= 55 ? 'WATCH_A' : 'WATCH_B'; if (status === 'REVIEW') return 'REVIEW'; return 'REJECT'; }
function summarize(status: string, profit: number | null, roi: number | null, confidenceScore: number, rejects: string[], reviews: string[]): string { const parts = [`${status} decision`, `profit=${profit ?? 'n/a'}`, `roi=${roi ?? 'n/a'}`, `confidence=${round(confidenceScore,2)}`]; if (rejects.length) parts.push(`reject=${rejects.slice(0,3).join(',')}`); if (reviews.length) parts.push(`review=${reviews.slice(0,3).join(',')}`); return parts.join(' | '); }
function prefix(p: string) { return (v: string) => `${p}_${v}`; }
function unique<T>(arr: T[]): T[] { return Array.from(new Set(arr)); }
function normalize(value: number, min: number, max: number): number { return clamp((value - min) / Math.max(0.0001, max - min), 0, 1); }
function round(value: number, places = 2): number { const factor = 10 ** places; return Math.round(value * factor) / factor; }
function clamp(value: number, min: number, max: number): number { return Math.min(max, Math.max(min, value)); }
