import type { DisputeDefenseInput, DisputeDefenseOutput, ForensicEventType } from '../contracts/acquisitionExecutionIntegrity';
import { requiredEvidenceForCategory } from './acquisitionForensicChain';

export function evaluateDisputeDefense(input: DisputeDefenseInput): DisputeDefenseOutput {
  const requiredEvidence = requiredEvidenceForCategory(input.categoryKey, input.estimatedSalePriceUsd);
  if (input.serialRequired && !requiredEvidence.includes('SERIAL_CAPTURED')) requiredEvidence.push('SERIAL_CAPTURED');

  const missingEvidence = inferMissingEvidence(requiredEvidence, input.forensicCompletenessScore);
  const evidenceScore = input.forensicCompletenessScore;
  const descriptionScore = input.listingOutput.descriptionQualityScore;
  const shippingConfidence = input.shippingOutput.shippingConfidenceScore;
  const returnRiskInverse = 1 - input.returnRiskOutput.returnRiskScore;
  const reasonCodes: string[] = [];

  const defensibilityScore = clamp01(
    0.32 * evidenceScore +
      0.24 * descriptionScore +
      0.18 * shippingConfidence +
      0.16 * returnRiskInverse +
      0.10 * (input.listingOutput.defenseLanguage.length >= 3 ? 1 : 0.6),
  );

  const sellerProtectionScore = clamp01(
    defensibilityScore -
      (input.shippingOutput.highValue ? 0.04 : 0) -
      (input.shippingOutput.fragile ? 0.05 : 0) -
      (input.returnRiskOutput.disputeProbability > 0.10 ? 0.08 : 0),
  );

  if (evidenceScore < 0.75) reasonCodes.push('FORENSIC_CHAIN_INCOMPLETE');
  if (descriptionScore < 0.70) reasonCodes.push('LISTING_DESCRIPTION_WEAK_FOR_DISPUTE_DEFENSE');
  if (shippingConfidence < 0.65) reasonCodes.push('SHIPPING_EVIDENCE_OR_COST_UNCERTAIN');
  if (input.returnRiskOutput.disputeProbability >= 0.10) reasonCodes.push('HIGH_DISPUTE_PROBABILITY');
  if (input.shippingOutput.highValue) reasonCodes.push('HIGH_VALUE_SELLER_PROTECTION_REQUIRED');
  if (missingEvidence.length > 0) reasonCodes.push('MISSING_REQUIRED_FORENSIC_EVIDENCE');

  let recommendedAction: DisputeDefenseOutput['recommendedAction'] = 'PROCEED';
  if (sellerProtectionScore < 0.55 || (input.estimatedSalePriceUsd >= 250 && evidenceScore < 0.70)) {
    recommendedAction = 'BLOCK_UNTIL_EVIDENCE_COMPLETE';
  } else if (sellerProtectionScore < 0.72 || reasonCodes.length > 0) {
    recommendedAction = 'REVIEW';
  }

  return {
    defensibilityScore: round(defensibilityScore, 4),
    sellerProtectionScore: round(sellerProtectionScore, 4),
    requiredEvidence,
    missingEvidence,
    recommendedAction,
    reasonCodes,
    evidence: {
      listingId: input.listingId,
      categoryKey: input.categoryKey,
      decisionRank: input.decisionRank ?? null,
      estimatedSalePriceUsd: input.estimatedSalePriceUsd,
      shippingReasonCodes: input.shippingOutput.reasonCodes,
      listingRiskFlags: input.listingOutput.listingRiskFlags,
      returnRiskReasonCodes: input.returnRiskOutput.reasonCodes,
    },
  };
}

function inferMissingEvidence(requiredEvidence: ForensicEventType[], completenessScore: number): ForensicEventType[] {
  if (completenessScore >= 0.95) return [];
  if (completenessScore >= 0.80) return requiredEvidence.includes('SERIAL_CAPTURED') ? ['SERIAL_CAPTURED'] : [];
  if (completenessScore >= 0.60) return requiredEvidence.filter((event) => ['SERIAL_CAPTURED', 'PACKAGED', 'SHIPPING_LABEL_CREATED'].includes(event));
  return requiredEvidence;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function round(value: number, places = 2): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}
