import type { CompGroundingInput, CompGroundingResult } from '../contracts/capitalSafety.types';

export function evaluateCompGrounding(input: CompGroundingInput): CompGroundingResult {
  const activeToSoldRatio = input.soldCount > 0 ? round(input.activeCount / input.soldCount, 4) : null;
  const sampleScore = clamp01(input.soldCount / 10);
  const ratioScore = activeToSoldRatio === null ? 0 : clamp01(1 - Math.max(0, activeToSoldRatio - 1) / 5);
  const score = clamp01(
    0.25 * sampleScore +
    0.20 * input.identityConfidence +
    0.20 * input.titleFitScore +
    0.15 * input.categoryFitScore +
    0.10 * input.conditionFitScore +
    0.10 * ratioScore,
  );

  const reasonCodes: string[] = [];
  if (input.soldCount < 3) reasonCodes.push('GROUNDING_LOW_SOLD_COUNT');
  if (input.identityConfidence < 0.6) reasonCodes.push('GROUNDING_LOW_IDENTITY_CONFIDENCE');
  if (input.titleFitScore < 0.5) reasonCodes.push('GROUNDING_WEAK_TITLE_FIT');
  if (input.categoryFitScore < 0.5) reasonCodes.push('GROUNDING_CATEGORY_MISMATCH');
  if (activeToSoldRatio !== null && activeToSoldRatio > 5) reasonCodes.push('GROUNDING_ACTIVE_TO_SOLD_TOO_HIGH');

  const groundingStatus = score >= 0.7 && reasonCodes.length === 0 ? 'PASS' : score >= 0.5 ? 'REVIEW' : 'FAIL';

  return { groundingScore: round(score, 4), groundingStatus, reasonCodes, activeToSoldRatio };
}

function clamp01(n: number): number { return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0; }
function round(n: number, p = 2): number { const f = 10 ** p; return Math.round(n * f) / f; }
