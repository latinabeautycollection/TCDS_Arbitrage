import { evaluateAcquisitionRules } from './acquisitionRulesEngine';
import type { AllocationResult, ScoredAcquisitionDecision } from '../contracts/acquisitionDecision';

/**
 * Portfolio allocator — production rewrite.
 *
 * Critical fix:
 * - Never mutates a BUY decision into REVIEW solely because capital/exposure is unavailable.
 * - Keeps BUY label intact and adds explicit reason/risk flags.
 * - This lets downstream services distinguish:
 *   BUY_BUT_NOT_ALLOCATED vs REVIEW_REQUIRED vs HARD_BLOCKED.
 */
export function allocateAcquisitionPortfolio(input: {
  decisions: ScoredAcquisitionDecision[];
  cashOnHandUsd: number;
}): AllocationResult {
  const cashOnHandUsd = Math.max(0, input.cashOnHandUsd);
  const maxPriority = Math.max(1, ...input.decisions.map((d) => d.rules.priorityScore || 0));

  const rescored = input.decisions.map((decision) => {
    const relativeStrength = clamp((decision.rules.priorityScore || 0) / maxPriority, 0.45, 1);
    const rules = evaluateAcquisitionRules({
      identity: decision.identity,
      comps: decision.comps,
      market: decision.market,
      financial: decision.financial,
      policy: decision.policy,
      safety: decision.safety,
      relativeStrength,
    });
    return { ...decision, rules: { ...decision.rules, ...rules } };
  });

  const sorted = [...rescored].sort((a, b) =>
    (b.rules.priorityScore - a.rules.priorityScore)
    || ((b.financial.cashTurnProfit ?? 0) - (a.financial.cashTurnProfit ?? 0))
    || (b.financial.deployableProfitUsd - a.financial.deployableProfitUsd)
    || ((b.financial.estimatedRoi ?? 0) - (a.financial.estimatedRoi ?? 0))
    || (a.rules.riskScore - b.rules.riskScore),
  );

  let remaining = cashOnHandUsd;
  let allocated = 0;
  let position = 1;
  let skippedForCapitalCount = 0;
  const categoryAllocated = new Map<string, number>();
  const familyAllocated = new Map<string, number>();

  const decisions = sorted.map((decision) => {
    const categoryKey = decision.identity.categoryKey;
    const familyKey = decision.identity.familyKey;
    const requiredCapital = Math.max(0, decision.financial.deployableCapitalUsd);
    const categoryLimit = cashOnHandUsd * decision.policy.maxCategoryCapitalPct;
    const familyLimit = cashOnHandUsd * decision.policy.maxFamilyCapitalPct;
    const categoryUsed = categoryAllocated.get(categoryKey) ?? 0;
    const familyUsed = familyAllocated.get(familyKey) ?? 0;

    const allocationBlockReasons = allocationBlocks({
      decision,
      requiredCapital,
      remaining,
      categoryUsed,
      categoryLimit,
      familyUsed,
      familyLimit,
    });

    if (decision.rules.status === 'BUY' && allocationBlockReasons.length === 0) {
      remaining = round(remaining - requiredCapital, 2);
      allocated = round(allocated + requiredCapital, 2);
      categoryAllocated.set(categoryKey, round(categoryUsed + requiredCapital, 2));
      familyAllocated.set(familyKey, round(familyUsed + requiredCapital, 2));
      return {
        ...decision,
        allocationPosition: position++,
        rules: {
          ...decision.rules,
          reasonCodes: unique([...decision.rules.reasonCodes, 'CAPITAL_ALLOCATED']),
          riskFlags: unique(decision.rules.riskFlags),
        },
      };
    }

    if (decision.rules.status === 'BUY') {
      skippedForCapitalCount += 1;
      return {
        ...decision,
        allocationPosition: null,
        rules: {
          ...decision.rules,
          // Preserve BUY. Do not downgrade to REVIEW here.
          reasonCodes: unique([...decision.rules.reasonCodes, ...allocationBlockReasons]),
          riskFlags: unique([...decision.rules.riskFlags, 'BUY_NOT_ALLOCATED', ...allocationBlockReasons]),
        },
      };
    }

    return { ...decision, allocationPosition: null };
  });

  return {
    decisions,
    allocatedCapitalUsd: round(allocated, 2),
    remainingCapitalUsd: round(remaining, 2),
    skippedForCapitalCount,
  };
}

function allocationBlocks(input: {
  decision: ScoredAcquisitionDecision;
  requiredCapital: number;
  remaining: number;
  categoryUsed: number;
  categoryLimit: number;
  familyUsed: number;
  familyLimit: number;
}): string[] {
  const reasons: string[] = [];
  if (input.decision.rules.status !== 'BUY') reasons.push('NOT_BUY_DECISION');
  if (input.requiredCapital <= 0) reasons.push('NO_DEPLOYABLE_CAPITAL');
  if (input.remaining < input.requiredCapital) reasons.push('CAPITAL_ALLOCATION_INSUFFICIENT_CASH');
  if (input.categoryUsed + input.requiredCapital > input.categoryLimit) reasons.push('CAPITAL_ALLOCATION_CATEGORY_LIMIT');
  if (input.familyUsed + input.requiredCapital > input.familyLimit) reasons.push('CAPITAL_ALLOCATION_FAMILY_LIMIT');
  return unique(reasons);
}

function unique<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

function round(value: number, places = 2): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export const allocateAcquisitionCapital = allocateAcquisitionPortfolio;
