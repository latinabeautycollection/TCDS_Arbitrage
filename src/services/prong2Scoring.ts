import crypto from 'node:crypto';
import type { NormalizedBrowseItem } from './ebayClient';

export interface FamilyAggregate {
  familyKey: string;
  familyName: string;
  brand: string | null;
  modelFamily: string | null;
  normalizedTitle: string;
  categoryKey: string;
  soldItems: NormalizedBrowseItem[];
  activeItems: NormalizedBrowseItem[];
  soldPrices: number[];
  activePrices: number[];
}

export interface FamilyScore {
  soldCount: number;
  activeCount: number;
  soldMedian: number | null;
  soldP25: number | null;
  soldP75: number | null;
  activeMedian: number | null;
  demandScore: number;
  priceStabilityScore: number;
  competitionScore: number;
  propertyroomSupplyFitScore: number;
  predictedBuyCostUsd: number | null;
  predictedSalePriceUsd: number | null;
  predictedProfitUsd: number | null;
  predictedMarginPct: number | null;
  overallWatchScore: number;
}

export interface ScoredFamily extends FamilyAggregate {
  score: FamilyScore;
  sourceRank: number;
}

export interface ScoringDiagnostics {
  soldItemsIn: number;
  activeItemsIn: number;
  soldItemsValidPrice: number;
  activeItemsValidPrice: number;
  soldItemsFilteredAccessoryOnly: number;
  activeItemsFilteredAccessoryOnly: number;
  soldItemsMissingPrice: number;
  activeItemsMissingPrice: number;
  familiesCreatedBeforeScoring: number;
  familiesAfterScoring: number;
  familiesAfterSoldCountGate: number;
}

export interface ScoreFamiliesResult {
  families: ScoredFamily[];
  diagnostics: ScoringDiagnostics;
}

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'body', 'kit', 'camera', 'wireless', 'new', 'used',
  'excellent', 'very', 'good', 'grade', 'digital', 'black', 'blue', 'white', 'silver',
  'gray', 'grey', 'edition', 'model',
]);

const ACCESSORY_ONLY_TERMS = new Set([
  'case', 'cover', 'strap', 'battery', 'charger', 'cable', 'adapter', 'manual', 'cap',
  'earpads', 'replacement', 'shell', 'screen', 'protector', 'mount', 'tripod', 'bag',
]);

export function scoreFamilies(input: {
  categoryKey: string;
  soldItems: NormalizedBrowseItem[];
  activeItems: NormalizedBrowseItem[];
  minimumSoldCount?: number;
}): ScoreFamiliesResult {
  const minimumSoldCount = input.minimumSoldCount ?? 1;
  const families = new Map<string, FamilyAggregate>();

  const diagnostics: ScoringDiagnostics = {
    soldItemsIn: input.soldItems.length,
    activeItemsIn: input.activeItems.length,
    soldItemsValidPrice: 0,
    activeItemsValidPrice: 0,
    soldItemsFilteredAccessoryOnly: 0,
    activeItemsFilteredAccessoryOnly: 0,
    soldItemsMissingPrice: 0,
    activeItemsMissingPrice: 0,
    familiesCreatedBeforeScoring: 0,
    familiesAfterScoring: 0,
    familiesAfterSoldCountGate: 0,
  };

  for (const item of input.soldItems) {
    if (!hasPositivePrice(item)) {
      diagnostics.soldItemsMissingPrice += 1;
      continue;
    }
    diagnostics.soldItemsValidPrice += 1;

    if (looksLikeAccessoryOnly(item.title)) {
      diagnostics.soldItemsFilteredAccessoryOnly += 1;
      continue;
    }

    addItemToFamily(families, input.categoryKey, item, 'sold');
  }

  for (const item of input.activeItems) {
    if (!hasPositivePrice(item)) {
      diagnostics.activeItemsMissingPrice += 1;
      continue;
    }
    diagnostics.activeItemsValidPrice += 1;

    if (looksLikeAccessoryOnly(item.title)) {
      diagnostics.activeItemsFilteredAccessoryOnly += 1;
      continue;
    }

    addItemToFamily(families, input.categoryKey, item, 'active');
  }

  diagnostics.familiesCreatedBeforeScoring = families.size;

  const scored = [...families.values()]
    .map((family) => ({
      ...family,
      soldPrices: [...family.soldPrices].sort((a, b) => a - b),
      activePrices: [...family.activePrices].sort((a, b) => a - b),
    }))
    .map((family) => ({ ...family, score: deriveFamilyScore(family) }));

  diagnostics.familiesAfterScoring = scored.length;

  const filtered = scored
    .filter((family) => family.score.soldCount >= minimumSoldCount)
    .sort((a, b) => b.score.overallWatchScore - a.score.overallWatchScore)
    .map((family, index) => ({ ...family, sourceRank: index + 1 }));

  diagnostics.familiesAfterSoldCountGate = filtered.length;

  return {
    families: filtered,
    diagnostics,
  };
}

export function deriveFamilyScore(family: FamilyAggregate): FamilyScore {
  const soldCount = family.soldPrices.length;
  const activeCount = family.activePrices.length;

  const soldMedian = quantile(family.soldPrices, 0.5);
  const soldP25 = quantile(family.soldPrices, 0.25);
  const soldP75 = quantile(family.soldPrices, 0.75);
  const activeMedian = quantile(family.activePrices, 0.5);

  const demandScore = scoreDemand(soldCount);
  const priceStabilityScore = scorePriceStability(soldP25, soldP75, soldMedian);
  const competitionScore = scoreCompetition(activeCount, soldCount);
  const propertyroomSupplyFitScore = scoreSupplyFit(soldCount, activeMedian);

  const predictedBuyCostUsd = soldP25 !== null ? round(soldP25 * 0.72, 2) : null;
  const predictedSalePriceUsd = soldMedian !== null ? round(soldMedian, 2) : null;
  const predictedProfitUsd =
    predictedBuyCostUsd !== null && predictedSalePriceUsd !== null
      ? round(predictedSalePriceUsd * (1 - 0.195) - predictedBuyCostUsd, 2)
      : null;
  const predictedMarginPct =
    predictedSalePriceUsd !== null && predictedProfitUsd !== null && predictedSalePriceUsd > 0
      ? round(predictedProfitUsd / predictedSalePriceUsd, 4)
      : null;

  const overallWatchScore = round(
    demandScore * 0.30 +
      priceStabilityScore * 0.20 +
      competitionScore * 0.15 +
      propertyroomSupplyFitScore * 0.15 +
      normalizeProfitScore(predictedProfitUsd) * 0.20,
    4,
  );

  return {
    soldCount,
    activeCount,
    soldMedian,
    soldP25,
    soldP75,
    activeMedian,
    demandScore,
    priceStabilityScore,
    competitionScore,
    propertyroomSupplyFitScore,
    predictedBuyCostUsd,
    predictedSalePriceUsd,
    predictedProfitUsd,
    predictedMarginPct,
    overallWatchScore,
  };
}

export function keywordFingerprint(parts: string[]): string {
  return crypto.createHash('sha1').update(parts.join('|')).digest('hex');
}

function addItemToFamily(
  families: Map<string, FamilyAggregate>,
  categoryKey: string,
  item: NormalizedBrowseItem,
  mode: 'sold' | 'active',
): void {
  const family = deriveFamily(categoryKey, item);
  const existing = families.get(family.familyKey) ?? {
    ...family,
    soldItems: [],
    activeItems: [],
    soldPrices: [],
    activePrices: [],
  };

  if (mode === 'sold') {
    existing.soldItems.push(item);
    if (item.priceValue !== null && item.priceValue > 0) {
      existing.soldPrices.push(item.priceValue);
    }
  } else {
    existing.activeItems.push(item);
    if (item.priceValue !== null && item.priceValue > 0) {
      existing.activePrices.push(item.priceValue);
    }
  }

  families.set(existing.familyKey, existing);
}

function deriveFamily(
  categoryKey: string,
  item: NormalizedBrowseItem,
): Omit<FamilyAggregate, 'soldItems' | 'activeItems' | 'soldPrices' | 'activePrices'> {
  const normalized = normalizeWhitespace(item.title);
  const brand = deriveBrand(normalized);
  const tokens = normalizeTitleTokens(normalized);
  const modelTokens = tokens.slice(0, 5);
  const familyName = normalizeWhitespace([brand, ...modelTokens].filter(Boolean).join(' '));
  const familyKey = slugify(familyName || normalized).slice(0, 120);

  return {
    familyKey,
    familyName: familyName || normalized,
    brand,
    modelFamily: modelTokens.join(' ') || null,
    normalizedTitle: normalized,
    categoryKey,
  };
}

function deriveBrand(title: string): string | null {
  const first = normalizeTitleTokens(title)[0];
  return first ? first[0]!.toUpperCase() + first.slice(1) : null;
}

function normalizeTitleTokens(value: string): string[] {
  return normalizeWhitespace(value)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s\-]/gu, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2)
    .filter((token) => !STOP_WORDS.has(token));
}

function hasPositivePrice(item: NormalizedBrowseItem): boolean {
  return typeof item.priceValue === 'number' && Number.isFinite(item.priceValue) && item.priceValue > 0;
}

function looksLikeAccessoryOnly(title: string): boolean {
  const tokens = normalizeTitleTokens(title);
  const hits = tokens.filter((t) => ACCESSORY_ONLY_TERMS.has(t)).length;

  return hits >= 2 || (hits >= 1 && !tokens.some((t) => /\d/.test(t)));
}

function quantile(values: number[], q: number): number | null {
  if (values.length === 0) return null;
  if (values.length === 1) return round(values[0]!, 2);

  const pos = (values.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  const lower = values[base]!;
  const upper = values[base + 1] ?? lower;

  return round(lower + rest * (upper - lower), 2);
}

function scoreDemand(soldCount: number): number {
  if (soldCount >= 20) return 0.98;
  if (soldCount >= 15) return 0.92;
  if (soldCount >= 10) return 0.80;
  if (soldCount >= 6) return 0.60;
  if (soldCount >= 3) return 0.35;
  if (soldCount >= 1) return 0.20;
  return 0.10;
}

function scorePriceStability(
  soldP25: number | null,
  soldP75: number | null,
  soldMedian: number | null,
): number {
  if (!soldP25 || !soldP75 || !soldMedian || soldMedian <= 0) return 0.10;
  const spread = (soldP75 - soldP25) / soldMedian;
  if (spread <= 0.15) return 0.95;
  if (spread <= 0.30) return 0.80;
  if (spread <= 0.45) return 0.60;
  if (spread <= 0.70) return 0.35;
  return 0.15;
}

function scoreCompetition(activeCount: number, soldCount: number): number {
  if (soldCount <= 0) return 0.10;
  const ratio = activeCount / soldCount;
  if (ratio <= 1.5) return 0.95;
  if (ratio <= 2.5) return 0.80;
  if (ratio <= 3.5) return 0.60;
  if (ratio <= 5.0) return 0.35;
  return 0.15;
}

function scoreSupplyFit(soldCount: number, activeMedian: number | null): number {
  let score = 0.30;
  if (soldCount >= 8) score += 0.30;
  if (activeMedian !== null && activeMedian >= 80 && activeMedian <= 600) score += 0.25;
  if (activeMedian !== null && activeMedian >= 100 && activeMedian <= 400) score += 0.10;
  return Math.min(round(score, 4), 0.95);
}

function normalizeProfitScore(predictedProfitUsd: number | null): number {
  if (predictedProfitUsd === null) return 0.10;
  if (predictedProfitUsd >= 120) return 0.95;
  if (predictedProfitUsd >= 80) return 0.80;
  if (predictedProfitUsd >= 50) return 0.65;
  if (predictedProfitUsd >= 25) return 0.40;
  if (predictedProfitUsd > 0) return 0.20;
  return 0.05;
}

function slugify(value: string): string {
  return normalizeWhitespace(value)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s\-]/gu, '')
    .replace(/\s+/g, '-');
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function round(value: number, places = 2): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}
