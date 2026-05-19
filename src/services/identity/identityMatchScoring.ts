import type { IdentityMatchScore, NormalizedProductIdentity } from './commonIdentity';
import { tokenize } from './normalizeText';

function eq(a: string | null, b: string | null): number {
  return a && b && a === b ? 1 : 0;
}

function overlap(a: string | null, b: string | null): number {
  if (!a || !b) return 0;
  return a.includes(b) || b.includes(a) ? 1 : 0;
}

function tokenJaccard(leftText: string | null, rightText: string | null): number {
  if (!leftText || !rightText) return 0;
  const left = new Set(tokenize(leftText));
  const right = new Set(tokenize(rightText));
  if (left.size === 0 || right.size === 0) return 0;
  let intersection = 0;
  for (const token of left) if (right.has(token)) intersection += 1;
  const union = new Set([...left, ...right]).size;
  return union === 0 ? 0 : intersection / union;
}

function priceBandScore(candidateTotalCost: number | null, predictedBuyCostUsd: number | null): number {
  if (!candidateTotalCost || !predictedBuyCostUsd || predictedBuyCostUsd <= 0) return 0.10;
  const ratio = candidateTotalCost / predictedBuyCostUsd;
  if (ratio <= 0.85) return 1.0;
  if (ratio <= 1.00) return 0.90;
  if (ratio <= 1.10) return 0.70;
  if (ratio <= 1.20) return 0.45;
  return 0.10;
}

function classify(finalScore: number): IdentityMatchScore['matchClass'] {
  if (finalScore >= 0.85) return 'exact_match';
  if (finalScore >= 0.70) return 'strong_family_match';
  if (finalScore >= 0.55) return 'probable_match';
  if (finalScore >= 0.35) return 'weak_match';
  return 'no_match';
}

export function computeIdentityMatchScore(input: {
  candidate: NormalizedProductIdentity;
  watchlist: NormalizedProductIdentity;
  candidateTitle: string | null;
  watchlistFamilyName: string;
  candidateTotalCost: number | null;
  predictedBuyCostUsd: number | null;
}): IdentityMatchScore {
  const canonicalKeyScore = eq(input.candidate.canonicalProductKey, input.watchlist.canonicalProductKey);
  const brandScore = eq(input.candidate.normalizedBrand, input.watchlist.normalizedBrand);
  const productTypeScore = eq(input.candidate.normalizedProductType, input.watchlist.normalizedProductType);
  const modelFamilyScore = overlap(input.candidate.normalizedModelFamily, input.watchlist.normalizedModelFamily);
  const modelTokenScore = overlap(input.candidate.normalizedModelToken, input.watchlist.normalizedModelToken);
  const generationScore = eq(input.candidate.normalizedGeneration, input.watchlist.normalizedGeneration);
  const variantScore = eq(input.candidate.normalizedVariant, input.watchlist.normalizedVariant);
  const storageScore = eq(input.candidate.normalizedStorage, input.watchlist.normalizedStorage);
  const platformScore = eq(input.candidate.normalizedPlatform, input.watchlist.normalizedPlatform);

  const accessoryCompatibilityScore =
    input.candidate.isAccessory === input.watchlist.isAccessory ? 1 : 0;

  const bundleCompatibilityScore =
    input.candidate.isBundle === input.watchlist.isBundle ? 1 : 0.25;

  const titleSimilarityScore = tokenJaccard(
    input.candidateTitle,
    input.watchlistFamilyName,
  );

  const candidateConfidence = input.candidate.identityConfidence || 0;
  const watchlistConfidence = input.watchlist.identityConfidence || 0;
  const identityConfidenceScore = (candidateConfidence + watchlistConfidence) / 2;

  const bandScore = priceBandScore(input.candidateTotalCost, input.predictedBuyCostUsd);

  const finalScore =
    canonicalKeyScore * 0.20 +
    brandScore * 0.10 +
    productTypeScore * 0.08 +
    modelFamilyScore * 0.14 +
    modelTokenScore * 0.14 +
    generationScore * 0.05 +
    variantScore * 0.04 +
    storageScore * 0.04 +
    platformScore * 0.05 +
    accessoryCompatibilityScore * 0.04 +
    bundleCompatibilityScore * 0.03 +
    titleSimilarityScore * 0.05 +
    bandScore * 0.04 +
    identityConfidenceScore * 0.04;

  return {
    canonicalKeyScore,
    brandScore,
    productTypeScore,
    modelFamilyScore,
    modelTokenScore,
    generationScore,
    variantScore,
    storageScore,
    platformScore,
    accessoryCompatibilityScore,
    bundleCompatibilityScore,
    titleSimilarityScore,
    priceBandScore: bandScore,
    identityConfidenceScore,
    finalScore: Math.round(finalScore * 10000) / 10000,
    matchClass: classify(finalScore),
  };
}
