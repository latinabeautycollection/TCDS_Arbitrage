import { evaluateAcquisitionRules } from './acquisitionRulesEngine';
import type { AllocationResult, ScoredAcquisitionDecision } from '../contracts/acquisitionDecision';

export function allocateAcquisitionPortfolio(input: {
  decisions: ScoredAcquisitionDecision[];
  cashOnHandUsd: number;
}): AllocationResult {
  const maxPriority = Math.max(1, ...input.decisions.map((d) => d.rules.priorityScore || 0));
  const rescored = input.decisions.map((decision) => {
    const relativeStrength = clamp((decision.rules.priorityScore || 0) / maxPriority, 0.45, 1);
    const rules = evaluateAcquisitionRules({ identity: decision.identity, comps: decision.comps, market: decision.market, financial: decision.financial, policy: decision.policy, safety: decision.safety, relativeStrength });
    return { ...decision, rules };
  });
  const sorted = [...rescored].sort((a, b) =>
    (b.rules.priorityScore - a.rules.priorityScore) ||
    ((b.financial.cashTurnProfit ?? 0) - (a.financial.cashTurnProfit ?? 0)) ||
    (b.financial.deployableProfitUsd - a.financial.deployableProfitUsd) ||
    (a.rules.riskScore - b.rules.riskScore),
  );
  let remaining = Math.max(0, input.cashOnHandUsd);
  let allocated = 0;
  let position = 1;
  let skippedForCapitalCount = 0;
  const categoryAllocated = new Map<string, number>();
  const familyAllocated = new Map<string, number>();

  const decisions = sorted.map((decision) => {
    const categoryKey = decision.identity.categoryKey;
    const familyKey = decision.identity.familyKey;
    const categoryLimit = input.cashOnHandUsd * decision.policy.maxCategoryCapitalPct;
    const familyLimit = input.cashOnHandUsd * decision.policy.maxFamilyCapitalPct;
    const categoryUsed = categoryAllocated.get(categoryKey) ?? 0;
    const familyUsed = familyAllocated.get(familyKey) ?? 0;
    const canAllocate = decision.rules.status === 'BUY'
      && decision.financial.deployableCapitalUsd > 0
      && remaining >= decision.financial.deployableCapitalUsd
      && categoryUsed + decision.financial.deployableCapitalUsd <= categoryLimit
      && familyUsed + decision.financial.deployableCapitalUsd <= familyLimit;

    if (canAllocate) {
      remaining = round(remaining - decision.financial.deployableCapitalUsd, 2);
      allocated = round(allocated + decision.financial.deployableCapitalUsd, 2);
      categoryAllocated.set(categoryKey, round(categoryUsed + decision.financial.deployableCapitalUsd, 2));
      familyAllocated.set(familyKey, round(familyUsed + decision.financial.deployableCapitalUsd, 2));
      return { ...decision, allocationPosition: position++ };
    }

    if (decision.rules.status === 'BUY') {
      skippedForCapitalCount += 1;
      const rules = { ...decision.rules, status: 'REVIEW' as const, rank: 'REVIEW' as const, reasonCodes: unique([...decision.rules.reasonCodes, 'REVIEW_REQUIRED_CAPITAL_OR_EXPOSURE_LIMIT']), riskFlags: unique([...decision.rules.riskFlags, 'CAPITAL_ALLOCATION_LIMIT']) };
      return { ...decision, rules, allocationPosition: null };
    }
    return { ...decision, allocationPosition: null };
  });

  return { decisions, allocatedCapitalUsd: allocated, remainingCapitalUsd: remaining, skippedForCapitalCount };
}
function unique<T>(arr: T[]): T[] { return Array.from(new Set(arr)); }
function round(value: number, places = 2): number { const factor = 10 ** places; return Math.round(value * factor) / factor; }
function clamp(value: number, min: number, max: number): number { return Math.min(max, Math.max(min, value)); }

export const allocateAcquisitionCapital = allocateAcquisitionPortfolio;
