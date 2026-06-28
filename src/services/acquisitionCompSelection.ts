import type { CompSelectionResult, NormalizedComp, NormalizedIdentity } from '../contracts/acquisitionDecision';
import { normalizeForMatch } from './acquisitionIdentity';

/**
 * Comp Selection — Green Tier 1 production rewrite.
 *
 * Fixes:
 * - Supports both existing raw JSON shape and flattened eBay comp rows.
 * - Uses identity-aware scoring instead of title-only thresholding.
 * - Prevents good iPhone / console comps from being over-rejected by one weak attribute.
 */
export function buildAcquisitionCompSet(input: {
  identity: NormalizedIdentity;
  ebayMarketJson: Record<string, unknown>;
}): CompSelectionResult {
  const soldRaw = extractArray(input.ebayMarketJson, [
    'soldSample',
    'sold_sample_json',
    'soldItems',
    'sold_items',
    'sold',
    'soldComps',
    'acceptedSoldComps',
  ]);
  const activeRaw = extractArray(input.ebayMarketJson, [
    'activeSample',
    'active_sample_json',
    'activeItems',
    'active_items',
    'active',
    'activeComps',
    'acceptedActiveComps',
  ]);

  const sold = soldRaw.map((row) => normalizeComp('sold', row, input.identity));
  const active = activeRaw.map((row) => normalizeComp('active', row, input.identity));
  const acceptedBeforeOutliers = [...sold, ...active].filter((comp) => comp.accepted);
  const { accepted, outliers } = removeOutliers(acceptedBeforeOutliers);
  const acceptedIds = new Set(accepted.map(compKey));

  const rejected = [...sold, ...active]
    .filter((comp) => !comp.accepted || outliers.some((outlier) => compKey(outlier) === compKey(comp)))
    .map((comp) => acceptedIds.has(compKey(comp))
      ? comp
      : { ...comp, accepted: false, rejectionReason: comp.rejectionReason ?? 'OUTLIER_PRICE' });

  const soldAccepted = accepted.filter((comp) => comp.source === 'sold');
  const activeAccepted = accepted.filter((comp) => comp.source === 'active');
  const compQualityScore = computeCompQuality(input.identity, soldAccepted.length, activeAccepted.length, rejected.length, outliers.length, accepted);

  const reasonCodes: string[] = [];
  const riskFlags: string[] = [];
  if (soldAccepted.length === 0) riskFlags.push('NO_SOLD_COMPS');
  if (soldAccepted.length > 0 && soldAccepted.length < 5) riskFlags.push('LOW_SOLD_COMP_COUNT');
  if (outliers.length > 0) reasonCodes.push('OUTLIERS_REMOVED');
  if (rejected.some((comp) => comp.rejectionReason === 'PARTS_ONLY_COMP')) reasonCodes.push('PARTS_ONLY_COMPS_FILTERED');
  if (rejected.some((comp) => comp.rejectionReason === 'ACCESSORY_ONLY_COMP')) reasonCodes.push('ACCESSORY_COMPS_FILTERED');

  return {
    soldComps: soldAccepted,
    activeComps: activeAccepted,
    acceptedComps: accepted,
    rejectedComps: rejected,
    outlierCount: outliers.length,
    compQualityScore,
    reasonCodes: unique(reasonCodes),
    riskFlags: unique(riskFlags),
  };
}

function normalizeComp(source: 'sold' | 'active', row: Record<string, unknown>, identity: NormalizedIdentity): NormalizedComp {
  const title = String(row.title ?? row.itemTitle ?? row.name ?? row.product_title ?? '');
  const normalizedTitle = normalizeForMatch(title);
  const priceUsd = parsePrice(
    row.total_price_amount
      ?? row.total_price_estimate
      ?? row.totalPrice
      ?? row.priceValue
      ?? row.price_usd
      ?? row.price_amount
      ?? row.price
      ?? row.currentPrice
      ?? row.soldPrice,
  );
  const conditionText = nullableString(row.conditionText ?? row.condition_text ?? row.condition ?? row.itemCondition);
  const itemId = nullableString(row.itemId ?? row.item_id ?? row.ebay_item_id ?? row.ebayItemId);
  const ebayBrand = nullableString(row.brand ?? row.ebay_brand ?? row.product_brand);
  const ebayModel = nullableString(row.model ?? row.ebay_model ?? row.product_model);
  const rejection = rejectReason({ title: normalizedTitle, conditionText, priceUsd, identity });
  const titleScore = titleSimilarity(identity.normalizedTitle, normalizedTitle);
  const identifierScore = identifierMatchScore(identity, { title: normalizedTitle, brand: ebayBrand, model: ebayModel });
  const overallScore = round(titleScore * 0.55 + identifierScore * 0.45, 4);
  const accepted = rejection === null && overallScore >= thresholdFor(identity);

  return {
    source,
    itemId,
    title,
    normalizedTitle,
    priceUsd: priceUsd ?? 0,
    conditionText,
    accepted,
    rejectionReason: accepted ? null : rejection ?? 'MATCH_SCORE_BELOW_THRESHOLD',
    similarityScore: overallScore,
    raw: row,
  };
}

function rejectReason(input: {
  title: string;
  conditionText: string | null;
  priceUsd: number | null;
  identity: NormalizedIdentity;
}): string | null {
  const text = `${input.title} ${input.conditionText ?? ''}`.toLowerCase();
  if (!input.priceUsd || input.priceUsd <= 0) return 'MISSING_PRICE';
  if (/\b(parts only|for parts|not working|broken|repair)\b/i.test(text) && input.identity.conditionState !== 'parts_only') return 'PARTS_ONLY_COMP';
  if (/\b(case only|charger only|battery only|screen protector|cover only|strap only)\b/i.test(text)) return 'ACCESSORY_ONLY_COMP';

  if (input.identity.storageGb && input.identity.categoryKey === 'mobile_phones') {
    const hasStorage = new RegExp(`\\b${input.identity.storageGb}\\s?gb\\b`, 'i').test(text);
    if (!hasStorage) return 'STORAGE_MISMATCH';
  }

  if (input.identity.carrierState === 'unlocked' && /\b(verizon|att|at&t|t-mobile|tmobile|metro|cricket|locked)\b/i.test(text) && !/\bunlocked\b/i.test(text)) {
    return 'CARRIER_MISMATCH';
  }

  if (input.identity.bundleState === 'bare' && /\bkit|bundle|with battery|with lens\b/i.test(text)) return 'BUNDLE_MISMATCH';
  if ((input.identity.bundleState === 'kit' || input.identity.bundleState === 'bundle') && /\bbody only|bare tool|tool only|no battery\b/i.test(text)) return 'BUNDLE_MISMATCH';
  return null;
}

function removeOutliers(comps: NormalizedComp[]): { accepted: NormalizedComp[]; outliers: NormalizedComp[] } {
  const soldPrices = comps.filter((comp) => comp.source === 'sold').map((comp) => comp.priceUsd).sort((a, b) => a - b);
  if (soldPrices.length < 5) return { accepted: comps, outliers: [] };
  const q1 = quantile(soldPrices, 0.25) ?? 0;
  const q3 = quantile(soldPrices, 0.75) ?? 0;
  const iqr = q3 - q1;
  if (iqr <= 0) return { accepted: comps, outliers: [] };
  const low = Math.max(0, q1 - iqr * 1.75);
  const high = q3 + iqr * 1.75;
  const outliers = comps.filter((comp) => comp.source === 'sold' && (comp.priceUsd < low || comp.priceUsd > high));
  const outlierKeys = new Set(outliers.map(compKey));
  return { accepted: comps.filter((comp) => !outlierKeys.has(compKey(comp))), outliers };
}

function computeCompQuality(
  identity: NormalizedIdentity,
  soldCount: number,
  activeCount: number,
  rejectedCount: number,
  outlierCount: number,
  accepted: NormalizedComp[],
): number {
  let score = 0.18;
  score += Math.min(0.34, soldCount / 18);
  score += Math.min(0.12, activeCount / 40);
  score += Math.min(0.20, avg(accepted.map((comp) => comp.similarityScore)) * 0.25);
  score += identity.identityConfidence * 0.18;
  score -= Math.min(0.16, rejectedCount * 0.008 + outlierCount * 0.025);
  if (soldCount >= 7) score += 0.05;
  if (soldCount >= 12) score += 0.04;
  return clamp(round(score, 4), 0, 1);
}

function identifierMatchScore(identity: NormalizedIdentity, comp: { title: string; brand: string | null; model: string | null }): number {
  let score = 0;
  let weight = 0;

  if (identity.brand) {
    weight += 0.25;
    const brand = normalizeForMatch(identity.brand);
    if (comp.title.includes(brand) || normalizeForMatch(comp.brand ?? '').includes(brand)) score += 0.25;
  }
  if (identity.model) {
    weight += 0.45;
    const modelTokens = normalizeForMatch(identity.model).split(' ').filter(Boolean);
    const matches = modelTokens.filter((token) => comp.title.includes(token) || normalizeForMatch(comp.model ?? '').includes(token)).length;
    score += 0.45 * (matches / Math.max(1, modelTokens.length));
  }
  if (identity.storageGb) {
    weight += 0.20;
    if (new RegExp(`\\b${identity.storageGb}\\s?gb\\b`, 'i').test(comp.title)) score += 0.20;
  }
  if (identity.carrierState !== 'unknown') {
    weight += 0.10;
    if (identity.carrierState === 'unlocked' ? comp.title.includes('unlocked') : /\b(verizon|att|at t|t mobile|tmobile|metro|cricket|locked)\b/i.test(comp.title)) score += 0.10;
  }

  return weight > 0 ? clamp(score / weight, 0, 1) : 0.5;
}

function thresholdFor(identity: NormalizedIdentity): number {
  if (identity.categoryKey === 'mobile_phones') return 0.48;
  if (identity.categoryKey === 'game_consoles') return 0.44;
  if (identity.categoryKey === 'audio_equipment') return 0.42;
  return 0.46;
}

function extractArray(obj: Record<string, unknown>, keys: string[]): Record<string, unknown>[] {
  for (const key of keys) {
    const value = obj[key];
    if (Array.isArray(value)) return value.filter(isRecord);
    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value);
        if (Array.isArray(parsed)) return parsed.filter(isRecord);
      } catch {}
    }
  }
  return [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function titleSimilarity(a: string, b: string): number {
  const as = new Set(a.split(' ').filter(Boolean));
  const bs = new Set(b.split(' ').filter(Boolean));
  if (!as.size || !bs.size) return 0;
  let inter = 0;
  for (const token of as) if (bs.has(token)) inter += 1;
  return inter / Math.max(as.size, bs.size);
}

function compKey(comp: NormalizedComp): string {
  return `${comp.source}:${comp.itemId ?? comp.title}:${comp.priceUsd}`;
}

function parsePrice(value: unknown): number | null {
  if (typeof value === 'object' && value) return parsePrice((value as Record<string, unknown>).amount ?? (value as Record<string, unknown>).value);
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function nullableString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s ? s : null;
}

function quantile(values: number[], q: number): number | null {
  if (!values.length) return null;
  const pos = (values.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  const lower = values[base]!;
  const upper = values[base + 1] ?? lower;
  return round(lower + rest * (upper - lower), 2);
}

function avg(values: number[]): number {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

function unique<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function round(value: number, places = 2): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}
