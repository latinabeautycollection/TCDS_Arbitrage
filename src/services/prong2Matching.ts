export interface CandidateLike {
  title: string | null;
  normalizedTitle: string | null;
  brand: string | null;
  model: string | null;
  categoryKey: string | null;
  currentPrice: number | null;
  inboundShippingUsd: number | null;
}

export interface WatchlistLike {
  categoryKey: string;
  familyName: string;
  brand: string | null;
  modelFamily: string | null;
  predictedBuyCostUsd: number | null;
  predictedSalePriceUsd: number | null;
  predictedProfitUsd: number | null;
  keywordFingerprint: string | null;
}

export interface MatchResult {
  matchScore: number;
  priceBandScore: number;
  titleScore: number;
  modelScore: number;
  brandScore: number;
  categoryScore: number;
  rejectionReason: string | null;
}

const ACCESSORY_ONLY_TERMS = new Set([
  'case','cover','strap','battery','charger','cable','adapter','manual','cap',
  'earpads','replacement','shell','screen','protector','mount','tripod','bag'
]);

export function computeMatchScore(candidate: CandidateLike, watchlist: WatchlistLike): MatchResult {
  const candidateTitle = candidate.normalizedTitle ?? candidate.title ?? '';
  const accessoryOnly = looksLikeAccessoryOnly(candidateTitle);
  if (accessoryOnly) {
    return {
      matchScore: 0,
      priceBandScore: 0,
      titleScore: 0,
      modelScore: 0,
      brandScore: 0,
      categoryScore: 0,
      rejectionReason: 'accessory_only_listing',
    };
  }

  const brandScore =
    candidate.brand && watchlist.brand &&
    candidate.brand.toLowerCase() === watchlist.brand.toLowerCase()
      ? 1
      : 0;

  const modelScore =
    candidate.model && watchlist.modelFamily
      ? titleSimilarity(candidate.model, watchlist.modelFamily)
      : 0;

  const titleScore = titleSimilarity(candidateTitle, watchlist.familyName);
  const categoryScore =
    candidate.categoryKey && candidate.categoryKey === watchlist.categoryKey ? 1 : 0;

  const totalCandidateCost =
    (candidate.currentPrice ?? 0) + (candidate.inboundShippingUsd ?? 0);
  const priceBandScore = scorePriceBand(totalCandidateCost, watchlist.predictedBuyCostUsd);

  const matchScore = round(
    brandScore * 0.22 +
      modelScore * 0.24 +
      titleScore * 0.24 +
      categoryScore * 0.10 +
      priceBandScore * 0.20,
    4,
  );

  return {
    matchScore,
    priceBandScore,
    titleScore,
    modelScore,
    brandScore,
    categoryScore,
    rejectionReason: null,
  };
}

export function titleSimilarity(a: string, b: string): number {
  const left = new Set(normalizeTokens(a));
  const right = new Set(normalizeTokens(b));
  if (left.size === 0 || right.size === 0) return 0;

  let intersection = 0;
  for (const token of left) {
    if (right.has(token)) intersection += 1;
  }

  const union = new Set([...left, ...right]).size;
  return union === 0 ? 0 : round(intersection / union, 4);
}

function scorePriceBand(candidateTotalCost: number, predictedBuyCostUsd: number | null): number {
  if (!Number.isFinite(candidateTotalCost) || candidateTotalCost <= 0 || predictedBuyCostUsd === null || predictedBuyCostUsd <= 0) {
    return 0.10;
  }

  const ratio = candidateTotalCost / predictedBuyCostUsd;
  if (ratio <= 0.85) return 1.0;
  if (ratio <= 1.00) return 0.90;
  if (ratio <= 1.10) return 0.70;
  if (ratio <= 1.20) return 0.45;
  return 0.10;
}

function looksLikeAccessoryOnly(title: string): boolean {
  const tokens = normalizeTokens(title);
  const hits = tokens.filter((t) => ACCESSORY_ONLY_TERMS.has(t)).length;
  return hits >= 2 || (hits >= 1 && !tokens.some((t) => /\d/.test(t)));
}

function normalizeTokens(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s\-]/gu, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
}

function round(value: number, places = 4): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}
