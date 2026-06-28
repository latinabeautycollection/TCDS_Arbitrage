/* src/services/capitalAllocationEngine.ts
 * Domain 2 — Capital Allocation Engine
 * Green Tier 1 production contract aligned with hardened Domain 1 decisions.
 *
 * Core rule:
 *   Allocate capital for AUTO_BUY_READY, BID_MONITOR_READY, REVIEW_REQUIRED.
 *   Block only BLOCKED, EXPIRED, CAPITAL_LIMIT_SKIPPED, invalid math, hard policy failure.
 */

export type AllocationMode = 'shadow' | 'production';

export type Domain1ExecutionStatus =
  | 'AUTO_BUY_READY'
  | 'BID_MONITOR_READY'
  | 'REVIEW_REQUIRED'
  | 'BLOCKED'
  | 'EXPIRED'
  | 'CAPITAL_LIMIT_SKIPPED'
  | 'UNKNOWN';

export type CapitalSafetyStatus =
  | 'PASS'
  | 'REVIEW_REQUIRED'
  | 'BLOCK'
  | 'SAFE'
  | 'PASSED'
  | 'UNKNOWN';

export type PurchaseQueueStatus =
  | 'approved'
  | 'bid_monitor'
  | 'review_required'
  | 'blocked'
  | 'not_queued';

export interface AllocationPolicy {
  policyVersion: string;
  mode: AllocationMode;
  totalCapitalUsd: number;
  reservePct: number;
  maxPerItemUsd: number;
  maxCategoryExposurePct: number;
  maxFamilyExposurePct: number;
  minBuyAPlusScore: number;
  minBuyAScore: number;
  minBuyBScore: number;
  minConfidenceScore: number;
  requireCapitalSafety: boolean;
  requireLiveness: boolean;
  requireValidCostBasis: boolean;
}

export interface BuyQualifiedOpportunity {
  sourceRecordId: number | string;
  listingId: string | null;
  decisionId?: string | null;
  candidateId: number | string | null;
  opportunityQueueId: number | string | null;
  categoryKey: string | null;
  familyKey: string | null;

  originalDecision: string;
  finalDecision: string;
  decisionStatus: string;
  qualificationStatus: string;

  executionStatus: Domain1ExecutionStatus | string | null;
  purchaseQueueStatus: PurchaseQueueStatus | string | null;
  capitalSafetyStatus?: CapitalSafetyStatus | string | null;
  livenessStatus?: string | null;
  costBasisSource?: string | null;

  hardBlockReasons?: string[];
  softReviewReasons?: string[];
  reasonCodes?: string[];
  riskFlags?: string[];

  requiredCapitalUsd: number;
  expectedProfitUsd: number;
  expectedRoi: number;
  expectedDaysToSale: number | null;
  confidenceScore: number;
}

export type AllocationTier =
  | 'BUY_A+'
  | 'BUY_A'
  | 'BUY_B'
  | 'REVIEW_ALLOCATED'
  | 'BID_MONITOR_ALLOCATED'
  | 'NO_CAPITAL'
  | 'BLOCKED';

export type ExposureStatus = 'OK' | 'LIMITED' | 'INVALID';

export interface AllocatedOpportunity extends BuyQualifiedOpportunity {
  categoryKey: string;
  familyKey: string;
  capitalAllocationUsd: number;
  allocationTier: AllocationTier;
  capitalEfficiencyScore: number;
  velocityScore: number;
  allocationScore: number;
  exposureStatus: ExposureStatus;
  allocationEligible: boolean;
  purchaseQueueEligible: boolean;
  reasonCodes: string[];
  riskFlags: string[];
  allocationJson: Record<string, unknown>;
}

export interface CapitalAllocationResult {
  reserveUsd: number;
  deployableCapitalUsd: number;
  allocatedCapitalUsd: number;
  remainingCapitalUsd: number;
  allocatedCount: number;
  purchaseQueueEligibleCount: number;
  blockedCount: number;
  reviewRequiredCount: number;
  bidMonitorCount: number;
  allocated: AllocatedOpportunity[];
}

const ALLOCATABLE_EXECUTION_STATUSES = new Set<Domain1ExecutionStatus>([
  'AUTO_BUY_READY',
  'BID_MONITOR_READY',
  'REVIEW_REQUIRED',
]);

const BLOCKED_EXECUTION_STATUSES = new Set<Domain1ExecutionStatus>([
  'BLOCKED',
  'EXPIRED',
  'CAPITAL_LIMIT_SKIPPED',
]);

const PASSING_CAPITAL_STATUSES = new Set<string>([
  'PASS',
  'SAFE',
  'PASSED',
  'REVIEW_REQUIRED',
]);

const LIVE_STATUSES = new Set<string>([
  'LIVE',
  'ACTIONABLE',
  'BID_MONITOR_READY',
  'AUTO_BUY_READY',
  'REVIEW_REQUIRED',
  'UNKNOWN', // Do not kill capital allocation solely because the source view cannot provide liveness.
]);

const VALID_COST_BASIS_SOURCES = new Set<string>([
  'CURRENT_BID',
  'EXPECTED_CLEARING_PRICE',
  'BUY_NOW',
  'EFFECTIVE_COST_BASIS',
  'DECISION_COST_BASIS',
  'ESTIMATED_COST_BASIS',
]);

export function allocateCapital(input: {
  policy: AllocationPolicy;
  opportunities: BuyQualifiedOpportunity[];
}): CapitalAllocationResult {
  const { policy } = input;
  validatePolicy(policy);

  const reserveUsd = round(policy.totalCapitalUsd * policy.reservePct);
  const deployableCapitalUsd = round(policy.totalCapitalUsd - reserveUsd);

  let remaining = deployableCapitalUsd;
  const categoryExposure = new Map<string, number>();
  const familyExposure = new Map<string, number>();

  const scored = input.opportunities.map(scoreOpportunity).sort(compareOpportunities);
  const allocated: AllocatedOpportunity[] = [];

  for (const op of scored) {
    const categoryKey = normalizeKey(op.categoryKey);
    const familyKey = normalizeKey(op.familyKey);
    const reasonCodes = unique([...(op.reasonCodes ?? [])]);
    const riskFlags = unique([...(op.riskFlags ?? [])]);

    const categoryLimit = round(deployableCapitalUsd * policy.maxCategoryExposurePct);
    const familyLimit = round(deployableCapitalUsd * policy.maxFamilyExposurePct);
    const categoryUsedBefore = categoryExposure.get(categoryKey) ?? 0;
    const familyUsedBefore = familyExposure.get(familyKey) ?? 0;
    const remainingBefore = remaining;

    let allocationTier: AllocationTier = 'NO_CAPITAL';
    let capitalAllocationUsd = 0;
    let exposureStatus: ExposureStatus = 'OK';

    const governanceFailure = getGovernanceFailure(op, policy);

    if (governanceFailure) {
      allocationTier = 'BLOCKED';
      exposureStatus = 'INVALID';
      riskFlags.push(governanceFailure);
      reasonCodes.push('CAPITAL_ALLOCATION_BLOCKED_BY_GOVERNANCE');
    } else {
      const categoryRemaining = Math.max(0, categoryLimit - categoryUsedBefore);
      const familyRemaining = Math.max(0, familyLimit - familyUsedBefore);

      const allowed = round(Math.min(
        policy.maxPerItemUsd,
        safeNumber(op.requiredCapitalUsd),
        remaining,
        categoryRemaining,
        familyRemaining,
      ));

      if (allowed <= 0) {
        exposureStatus = 'LIMITED';
        allocationTier = 'NO_CAPITAL';
        reasonCodes.push('NO_CAPITAL_AVAILABLE_OR_EXPOSURE_LIMIT');
      } else {
        const proposedTier = tierForScore(op.allocationScore, policy, op.executionStatus);

        if (proposedTier === 'NO_CAPITAL') {
          reasonCodes.push('ALLOCATION_SCORE_BELOW_BUY_B');
        } else {
          allocationTier = proposedTier;
          capitalAllocationUsd = allowed;
          remaining = round(remaining - capitalAllocationUsd);
          categoryExposure.set(categoryKey, round(categoryUsedBefore + capitalAllocationUsd));
          familyExposure.set(familyKey, round(familyUsedBefore + capitalAllocationUsd));
          reasonCodes.push(`${allocationTier}_CAPITAL_ALLOCATED`);
        }
      }
    }

    const purchaseQueueEligible =
      capitalAllocationUsd > 0 &&
      isAllocatableExecutionStatus(op.executionStatus);

    allocated.push({
      ...op,
      categoryKey,
      familyKey,
      capitalAllocationUsd,
      allocationTier,
      capitalEfficiencyScore: op.capitalEfficiencyScore,
      velocityScore: op.velocityScore,
      allocationScore: op.allocationScore,
      exposureStatus,
      allocationEligible: capitalAllocationUsd > 0,
      purchaseQueueEligible,
      reasonCodes: unique(reasonCodes),
      riskFlags: unique(riskFlags),
      allocationJson: {
        policyVersion: policy.policyVersion,
        mode: policy.mode,
        reserveUsd,
        deployableCapitalUsd,
        remainingBefore,
        remainingAfter: remaining,
        categoryKey,
        familyKey,
        categoryUsedBefore,
        familyUsedBefore,
        categoryLimit,
        familyLimit,
        maxPerItemUsd: policy.maxPerItemUsd,
        requiredCapitalUsd: op.requiredCapitalUsd,
        expectedProfitUsd: op.expectedProfitUsd,
        expectedRoi: op.expectedRoi,
        confidenceScore: op.confidenceScore,
        originalDecision: op.originalDecision,
        finalDecision: op.finalDecision,
        decisionStatus: op.decisionStatus,
        executionStatus: op.executionStatus ?? 'UNKNOWN',
        purchaseQueueStatus: op.purchaseQueueStatus ?? derivePurchaseQueueStatus(op.executionStatus),
        capitalSafetyStatus: op.capitalSafetyStatus ?? 'UNKNOWN',
        livenessStatus: op.livenessStatus ?? 'UNKNOWN',
        costBasisSource: op.costBasisSource ?? null,
        hardBlockReasons: op.hardBlockReasons ?? [],
        softReviewReasons: op.softReviewReasons ?? [],
        allocationTier,
        exposureStatus,
        purchaseQueueEligible,
      },
    });
  }

  const allocatedCapitalUsd = round(deployableCapitalUsd - remaining);

  return {
    reserveUsd,
    deployableCapitalUsd,
    allocatedCapitalUsd,
    remainingCapitalUsd: round(remaining),
    allocatedCount: allocated.filter((x) => x.capitalAllocationUsd > 0).length,
    purchaseQueueEligibleCount: allocated.filter((x) => x.purchaseQueueEligible).length,
    blockedCount: allocated.filter((x) => x.allocationTier === 'BLOCKED').length,
    reviewRequiredCount: allocated.filter((x) => normalizeStatus(x.executionStatus) === 'REVIEW_REQUIRED').length,
    bidMonitorCount: allocated.filter((x) => normalizeStatus(x.executionStatus) === 'BID_MONITOR_READY').length,
    allocated,
  };
}

function getGovernanceFailure(op: BuyQualifiedOpportunity, policy: AllocationPolicy): string | null {
  if (normalizeStatus(op.qualificationStatus) !== 'BUY_QUALIFIED') {
    return 'NOT_BUY_QUALIFIED';
  }

  if (!isBuyDecision(op.originalDecision) && !isBuyDecision(op.finalDecision) && !isBuyDecision(op.decisionStatus)) {
    return 'NOT_BUY_DECISION';
  }

  const executionStatus = normalizeExecutionStatus(op.executionStatus);
  if (BLOCKED_EXECUTION_STATUSES.has(executionStatus)) {
    return `EXECUTION_${executionStatus}`;
  }

  if (!ALLOCATABLE_EXECUTION_STATUSES.has(executionStatus)) {
    return 'EXECUTION_STATUS_NOT_ALLOCATABLE';
  }

  if (policy.requireCapitalSafety) {
    const status = normalizeStatus(op.capitalSafetyStatus);
    if (!PASSING_CAPITAL_STATUSES.has(status)) {
      return 'CAPITAL_SAFETY_NOT_ALLOCATABLE';
    }
  }

  if (policy.requireLiveness) {
    const status = normalizeStatus(op.livenessStatus) || 'UNKNOWN';
    if (!LIVE_STATUSES.has(status)) {
      return 'LIVENESS_NOT_ALLOCATABLE';
    }
  }

  if (policy.requireValidCostBasis) {
    const source = normalizeStatus(op.costBasisSource);
    if (source && !VALID_COST_BASIS_SOURCES.has(source)) {
      return 'INVALID_COST_BASIS_SOURCE';
    }
  }

  if (!Number.isFinite(op.requiredCapitalUsd) || op.requiredCapitalUsd <= 0) {
    return 'INVALID_REQUIRED_CAPITAL';
  }

  if (!Number.isFinite(op.expectedProfitUsd) || op.expectedProfitUsd <= 0) {
    return 'INVALID_EXPECTED_PROFIT';
  }

  if (!Number.isFinite(op.expectedRoi) || op.expectedRoi <= 0) {
    return 'INVALID_EXPECTED_ROI';
  }

  if (!Number.isFinite(op.confidenceScore) || op.confidenceScore < policy.minConfidenceScore) {
    return 'CONFIDENCE_BELOW_ALLOCATION_MINIMUM';
  }

  return null;
}

function scoreOpportunity(op: BuyQualifiedOpportunity): BuyQualifiedOpportunity & {
  capitalEfficiencyScore: number;
  velocityScore: number;
  allocationScore: number;
} {
  const requiredCapital = Math.max(0, safeNumber(op.requiredCapitalUsd));
  const expectedProfit = safeNumber(op.expectedProfitUsd);
  const expectedRoi = safeNumber(op.expectedRoi);
  const confidenceScore = clamp(safeNumber(op.confidenceScore), 0, 1);
  const velocityScore = velocityFactor(op.expectedDaysToSale);
  const executionBoost = executionStatusBoost(op.executionStatus);

  const capitalEfficiencyScore = requiredCapital > 0 ? expectedProfit / requiredCapital : 0;

  const allocationScore = round(
    capitalEfficiencyScore * 0.42 +
      expectedRoi * 0.28 +
      velocityScore * 0.13 +
      confidenceScore * 0.12 +
      executionBoost * 0.05,
    6,
  );

  return {
    ...op,
    capitalEfficiencyScore: round(capitalEfficiencyScore, 6),
    velocityScore,
    allocationScore,
  };
}

function compareOpportunities(a: BuyQualifiedOpportunity & { allocationScore: number }, b: BuyQualifiedOpportunity & { allocationScore: number }): number {
  if (b.allocationScore !== a.allocationScore) return b.allocationScore - a.allocationScore;
  if (b.expectedProfitUsd !== a.expectedProfitUsd) return b.expectedProfitUsd - a.expectedProfitUsd;
  if (b.expectedRoi !== a.expectedRoi) return b.expectedRoi - a.expectedRoi;
  return String(a.sourceRecordId).localeCompare(String(b.sourceRecordId));
}

function tierForScore(score: number, policy: AllocationPolicy, executionStatus: string | null | undefined): AllocationTier {
  const status = normalizeExecutionStatus(executionStatus);
  if (score < policy.minBuyBScore) return 'NO_CAPITAL';
  if (status === 'REVIEW_REQUIRED') return 'REVIEW_ALLOCATED';
  if (status === 'BID_MONITOR_READY') return 'BID_MONITOR_ALLOCATED';
  if (score >= policy.minBuyAPlusScore) return 'BUY_A+';
  if (score >= policy.minBuyAScore) return 'BUY_A';
  return 'BUY_B';
}

function validatePolicy(policy: AllocationPolicy): void {
  if (!policy.policyVersion) throw new Error('Invalid policyVersion');
  if (!['shadow', 'production'].includes(policy.mode)) throw new Error('Invalid mode');
  if (!Number.isFinite(policy.totalCapitalUsd) || policy.totalCapitalUsd <= 0) throw new Error('Invalid totalCapitalUsd');
  if (!Number.isFinite(policy.reservePct) || policy.reservePct < 0 || policy.reservePct >= 0.9) throw new Error('Invalid reservePct');
  if (!Number.isFinite(policy.maxPerItemUsd) || policy.maxPerItemUsd <= 0) throw new Error('Invalid maxPerItemUsd');
  if (!Number.isFinite(policy.maxCategoryExposurePct) || policy.maxCategoryExposurePct <= 0 || policy.maxCategoryExposurePct > 1) throw new Error('Invalid maxCategoryExposurePct');
  if (!Number.isFinite(policy.maxFamilyExposurePct) || policy.maxFamilyExposurePct <= 0 || policy.maxFamilyExposurePct > 1) throw new Error('Invalid maxFamilyExposurePct');
  if (policy.minBuyAPlusScore < policy.minBuyAScore || policy.minBuyAScore < policy.minBuyBScore) throw new Error('Invalid tier score order');
  if (!Number.isFinite(policy.minConfidenceScore) || policy.minConfidenceScore < 0 || policy.minConfidenceScore > 1) throw new Error('Invalid minConfidenceScore');
}

function velocityFactor(days: number | null): number {
  if (days === null || days <= 0) return 0.50;
  if (days <= 14) return 1.00;
  if (days <= 30) return 0.85;
  if (days <= 45) return 0.70;
  if (days <= 60) return 0.55;
  return 0.35;
}

function executionStatusBoost(value: string | null | undefined): number {
  const status = normalizeExecutionStatus(value);
  if (status === 'AUTO_BUY_READY') return 1.00;
  if (status === 'BID_MONITOR_READY') return 0.90;
  if (status === 'REVIEW_REQUIRED') return 0.70;
  return 0;
}

function normalizeExecutionStatus(value: string | null | undefined): Domain1ExecutionStatus {
  const v = normalizeStatus(value);
  if (v === 'AUTO_BUY_READY') return 'AUTO_BUY_READY';
  if (v === 'BID_MONITOR_READY') return 'BID_MONITOR_READY';
  if (v === 'REVIEW_REQUIRED') return 'REVIEW_REQUIRED';
  if (v === 'BLOCKED') return 'BLOCKED';
  if (v === 'EXPIRED') return 'EXPIRED';
  if (v === 'CAPITAL_LIMIT_SKIPPED') return 'CAPITAL_LIMIT_SKIPPED';
  return 'UNKNOWN';
}

function isAllocatableExecutionStatus(value: string | null | undefined): boolean {
  return ALLOCATABLE_EXECUTION_STATUSES.has(normalizeExecutionStatus(value));
}

function isBuyDecision(value: string | null | undefined): boolean {
  return normalizeStatus(value).startsWith('BUY');
}

function derivePurchaseQueueStatus(value: string | null | undefined): PurchaseQueueStatus {
  const status = normalizeExecutionStatus(value);
  if (status === 'AUTO_BUY_READY') return 'approved';
  if (status === 'BID_MONITOR_READY') return 'bid_monitor';
  if (status === 'REVIEW_REQUIRED') return 'review_required';
  if (BLOCKED_EXECUTION_STATUSES.has(status)) return 'blocked';
  return 'not_queued';
}

function normalizeKey(value: string | null): string {
  return value?.trim().toLowerCase() || 'unknown';
}

function normalizeStatus(value: string | null | undefined): string {
  return value?.trim().toUpperCase() || '';
}

function safeNumber(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number, places = 2): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}
