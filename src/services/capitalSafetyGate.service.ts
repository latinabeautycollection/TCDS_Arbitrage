import type { CapitalSafetyGateResult, CapitalSafetyPolicy, SafetyDecisionInput } from '../contracts/capitalSafety.types';

export function evaluateCapitalSafetyGate(
  input: SafetyDecisionInput,
  policy: CapitalSafetyPolicy,
): CapitalSafetyGateResult {
  const reasons = new Set<string>(input.reasonCodes ?? []);
  const risks = new Set<string>(input.riskFlags ?? []);

  const decision = normalizeDecision(input.decision);

    if (decision === 'BUY') {
    if ((input.expectedProfitUsd ?? Number.NEGATIVE_INFINITY) <= 0) reasons.add('CAPITAL_GATE_PROFIT_NOT_POSITIVE');
    if ((input.soldCount ?? 0) < policy.minCompCount) reasons.add('CAPITAL_GATE_LOW_COMP_COUNT');
    if ((input.identityConfidence ?? 0) < policy.minIdentityConfidence) reasons.add('CAPITAL_GATE_LOW_IDENTITY_CONFIDENCE');
    if (input.riskScore !== null && input.riskScore !== undefined && input.riskScore > policy.maxRiskScore) {
      reasons.add('CAPITAL_GATE_RISK_TOO_HIGH');
    }
    const ratio = input.activeToSoldRatio;
    if (ratio !== null && ratio !== undefined && ratio > policy.maxActiveToSoldRatio) {
      reasons.add('CAPITAL_GATE_ACTIVE_TO_SOLD_TOO_HIGH');
    }

    if (policy.blockUngroundedBuy && (input.compGroundingScore ?? 0) < policy.minCompGroundingScore) {
      reasons.add('CAPITAL_GATE_WEAK_COMP_GROUNDING');
    }

    if (input.replayStatus === 'FAIL') reasons.add('CAPITAL_GATE_REPLAY_FAILED');
    if (policy.ledgerRequiredForBuy && input.ledgerContinuityOk === false) reasons.add('CAPITAL_GATE_LEDGER_CONTINUITY_FAILED');

    // Phase 2.9 spec criteria
    if (input.profitAnalysisDecisionCode !== 'BUY') reasons.add('CAPITAL_GATE_PROFIT_ANALYSIS_NOT_BUY');
    if (input.dedupeGateStatus !== 'PRIMARY') reasons.add('CAPITAL_GATE_NOT_DEDUPE_PRIMARY');
    if (input.reviewRequired === true) reasons.add('CAPITAL_GATE_REVIEW_REQUIRED');
    if (input.isBundle === true) reasons.add('CAPITAL_GATE_IS_BUNDLE');
    if (input.candidateTitle && /\b(parts|lot|bundle)\b/i.test(input.candidateTitle)) {
      reasons.add('CAPITAL_GATE_TITLE_PARTS_LOT_BUNDLE');
    }
    if ((input.totalCostBasisUsd ?? 0) <= 0) reasons.add('CAPITAL_GATE_COST_BASIS_INCOMPLETE');
  }

  const hardBlockReasons = [...reasons].filter((code) => code.startsWith('CAPITAL_GATE_'));

  if (decision === 'BUY' && hardBlockReasons.length > 0) {
    hardBlockReasons.forEach((reason) => risks.add(reason));
    return {
      assessmentStatus: 'BLOCKED',
      capitalGateStatus: 'BLOCK',
      gateReasonCodes: [...reasons],
      riskFlags: [...risks],
      allowedDecision: 'REVIEW',
      explanation: `BUY blocked by capital safety gate: ${hardBlockReasons.join(', ')}`,
    };
  }

  if (decision === 'BUY') {
    reasons.add('CAPITAL_GATE_PASSED');
    return {
      assessmentStatus: 'PASSED',
      capitalGateStatus: 'PASS',
      gateReasonCodes: [...reasons],
      riskFlags: [...risks],
      allowedDecision: 'BUY',
      explanation: 'BUY allowed: capital safety gate passed.',
    };
  }

  return {
    assessmentStatus: 'PASSED',
    capitalGateStatus: 'PASS',
    gateReasonCodes: [...reasons, 'CAPITAL_GATE_NON_BUY_SAFE'],
    riskFlags: [...risks],
    allowedDecision: decision,
    explanation: `${decision} passed safety gate because no capital deployment is authorized.`,
  };
}

function normalizeDecision(value: SafetyDecisionInput['decision']): CapitalSafetyGateResult['allowedDecision'] {
  if (value === 'REJECT') return 'PASS';
  return value;
}
