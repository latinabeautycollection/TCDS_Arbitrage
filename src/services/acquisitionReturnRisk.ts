import type { ReturnRiskInput, ReturnRiskOutput } from '../contracts/acquisitionExecutionIntegrity';

const CATEGORY_BASE_RETURN_RISK: Array<[RegExp, number]> = [
  [/phone|tablet|laptop|console/i, 0.11],
  [/camera|lens/i, 0.13],
  [/tool/i, 0.075],
  [/appliance|vacuum|printer/i, 0.12],
  [/audio|receiver|speaker/i, 0.10],
];

const CATEGORY_BASE_DISPUTE_RISK: Array<[RegExp, number]> = [
  [/phone|tablet|laptop|console/i, 0.055],
  [/camera|lens/i, 0.065],
  [/tool/i, 0.035],
  [/appliance|vacuum|printer/i, 0.060],
  [/audio|receiver|speaker/i, 0.050],
];

export function modelAcquisitionReturnRisk(input: ReturnRiskInput): ReturnRiskOutput {
  const categoryKey = input.categoryKey ?? 'unknown';
  const estimatedSalePriceUsd = positive(input.estimatedSalePriceUsd);
  const ambiguityCount = input.ambiguitySignals?.length ?? 0;
  const categoryReturnBase = lookupRisk(categoryKey, CATEGORY_BASE_RETURN_RISK, 0.08);
  const categoryDisputeBase = lookupRisk(categoryKey, CATEGORY_BASE_DISPUTE_RISK, 0.04);

  const confidencePenalty = clamp01((1 - input.identityConfidenceScore) * 0.18 + (1 - input.compConfidenceScore) * 0.16);
  const descriptionPenalty = clamp01((1 - input.descriptionQualityScore) * 0.12);
  const ambiguityPenalty = clamp01(ambiguityCount * 0.025);
  const fragilePenalty = input.fragile ? 0.035 : 0;
  const highValuePenalty = input.highValue || estimatedSalePriceUsd >= 500 ? 0.025 : 0;
  const shippingPenalty = clamp01(input.shippingRiskScore * 0.10);

  const returnProbability = clamp01(categoryReturnBase + confidencePenalty + descriptionPenalty + ambiguityPenalty + fragilePenalty + highValuePenalty + shippingPenalty);
  const disputeProbability = clamp01(categoryDisputeBase + confidencePenalty * 0.65 + ambiguityPenalty + highValuePenalty + shippingPenalty * 0.80);
  const damageProbability = clamp01((input.fragile ? 0.035 : 0.012) + input.shippingRiskScore * 0.045);

  const returnReserveUsd = round(estimatedSalePriceUsd * returnProbability * 0.55, 2);
  const disputeReserveUsd = round(estimatedSalePriceUsd * disputeProbability * 0.65, 2);
  const damageReserveUsd = round(estimatedSalePriceUsd * damageProbability, 2);
  const returnRiskScore = clamp01(returnProbability * 0.45 + disputeProbability * 0.35 + damageProbability * 0.20);

  const reasonCodes: string[] = [];
  if (returnProbability >= 0.18) reasonCodes.push('HIGH_RETURN_PROBABILITY');
  if (disputeProbability >= 0.10) reasonCodes.push('HIGH_DISPUTE_PROBABILITY');
  if (input.identityConfidenceScore < 0.70) reasonCodes.push('RETURN_RISK_LOW_IDENTITY_CONFIDENCE');
  if (input.descriptionQualityScore < 0.70) reasonCodes.push('RETURN_RISK_WEAK_DESCRIPTION');
  if (ambiguityCount > 0) reasonCodes.push('RETURN_RISK_SOURCE_AMBIGUITY');
  if (input.fragile) reasonCodes.push('RETURN_RISK_FRAGILE_ITEM');

  return {
    returnProbability: round(returnProbability, 4),
    disputeProbability: round(disputeProbability, 4),
    returnReserveUsd,
    disputeReserveUsd,
    damageReserveUsd,
    returnRiskScore: round(returnRiskScore, 4),
    reasonCodes,
    evidence: {
      categoryKey,
      categoryReturnBase,
      categoryDisputeBase,
      confidencePenalty,
      descriptionPenalty,
      ambiguityPenalty,
      fragilePenalty,
      highValuePenalty,
      shippingPenalty,
      ambiguitySignals: input.ambiguitySignals ?? [],
    },
  };
}

function lookupRisk(category: string, rules: Array<[RegExp, number]>, fallback: number): number {
  return rules.find(([regex]) => regex.test(category))?.[1] ?? fallback;
}

function positive(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function round(value: number, places = 2): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}
