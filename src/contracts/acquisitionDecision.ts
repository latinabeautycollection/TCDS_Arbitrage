/**
 * Domain 1 — Acquisition Decision Contract
 * Green Tier 1 Production Contract
 *
 * Purpose:
 * Defines the canonical acquisition decision, capital-safety, execution-readiness,
 * purchase-queue, allocation, identity, comp, market, financial, and audit contracts
 * for the TCDS arbitrage system.
 *
 * Critical design rule:
 * A BUY signal must never be silently mutated into REVIEW.
 * The system preserves the original economic decision and separately determines
 * execution eligibility, review requirement, bid-monitor eligibility, hard block,
 * and capital-skip state.
 */

// -----------------------------------------------------------------------------
// Core decision taxonomy
// -----------------------------------------------------------------------------

export type AcquisitionDecisionStatus = 'BUY' | 'WATCH' | 'REVIEW' | 'REJECT';

export type AcquisitionDecisionRank =
  | 'BUY_A_PLUS'
  | 'BUY_A'
  | 'BUY_B'
  | 'WATCH_A'
  | 'WATCH_B'
  | 'REVIEW'
  | 'REJECT';

export type ConfidenceBand = 'HIGH' | 'MEDIUM' | 'LOW';

/**
 * Capital safety answers: “May we expose real company capital?”
 * PASS means no hard blocker exists.
 * REVIEW_REQUIRED means profitable or interesting, but human / bid-monitor guardrail is required.
 * BLOCK means do not queue for purchase or bid execution.
 */
export type CapitalSafetyStatus = 'PASS' | 'REVIEW_REQUIRED' | 'BLOCK';

/**
 * Execution status answers: “What should operations do next?”
 *
 * AUTO_BUY_READY: Can be routed to purchase automation or approved bid action.
 * BID_MONITOR_READY: BUY economics exist, but auction dynamics require max-bid monitor only.
 * REVIEW_REQUIRED: Human review is required before spending capital.
 * BLOCKED: Hard rule prevents purchase.
 * EXPIRED: Source listing is no longer actionable.
 * CAPITAL_LIMIT_SKIPPED: The item is good, but cash/budget exposure rules skip it for now.
 */
export type AcquisitionExecutionStatus =
  | 'AUTO_BUY_READY'
  | 'BID_MONITOR_READY'
  | 'REVIEW_REQUIRED'
  | 'BLOCKED'
  | 'EXPIRED'
  | 'CAPITAL_LIMIT_SKIPPED';

/** Purchase queue status is intentionally separate from decision and execution status. */
export type PurchaseQueueStatus =
  | 'approved'
  | 'approved_pending_bid_check'
  | 'bid_monitor'
  | 'review_required'
  | 'blocked'
  | 'expired'
  | 'capital_limit_skipped'
  | 'not_queued';

export type AcquisitionLifecycleStatus =
  | 'INTAKE'
  | 'MATCHED'
  | 'QUEUED'
  | 'COMPED'
  | 'SCORED'
  | 'DECIDED'
  | 'CAPITAL_EVALUATED'
  | 'PURCHASE_QUEUED'
  | 'PURCHASED'
  | 'SKIPPED'
  | 'FAILED';

export type ReviewSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export type GateReasonSeverity = 'HARD_BLOCK' | 'SOFT_REVIEW' | 'INFO';

export interface GateReasonDetail {
  code: string;
  severity: GateReasonSeverity;
  summary: string;
  evidence?: Record<string, unknown>;
}

// -----------------------------------------------------------------------------
// Candidate and policy contracts
// -----------------------------------------------------------------------------

export interface AcquisitionCandidate {
  opportunityQueueId: number;
  candidateId: number | null;
  listingId: string;
  watchlistId: number | null;
  title: string;
  normalizedTitle: string | null;
  description: string | null;
  brand: string | null;
  model: string | null;
  categoryKey: string | null;
  conditionText: string | null;
  currentPrice: number | null;
  currentBidPrice: number | null;
  buyNowPrice: number | null;
  inboundShippingUsd: number | null;
  quantityAvailable: number;
  opportunityReasonJson: Record<string, unknown>;
  watchlistJson: Record<string, unknown>;
  ebayMarketJson: Record<string, unknown>;

  /** Optional but strongly recommended for live execution checks. */
  listingStatus?: string | null;
  endTime?: string | Date | null;
  sourceUrl?: string | null;
  lastSeenAt?: string | Date | null;
}

export interface AcquisitionCategoryPolicy {
  policyVersion: string;
  scoringVersion: string;
  categoryKey: string;

  minSoldCount: number;
  minProfitUsd: number;
  minRoi: number;
  maxActiveSoldRatio: number;
  minIdentityConfidence: number;
  minCompQuality: number;
  maxVolatility: number;

  returnRiskRate: number;
  damageRiskRate: number;
  disputeRiskRate: number;
  marketplaceFeeRate: number;
  paymentFeeRate: number;
  salesTaxRate: number;
  warehouseHandlingUsd: number;
  storageReserveUsd: number;
  packagingCostUsd: number;
  insuranceReserveRate: number;
  signatureReserveUsd: number;
  carrierRiskRate: number;
  shippingBufferUsd: number;

  maxItemCapitalPct: number;
  maxCategoryCapitalPct: number;
  maxFamilyCapitalPct: number;
  cashReservePct: number;
  highProfitReviewMultiplier: number;
  minSafetyScoreForBuy: number;
  categoryRankWeight: number;

  /**
   * Optional hardened policy knobs. These keep rules data-driven without breaking
   * older callers that do not yet provide them.
   */
  minAcceptedCompsForAutoBuy?: number;
  minAcceptedCompsForReview?: number;
  minCompGroundingScoreForAutoBuy?: number;
  minCompGroundingScoreForReview?: number;
  allowBidMonitorForAuctions?: boolean;
  allowReviewQueueForSoftBlocks?: boolean;
  allowPurchaseQueueForReviewRequired?: boolean;
}

// -----------------------------------------------------------------------------
// Identity and comp contracts
// -----------------------------------------------------------------------------

export interface NormalizedIdentity {
  originalTitle: string;
  normalizedTitle: string;
  categoryKey: string;
  familyKey: string;
  brand: string | null;
  model: string | null;
  variant: string | null;
  storageGb: number | null;
  color: string | null;
  carrierState: 'unlocked' | 'locked' | 'unknown';
  bundleState: 'bare' | 'kit' | 'bundle' | 'body_only' | 'lens_only' | 'accessory_only' | 'unknown';
  conditionState: 'new' | 'open_box' | 'used' | 'parts_only' | 'untested' | 'unknown';
  accessorySignals: string[];
  requiredAttributesMissing: string[];
  ambiguityFlags: string[];
  identityConfidence: number;
  fingerprint: string;
}

export interface NormalizedComp {
  source: 'sold' | 'active';
  itemId: string | null;
  title: string;
  normalizedTitle: string;
  priceUsd: number;
  conditionText: string | null;
  accepted: boolean;
  rejectionReason: string | null;
  similarityScore: number;
  raw: Record<string, unknown>;

  /** Optional stronger grounding signals used by the capital safety bridge. */
  identifierMatchScore?: number | null;
  conditionMatchScore?: number | null;
  categoryMatchScore?: number | null;
  overallCompScore?: number | null;
}

export interface CompSelectionResult {
  soldComps: NormalizedComp[];
  activeComps: NormalizedComp[];
  acceptedComps: NormalizedComp[];
  rejectedComps: NormalizedComp[];
  outlierCount: number;
  compQualityScore: number;
  reasonCodes: string[];
  riskFlags: string[];

  /** Hardened execution evidence. */
  acceptedSoldCompCount?: number;
  acceptedActiveCompCount?: number;
  compGroundingScore?: number;
  weakGroundingReasons?: string[];
}

export interface MarketProfile {
  soldCount: number;
  activeCount: number;
  activeToSoldRatio: number | null;
  sellThroughRate: number;
  soldMedian: number | null;
  soldP25: number | null;
  soldP75: number | null;
  activeMedian: number | null;
  volatilityScore: number;
  saturationScore: number;
  liquidityScore: number;
  estimatedDaysToSale: number | null;
}

// -----------------------------------------------------------------------------
// Shipping, capital, financial model contracts
// -----------------------------------------------------------------------------

export interface ShippingSignal {
  source: 'shipengine' | 'direct_carrier' | 'policy_estimate' | 'candidate_estimate' | 'missing';
  outboundShippingUsd: number;
  confidence: number;
  carrierCode: string | null;
  serviceCode: string | null;
  requestId: string | null;
  riskFlags: string[];
}

export interface CapitalExposureSnapshot {
  categoryExposureUsd: number;
  familyExposureUsd: number;
  skuExposureUsd: number;
}

export interface FinancialModelOutput {
  estimatedPurchasePriceUsd: number;
  purchasePriceBasis: string;
  aggressiveResaleUsd: number | null;
  expectedResaleUsd: number | null;
  conservativeResaleUsd: number | null;
  feesEstimateUsd: number;
  shippingEstimateUsd: number;
  taxEstimateUsd: number;
  warehouseHandlingUsd: number;
  storageReserveUsd: number;
  insuranceReserveUsd: number;
  signatureReserveUsd: number;
  returnReserveUsd: number;
  disputeReserveUsd: number;
  damageReserveUsd: number;
  carrierRiskReserveUsd: number;
  riskReserveUsd: number;
  expectedNetUsd: number | null;
  estimatedProfitUsd: number | null;
  estimatedRoi: number | null;
  maxBidUsd: number | null;
  deployableUnits: number;
  deployableCapitalUsd: number;
  deployableProfitUsd: number;
  capitalEfficiency: number | null;
  velocityEfficiency: number | null;
  cashTurnProfit: number | null;
  packagingCostUsd?: number;
  shippingSignal: ShippingSignal;
}

// -----------------------------------------------------------------------------
// Capital safety and rule contracts
// -----------------------------------------------------------------------------

export interface SafetyEvaluation {
  /** Legacy compatibility. True only when hard blockers are absent. */
  ok: boolean;

  /** Canonical safety outcome. */
  status: CapitalSafetyStatus;
  safetyScore: number;

  /** Canonical separated reason buckets. */
  hardBlockReasons: string[];
  softReviewReasons: string[];

  /** Legacy compatibility fields. */
  blockingReasons: string[];
  reviewReasons: string[];

  /** Capital bridge instruction. */
  allowedDecision: AcquisitionDecisionStatus;
  executionEligible: boolean;
  purchaseQueueEligible: boolean;
  reviewQueueEligible: boolean;

  /** Specific operating mode for BUY outcomes. */
  executionStatus: AcquisitionExecutionStatus;
  purchaseQueueStatus: PurchaseQueueStatus;

  replayCertificationStatus: 'PASSED' | 'FAILED' | 'NOT_AVAILABLE';
  compGroundingStatus: 'PASSED' | 'FAILED' | 'REVIEW' | 'NOT_AVAILABLE';
  mutationLedgerStatus: 'READY' | 'NOT_AVAILABLE';

  reasonDetails?: GateReasonDetail[];
  evidenceJson?: Record<string, unknown>;
}

export interface RuleEvaluation {
  /** Economic/business decision signal. Never mutate this to hide capital gating. */
  status: AcquisitionDecisionStatus;
  rank: AcquisitionDecisionRank;
  reasonCodes: string[];
  riskFlags: string[];
  confidenceScore: number;
  confidenceBand: ConfidenceBand;
  riskScore: number;
  priorityScore: number;
  explanationSummary: string;

  /** Hardened execution fields. */
  capitalSafe: boolean;
  capitalStatus: CapitalSafetyStatus;
  allowedDecision: AcquisitionDecisionStatus;
  allowedExecutionStatus: AcquisitionExecutionStatus;
  purchaseQueueStatus: PurchaseQueueStatus;
}

export interface AllocationDecisionAudit {
  wasEligibleBeforeCapital: boolean;
  wasSkippedForCapital: boolean;
  skipReason: string | null;
  requestedCapitalUsd: number | null;
  allocatedCapitalUsd: number | null;
  remainingCapitalBeforeUsd: number | null;
  remainingCapitalAfterUsd: number | null;
  allocationRank: number | null;
}

export interface ScoredAcquisitionDecision {
  candidate: AcquisitionCandidate;
  policy: AcquisitionCategoryPolicy;
  identity: NormalizedIdentity;
  comps: CompSelectionResult;
  market: MarketProfile;
  financial: FinancialModelOutput;
  safety: SafetyEvaluation;

  /**
   * rules is retained for legacy callers. It should normally equal finalRules.
   * New services should read originalRules + finalRules explicitly.
   */
  rules: RuleEvaluation;

  /** Original economic decision before capital/execution gating. */
  originalRules: RuleEvaluation;

  /** Final operational decision after capital/execution gating. */
  finalRules: RuleEvaluation;

  /** Canonical execution outcome. */
  executionStatus: AcquisitionExecutionStatus;
  purchaseQueueStatus: PurchaseQueueStatus;

  /** True when originalRules.status is BUY, even if final execution requires review/block/skip. */
  originalBuySignal: boolean;

  /** True only when execution can spend capital without human review. */
  autoBuyEligible: boolean;

  /** True when purchase_queue should receive a row, including review_required/bid_monitor modes. */
  purchaseQueueEligible: boolean;

  /** True when this decision must be surfaced to human review. */
  reviewRequired: boolean;
  reviewSeverity: ReviewSeverity | null;

  correlationId: string;
  portfolioBatchId: string;
  inputHash: string;
  allocationPosition: number | null;
  allocationAudit?: AllocationDecisionAudit;
}

export interface AllocationResult {
  decisions: ScoredAcquisitionDecision[];
  allocatedCapitalUsd: number;
  remainingCapitalUsd: number;
  skippedForCapitalCount: number;

  /** Hardened rollups for daily audit. */
  autoBuyReadyCount?: number;
  bidMonitorReadyCount?: number;
  reviewRequiredCount?: number;
  hardBlockedCount?: number;
  expiredCount?: number;
  purchaseQueueEligibleCount?: number;
  originalBuyCount?: number;
}

// -----------------------------------------------------------------------------
// Reason-code policy helpers
// -----------------------------------------------------------------------------

/** Economic rules output, before capital/execution gating is layered on by the worker. */
export type EconomicRuleEvaluation = Omit<
  RuleEvaluation,
  'capitalSafe' | 'capitalStatus' | 'allowedDecision' | 'allowedExecutionStatus' | 'purchaseQueueStatus'
>;

/** Raw capital-safety output from the bridge, before the worker finalizes it via makeSafetyEvaluation. */
export interface RawSafetyEvaluation {
  ok: boolean;
  safetyScore: number;
  blockingReasons: string[];
  reviewReasons: string[];
  hardBlockReasons?: string[];
  softReviewReasons?: string[];
  status?: CapitalSafetyStatus;
  replayCertificationStatus: SafetyEvaluation['replayCertificationStatus'];
  compGroundingStatus: SafetyEvaluation['compGroundingStatus'];
  mutationLedgerStatus: SafetyEvaluation['mutationLedgerStatus'];
  evidenceJson?: Record<string, unknown>;
}

export const HARD_CAPITAL_BLOCKERS = new Set<string>([
  'CAPITAL_GATE_LISTING_NOT_LIVE',
  'CAPITAL_GATE_NOT_DEDUPE_PRIMARY',
  'CAPITAL_GATE_BUDGET_EXCEEDED',
  'CAPITAL_GATE_BANNED_CATEGORY',
  'CAPITAL_GATE_ZERO_ACCEPTED_COMPS',
  'CAPITAL_GATE_NEGATIVE_PROFIT',
  'CAPITAL_GATE_BELOW_MIN_NET_PROFIT',
  'CAPITAL_GATE_BELOW_MIN_ROI',
  'CAPITAL_GATE_EXPIRED_AUCTION',
  'CAPITAL_GATE_SOURCE_UNAVAILABLE',
  'REPLAY_CERTIFICATION_FAILED',
]);

export const SOFT_CAPITAL_REVIEW_REASONS = new Set<string>([
  'CAPITAL_GATE_LOW_COMP_COUNT',
  'CAPITAL_GATE_WEAK_COMP_GROUNDING',
  'CAPITAL_GATE_LOW_CONFIDENCE',
  'CAPITAL_GATE_HIGH_VOLATILITY',
  'CAPITAL_GATE_HIGH_RETURN_RISK',
  'CAPITAL_GATE_HIGH_DISPUTE_RISK',
  'LOW_STARTING_BID_MONITOR_AUCTION_RISK',
  'CAPITAL_SAFETY_GATE_REQUIRED_FOR_BUY',
  'REPLAY_CERTIFICATION_REQUIRED_FOR_BUY',
  'DB_MUTATION_LEDGER_REQUIRED_FOR_BUY',
  'FORENSIC_CHAIN_REQUIRED_FOR_BUY',
  'SHIPENGINE_RATE_REQUIRED_FOR_BUY',
]);

export function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

export function classifyGateReason(code: string): GateReasonSeverity {
  if (HARD_CAPITAL_BLOCKERS.has(code)) return 'HARD_BLOCK';
  if (SOFT_CAPITAL_REVIEW_REASONS.has(code)) return 'SOFT_REVIEW';
  return 'INFO';
}

export function hasHardCapitalBlock(reasons: readonly string[]): boolean {
  return reasons.some((reason) => HARD_CAPITAL_BLOCKERS.has(reason));
}

export function splitCapitalReasons(reasons: readonly string[]): {
  hardBlockReasons: string[];
  softReviewReasons: string[];
  informationalReasons: string[];
} {
  const hardBlockReasons: string[] = [];
  const softReviewReasons: string[] = [];
  const informationalReasons: string[] = [];

  for (const reason of uniqueStrings(reasons)) {
    const severity = classifyGateReason(reason);
    if (severity === 'HARD_BLOCK') hardBlockReasons.push(reason);
    else if (severity === 'SOFT_REVIEW') softReviewReasons.push(reason);
    else informationalReasons.push(reason);
  }

  return { hardBlockReasons, softReviewReasons, informationalReasons };
}

export function resolveCapitalSafetyStatus(input: {
  hardBlockReasons: readonly string[];
  softReviewReasons: readonly string[];
  originalDecision: AcquisitionDecisionStatus;
}): CapitalSafetyStatus {
  if (input.hardBlockReasons.length > 0) return 'BLOCK';
  if (input.originalDecision === 'BUY' && input.softReviewReasons.length > 0) return 'REVIEW_REQUIRED';
  return 'PASS';
}

export function resolveExecutionStatus(input: {
  originalDecision: AcquisitionDecisionStatus;
  capitalStatus: CapitalSafetyStatus;
  hardBlockReasons?: readonly string[];
  softReviewReasons?: readonly string[];
  maxBidUsd?: number | null;
  isAuction?: boolean;
  skippedForCapital?: boolean;
}): AcquisitionExecutionStatus {
  const hardBlockReasons = input.hardBlockReasons ?? [];
  const softReviewReasons = input.softReviewReasons ?? [];

  if (hardBlockReasons.includes('CAPITAL_GATE_LISTING_NOT_LIVE') || hardBlockReasons.includes('CAPITAL_GATE_EXPIRED_AUCTION')) {
    return 'EXPIRED';
  }

  if (input.skippedForCapital) return 'CAPITAL_LIMIT_SKIPPED';
  if (input.capitalStatus === 'BLOCK') return 'BLOCKED';

  if (input.originalDecision !== 'BUY') return input.capitalStatus === 'REVIEW_REQUIRED' ? 'REVIEW_REQUIRED' : 'BLOCKED';

  if (input.capitalStatus === 'REVIEW_REQUIRED') {
    const bidMonitorOnly =
      input.isAuction === true &&
      typeof input.maxBidUsd === 'number' &&
      Number.isFinite(input.maxBidUsd) &&
      input.maxBidUsd > 0 &&
      softReviewReasons.includes('LOW_STARTING_BID_MONITOR_AUCTION_RISK');

    return bidMonitorOnly ? 'BID_MONITOR_READY' : 'REVIEW_REQUIRED';
  }

  return input.isAuction === true && input.maxBidUsd != null ? 'BID_MONITOR_READY' : 'AUTO_BUY_READY';
}

export function resolvePurchaseQueueStatus(executionStatus: AcquisitionExecutionStatus): PurchaseQueueStatus {
  switch (executionStatus) {
    case 'AUTO_BUY_READY':
      return 'approved';
    case 'BID_MONITOR_READY':
      return 'bid_monitor';
    case 'REVIEW_REQUIRED':
      return 'review_required';
    case 'BLOCKED':
      return 'blocked';
    case 'EXPIRED':
      return 'expired';
    case 'CAPITAL_LIMIT_SKIPPED':
      return 'capital_limit_skipped';
    default: {
      const exhaustive: never = executionStatus;
      return exhaustive;
    }
  }
}

export function isPurchaseQueueEligible(status: PurchaseQueueStatus): boolean {
  return status === 'approved' || status === 'approved_pending_bid_check' || status === 'bid_monitor' || status === 'review_required';
}

export function makeSafetyEvaluation(input: {
  originalDecision: AcquisitionDecisionStatus;
  hardBlockReasons?: readonly string[];
  softReviewReasons?: readonly string[];
  safetyScore: number;
  replayCertificationStatus?: SafetyEvaluation['replayCertificationStatus'];
  compGroundingStatus?: SafetyEvaluation['compGroundingStatus'];
  mutationLedgerStatus?: SafetyEvaluation['mutationLedgerStatus'];
  maxBidUsd?: number | null;
  isAuction?: boolean;
  evidenceJson?: Record<string, unknown>;
}): SafetyEvaluation {
  const hardBlockReasons = uniqueStrings([...(input.hardBlockReasons ?? [])]);
  const softReviewReasons = uniqueStrings([...(input.softReviewReasons ?? [])]);
  const status = resolveCapitalSafetyStatus({
    hardBlockReasons,
    softReviewReasons,
    originalDecision: input.originalDecision,
  });

  const executionStatus = resolveExecutionStatus({
    originalDecision: input.originalDecision,
    capitalStatus: status,
    hardBlockReasons,
    softReviewReasons,
    maxBidUsd: input.maxBidUsd,
    isAuction: input.isAuction,
  });
  const purchaseQueueStatus = resolvePurchaseQueueStatus(executionStatus);
  const allowedDecision: AcquisitionDecisionStatus =
    status === 'BLOCK' ? 'REJECT' : status === 'REVIEW_REQUIRED' ? 'REVIEW' : input.originalDecision;

  const reasonDetails = [...hardBlockReasons, ...softReviewReasons].map((code) => ({
    code,
    severity: classifyGateReason(code),
    summary: code.replace(/_/g, ' ').toLowerCase(),
  }));

  return {
    ok: hardBlockReasons.length === 0,
    status,
    safetyScore: input.safetyScore,
    hardBlockReasons,
    softReviewReasons,
    blockingReasons: hardBlockReasons,
    reviewReasons: softReviewReasons,
    allowedDecision,
    executionEligible: executionStatus === 'AUTO_BUY_READY' || executionStatus === 'BID_MONITOR_READY',
    purchaseQueueEligible: isPurchaseQueueEligible(purchaseQueueStatus),
    reviewQueueEligible: purchaseQueueStatus === 'review_required',
    executionStatus,
    purchaseQueueStatus,
    replayCertificationStatus: input.replayCertificationStatus ?? 'NOT_AVAILABLE',
    compGroundingStatus: input.compGroundingStatus ?? 'NOT_AVAILABLE',
    mutationLedgerStatus: input.mutationLedgerStatus ?? 'NOT_AVAILABLE',
    reasonDetails,
    evidenceJson: input.evidenceJson,
  };
}

export function preserveBuySignalWithExecution(input: {
  originalRules: RuleEvaluation;
  safety: SafetyEvaluation;
  allocationSkipped?: boolean;
  allocationSkipReason?: string | null;
}): RuleEvaluation {
  const allocationSkipped = input.allocationSkipped === true;
  const executionStatus = allocationSkipped ? 'CAPITAL_LIMIT_SKIPPED' : input.safety.executionStatus;
  const purchaseQueueStatus = allocationSkipped ? 'capital_limit_skipped' : input.safety.purchaseQueueStatus;
  const extraReasonCodes = allocationSkipped && input.allocationSkipReason ? [input.allocationSkipReason] : [];

  return {
    ...input.originalRules,
    /** Preserve the economic status. Do not mutate BUY into REVIEW. */
    status: input.originalRules.status,
    reasonCodes: uniqueStrings([...input.originalRules.reasonCodes, ...input.safety.hardBlockReasons, ...input.safety.softReviewReasons, ...extraReasonCodes]),
    riskFlags: uniqueStrings([...input.originalRules.riskFlags, ...(input.safety.status === 'BLOCK' ? ['CAPITAL_HARD_BLOCK'] : []), ...(input.safety.status === 'REVIEW_REQUIRED' ? ['CAPITAL_REVIEW_REQUIRED'] : [])]),
    capitalSafe: input.safety.status === 'PASS',
    capitalStatus: allocationSkipped ? 'REVIEW_REQUIRED' : input.safety.status,
    allowedDecision: input.safety.allowedDecision,
    allowedExecutionStatus: executionStatus,
    purchaseQueueStatus,
  };
}

export function createScoredDecision(input: Omit<ScoredAcquisitionDecision, 'rules' | 'finalRules' | 'executionStatus' | 'purchaseQueueStatus' | 'originalBuySignal' | 'autoBuyEligible' | 'purchaseQueueEligible' | 'reviewRequired' | 'reviewSeverity'> & {
  finalRules?: RuleEvaluation;
}): ScoredAcquisitionDecision {
  const finalRules = input.finalRules ?? preserveBuySignalWithExecution({ originalRules: input.originalRules, safety: input.safety });
  const executionStatus = finalRules.allowedExecutionStatus;
  const purchaseQueueStatus = finalRules.purchaseQueueStatus;
  const reviewRequired = purchaseQueueStatus === 'review_required' || input.safety.status === 'REVIEW_REQUIRED';

  return {
    ...input,
    rules: finalRules,
    finalRules,
    executionStatus,
    purchaseQueueStatus,
    originalBuySignal: input.originalRules.status === 'BUY',
    autoBuyEligible: executionStatus === 'AUTO_BUY_READY',
    purchaseQueueEligible: isPurchaseQueueEligible(purchaseQueueStatus),
    reviewRequired,
    reviewSeverity: reviewRequired ? (input.safety.softReviewReasons.length >= 2 ? 'HIGH' : 'MEDIUM') : null,
  };
}
