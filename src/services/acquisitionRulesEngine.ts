import type {
  AcquisitionCategoryPolicy,
  CompSelectionResult,
  EconomicRuleEvaluation,
  FinancialModelOutput,
  MarketProfile,
  NormalizedIdentity,
  RuleEvaluation,
  SafetyEvaluation,
} from '../contracts/acquisitionDecision';

/**
 * Acquisition Rules Engine — Green Tier 1 production rewrite.
 *
 * Key change from previous version:
 * - Hard blockers reject.
 * - Soft blockers review, but do not erase BUY economics.
 * - ShipEngine is preferred, not mandatory, when margin and confidence are strong.
 */

const HARD_SAFETY_BLOCKERS = new Set<string>([
  'CAPITAL_GATE_LISTING_NOT_LIVE',
  'CAPITAL_GATE_NOT_DEDUPE_PRIMARY',
  'CAPITAL_GATE_BUDGET_EXCEEDED',
  'CAPITAL_GATE_BANNED_CATEGORY',
  'CAPITAL_GATE_ZERO_ACCEPTED_COMPS',
  'CAPITAL_GATE_NO_ACCEPTED_COMPS',
  'CAPITAL_GATE_PRICE_EXCEEDS_MAX_BID',
  'CAPITAL_GATE_AUCTION_EXPIRED',
  'REPLAY_CERTIFICATION_FAILED',
]);

export function evaluateAcquisitionRules(input: {
  identity: NormalizedIdentity;
  comps: CompSelectionResult;
  market: MarketProfile;
  financial: FinancialModelOutput;
  policy: AcquisitionCategoryPolicy;
  safety: SafetyEvaluation;
  relativeStrength?: number;
}): EconomicRuleEvaluation {
  const reasonCodes: string[] = [...input.comps.reasonCodes];
  const riskFlags: string[] = [
    ...input.comps.riskFlags,
    ...input.identity.ambiguityFlags,
    ...input.financial.shippingSignal.riskFlags,
  ];
  const reviewReasons: string[] = [];
  const rejectReasons: string[] = [];

  for (const reason of input.safety.blockingReasons.map(normalizeReason)) {
    if (HARD_SAFETY_BLOCKERS.has(reason)) rejectReasons.push(reason);
    else reviewReasons.push(reason);
  }
  reviewReasons.push(...input.safety.reviewReasons.map(normalizeReason));

  if (input.identity.conditionState === 'parts_only') rejectReasons.push('PARTS_ONLY_OR_REPAIR');
  if (input.identity.bundleState === 'accessory_only') rejectReasons.push('ACCESSORY_ONLY');

  if (input.identity.identityConfidence < input.policy.minIdentityConfidence) reviewReasons.push('LOW_IDENTITY_CONFIDENCE');
  if (input.identity.requiredAttributesMissing.length > 0) reviewReasons.push(...input.identity.requiredAttributesMissing);

  if (input.comps.acceptedComps.length === 0 || input.market.soldCount === 0) rejectReasons.push('NO_ACCEPTED_SOLD_COMPS');
  else if (input.market.soldCount < input.policy.minSoldCount) reviewReasons.push('LOW_SOLD_COMP_COUNT');

  if (input.comps.compQualityScore < input.policy.minCompQuality) reviewReasons.push('LOW_COMP_QUALITY');
  if (input.market.activeToSoldRatio !== null && input.market.activeToSoldRatio > input.policy.maxActiveSoldRatio) rejectReasons.push('HIGH_ACTIVE_TO_SOLD_RATIO');
  if (input.market.volatilityScore > input.policy.maxVolatility) reviewReasons.push('HIGH_VOLATILITY');
  if (input.market.estimatedDaysToSale !== null && input.market.estimatedDaysToSale > 90) reviewReasons.push('SLOW_SELL_THROUGH');

  const shippingMissing = input.financial.shippingSignal.source !== 'shipengine';
  const shippingLowConfidence = input.financial.shippingSignal.confidence < 0.70;
  if (shippingMissing) reviewReasons.push('SHIPENGINE_RATE_NOT_CONFIRMED');
  if (shippingLowConfidence) reviewReasons.push('SHIPPING_UNCERTAINTY');

  if (input.financial.estimatedProfitUsd === null || input.financial.estimatedProfitUsd < input.policy.minProfitUsd) {
    rejectReasons.push('INSUFFICIENT_PROFIT');
  }
  if (input.financial.estimatedRoi === null || input.financial.estimatedRoi < input.policy.minRoi) {
    rejectReasons.push('ROI_BELOW_THRESHOLD');
  }
  if (input.financial.deployableUnits <= 0) rejectReasons.push('NO_DEPLOYABLE_UNITS');

  const outlierProfit = (input.financial.estimatedProfitUsd ?? 0) > input.policy.minProfitUsd * input.policy.highProfitReviewMultiplier;
  if (outlierProfit && input.comps.compQualityScore < 0.72) reviewReasons.push('REVIEW_REQUIRED_OUTLIER_PROFIT');

  const confidenceScore = confidence(
    input.identity.identityConfidence,
    input.comps.compQualityScore,
    input.market.liquidityScore,
    1 - input.market.volatilityScore,
    input.safety.safetyScore,
    input.financial.shippingSignal.confidence,
  );
  const riskScore = risk(
    input.market.volatilityScore,
    input.market.saturationScore,
    1 - input.financial.shippingSignal.confidence,
    unique([...riskFlags, ...rejectReasons, ...reviewReasons]).length,
  );
  const priorityScore = priority(
    input.financial,
    input.market,
    confidenceScore,
    riskScore,
    input.policy.categoryRankWeight,
    input.relativeStrength ?? 1,
  );

  const buyEconomicsPassed = rejectReasons.length === 0
    && (input.financial.estimatedProfitUsd ?? 0) >= input.policy.minProfitUsd
    && (input.financial.estimatedRoi ?? 0) >= input.policy.minRoi
    && input.financial.deployableUnits > 0;

  const buyConfidencePassed = confidenceScore >= Math.max(0.64, input.policy.minIdentityConfidence - 0.05)
    && input.identity.identityConfidence >= Math.max(0.60, input.policy.minIdentityConfidence - 0.10)
    && input.comps.compQualityScore >= Math.max(0.58, input.policy.minCompQuality - 0.12)
    && input.safety.ok;

  const autoBuyReady = buyEconomicsPassed
    && buyConfidencePassed
    && input.safety.blockingReasons.length === 0
    && input.safety.safetyScore >= Math.max(0.55, input.policy.minSafetyScoreForBuy - 0.15)
    && !(shippingMissing && input.financial.shippingSignal.confidence < 0.50);

  let status: RuleEvaluation['status'];
  if (autoBuyReady) status = 'BUY';
  else if (rejectReasons.length === 0 && (input.financial.estimatedProfitUsd ?? 0) > 0) status = 'REVIEW';
  else if ((input.financial.estimatedProfitUsd ?? 0) > 0 && input.market.soldCount >= Math.max(2, Math.floor(input.policy.minSoldCount / 2))) status = 'WATCH';
  else status = 'REJECT';

  if (status === 'BUY' && reviewReasons.length > 0) {
    reasonCodes.push('BUY_WITH_SOFT_REVIEW_WARNINGS');
  }
  if (status === 'BUY') reasonCodes.push('BUY_RULES_PASSED');
  if (status === 'REVIEW') reasonCodes.push('REVIEW_REQUIRED');
  if (status === 'WATCH') reasonCodes.push('WATCH_ONLY');
  if (status === 'REJECT') reasonCodes.push('REJECT_RULES_HIT');

  reasonCodes.push(...rejectReasons.map(prefix('REJECT')));
  reasonCodes.push(...reviewReasons.map(prefix('REVIEW')));

  return {
    status,
    rank: rank(status, priorityScore, input.financial.estimatedRoi ?? 0),
    reasonCodes: unique(reasonCodes.map(normalizeReason)),
    riskFlags: unique([...riskFlags, ...rejectReasons, ...reviewReasons].map(normalizeReason)),
    confidenceScore: round(confidenceScore, 4),
    confidenceBand: confidenceScore >= 0.82 ? 'HIGH' : confidenceScore >= 0.65 ? 'MEDIUM' : 'LOW',
    riskScore: round(riskScore, 4),
    priorityScore: round(priorityScore, 4),
    explanationSummary: summarize(status, input.financial.estimatedProfitUsd, input.financial.estimatedRoi, confidenceScore, rejectReasons, reviewReasons),
  };
}

function confidence(...values: number[]): number {
  const valid = values.filter((value) => Number.isFinite(value));
  return clamp(valid.reduce((sum, value) => sum + value, 0) / Math.max(1, valid.length), 0, 1);
}

function risk(volatility: number, saturation: number, shippingUncertainty: number, flagCount: number): number {
  return clamp(volatility * 0.28 + saturation * 0.22 + shippingUncertainty * 0.18 + Math.min(1, flagCount / 16) * 0.32, 0, 1);
}

function priority(
  financial: FinancialModelOutput,
  market: MarketProfile,
  confidenceScore: number,
  riskScore: number,
  categoryWeight: number,
  relativeStrength: number,
): number {
  const profit = normalize(financial.deployableProfitUsd, 0, 500);
  const roi = normalize(financial.estimatedRoi ?? 0, 0, 1.25);
  const velocity = normalize(financial.velocityEfficiency ?? 0, 0, 25);
  const liquidity = market.liquidityScore;
  const capital = normalize(financial.capitalEfficiency ?? 0, 0, 1.0);
  return clamp(
    (profit * 0.27 + roi * 0.19 + velocity * 0.16 + liquidity * 0.12 + capital * 0.12 + confidenceScore * 0.14)
      * 100
      * categoryWeight
      * relativeStrength
      * (1 - riskScore * 0.38),
    0,
    100,
  );
}

function rank(status: RuleEvaluation['status'], priorityScore: number, roi: number): RuleEvaluation['rank'] {
  if (status === 'BUY') {
    if (priorityScore >= 85 && roi >= 0.45) return 'BUY_A_PLUS';
    if (priorityScore >= 70) return 'BUY_A';
    return 'BUY_B';
  }
  if (status === 'WATCH') return priorityScore >= 55 ? 'WATCH_A' : 'WATCH_B';
  if (status === 'REVIEW') return 'REVIEW';
  return 'REJECT';
}

function summarize(status: string, profit: number | null, roi: number | null, confidenceScore: number, rejects: string[], reviews: string[]): string {
  const parts = [`${status} decision`, `profit=${profit ?? 'n/a'}`, `roi=${roi ?? 'n/a'}`, `confidence=${round(confidenceScore, 2)}`];
  if (rejects.length) parts.push(`hardBlocks=${rejects.slice(0, 3).join(',')}`);
  if (reviews.length) parts.push(`reviewWarnings=${reviews.slice(0, 3).join(',')}`);
  return parts.join(' | ');
}

function prefix(p: string) {
  return (v: string) => `${p}_${v}`;
}

function unique<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

function normalize(value: number, min: number, max: number): number {
  return clamp((value - min) / Math.max(0.0001, max - min), 0, 1);
}

function normalizeReason(reason: string): string {
  return reason.trim().toUpperCase().replace(/[^A-Z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
}

function round(value: number, places = 2): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
