import type { CompSelectionResult, NormalizedComp, NormalizedIdentity } from '../contracts/acquisitionDecision';
import { normalizeForMatch } from './acquisitionIdentity';

export function buildAcquisitionCompSet(input: { identity: NormalizedIdentity; ebayMarketJson: Record<string, unknown> }): CompSelectionResult {
  const soldRaw = extractArray(input.ebayMarketJson, ['soldSample', 'sold_sample_json', 'soldItems', 'sold_items', 'sold']);
  const activeRaw = extractArray(input.ebayMarketJson, ['activeSample', 'active_sample_json', 'activeItems', 'active_items', 'active']);
  const sold = soldRaw.map((row) => normalizeComp('sold', row, input.identity));
  const active = activeRaw.map((row) => normalizeComp('active', row, input.identity));
  const acceptedBeforeOutliers = [...sold, ...active].filter((comp) => comp.accepted);
  const { accepted, outliers } = removeOutliers(acceptedBeforeOutliers);
  const acceptedIds = new Set(accepted.map(compKey));
  const rejected = [...sold, ...active].filter((comp) => !comp.accepted || outliers.some((o) => compKey(o) === compKey(comp))).map((comp) => acceptedIds.has(compKey(comp)) ? comp : { ...comp, accepted: false, rejectionReason: comp.rejectionReason ?? 'OUTLIER_PRICE' });
  const soldAccepted = accepted.filter((c) => c.source === 'sold');
  const activeAccepted = accepted.filter((c) => c.source === 'active');
  const compQualityScore = computeCompQuality(input.identity, soldAccepted.length, activeAccepted.length, rejected.length, outliers.length, accepted);
  const reasonCodes: string[] = [];
  const riskFlags: string[] = [];
  if (soldAccepted.length === 0) riskFlags.push('NO_SOLD_COMPS');
  if (soldAccepted.length < 5) riskFlags.push('LOW_SOLD_COMP_COUNT');
  if (outliers.length > 0) reasonCodes.push('OUTLIERS_REMOVED');
  if (rejected.some((c) => c.rejectionReason === 'PARTS_ONLY_COMP')) reasonCodes.push('PARTS_ONLY_COMPS_FILTERED');

  return { soldComps: soldAccepted, activeComps: activeAccepted, acceptedComps: accepted, rejectedComps: rejected, outlierCount: outliers.length, compQualityScore, reasonCodes, riskFlags };
}

function normalizeComp(source: 'sold' | 'active', row: Record<string, unknown>, identity: NormalizedIdentity): NormalizedComp {
  const title = String(row.title ?? row.itemTitle ?? row.name ?? '');
  const normalizedTitle = normalizeForMatch(title);
  const priceUsd = parsePrice(row.priceValue ?? row.price_usd ?? row.price ?? row.currentPrice ?? row.soldPrice);
  const conditionText = nullableString(row.conditionText ?? row.condition ?? row.itemCondition);
  const itemId = nullableString(row.itemId ?? row.item_id ?? row.ebay_item_id);
  const rejection = rejectReason({ title: normalizedTitle, conditionText, priceUsd, identity });
  const similarityScore = titleSimilarity(identity.normalizedTitle, normalizedTitle);
  const accepted = rejection === null && similarityScore >= 0.18;
  return { source, itemId, title, normalizedTitle, priceUsd: priceUsd ?? 0, conditionText, accepted, rejectionReason: accepted ? null : rejection ?? 'LOW_TITLE_SIMILARITY', similarityScore, raw: row };
}

function rejectReason(input: { title: string; conditionText: string | null; priceUsd: number | null; identity: NormalizedIdentity }): string | null {
  const text = `${input.title} ${input.conditionText ?? ''}`.toLowerCase();
  if (!input.priceUsd || input.priceUsd <= 0) return 'MISSING_PRICE';
  if (/\b(parts only|for parts|not working|broken|repair)\b/i.test(text) && input.identity.conditionState !== 'parts_only') return 'PARTS_ONLY_COMP';
  if (/\b(case only|charger only|battery only|screen protector|cover only)\b/i.test(text)) return 'ACCESSORY_ONLY_COMP';
  if (input.identity.storageGb && !new RegExp(`\\b${input.identity.storageGb}\\s?gb\\b`, 'i').test(text) && input.identity.categoryKey === 'phones') return 'STORAGE_MISMATCH';
  if (input.identity.carrierState === 'unlocked' && /\b(verizon|att|t-mobile|locked)\b/i.test(text) && !/\bunlocked\b/i.test(text)) return 'CARRIER_MISMATCH';
  if (input.identity.bundleState === 'bare' && /\bkit|bundle|with battery|with lens\b/i.test(text)) return 'BUNDLE_MISMATCH';
  if ((input.identity.bundleState === 'kit' || input.identity.bundleState === 'bundle') && /\bbody only|bare tool|tool only|no battery\b/i.test(text)) return 'BUNDLE_MISMATCH';
  return null;
}

function removeOutliers(comps: NormalizedComp[]): { accepted: NormalizedComp[]; outliers: NormalizedComp[] } {
  const soldPrices = comps.filter((c) => c.source === 'sold').map((c) => c.priceUsd).sort((a,b)=>a-b);
  if (soldPrices.length < 4) return { accepted: comps, outliers: [] };
  const q1 = quantile(soldPrices, 0.25) ?? 0;
  const q3 = quantile(soldPrices, 0.75) ?? 0;
  const iqr = q3 - q1;
  const low = Math.max(0, q1 - iqr * 1.5);
  const high = q3 + iqr * 1.5;
  const outliers = comps.filter((c) => c.source === 'sold' && (c.priceUsd < low || c.priceUsd > high));
  const outlierKeys = new Set(outliers.map(compKey));
  return { accepted: comps.filter((c) => !outlierKeys.has(compKey(c))), outliers };
}

function computeCompQuality(identity: NormalizedIdentity, soldCount: number, activeCount: number, rejectedCount: number, outlierCount: number, accepted: NormalizedComp[]): number {
  let score = 0.20 + Math.min(0.30, soldCount / 20) + Math.min(0.15, activeCount / 40);
  score += Math.min(0.20, avg(accepted.map((c) => c.similarityScore)) * 0.30);
  score += identity.identityConfidence * 0.15;
  score -= Math.min(0.20, rejectedCount * 0.01 + outlierCount * 0.03);
  return clamp(round(score, 4), 0, 1);
}

function extractArray(obj: Record<string, unknown>, keys: string[]): Record<string, unknown>[] {
  for (const key of keys) {
    const value = obj[key];
    if (Array.isArray(value)) return value.filter((x): x is Record<string, unknown> => Boolean(x) && typeof x === 'object' && !Array.isArray(x));
    if (typeof value === 'string') { try { const parsed = JSON.parse(value); if (Array.isArray(parsed)) return parsed; } catch {} }
  }
  return [];
}
function titleSimilarity(a: string, b: string): number { const as = new Set(a.split(' ').filter(Boolean)); const bs = new Set(b.split(' ').filter(Boolean)); if (!as.size || !bs.size) return 0; let inter = 0; for (const t of as) if (bs.has(t)) inter++; return inter / Math.max(as.size, bs.size); }
function compKey(c: NormalizedComp): string { return `${c.source}:${c.itemId ?? c.title}:${c.priceUsd}`; }
function parsePrice(value: unknown): number | null { if (typeof value === 'object' && value) return parsePrice((value as Record<string, unknown>).amount ?? (value as Record<string, unknown>).value); const n = Number(value); return Number.isFinite(n) && n > 0 ? n : null; }
function nullableString(value: unknown): string | null { if (value === null || value === undefined) return null; const s = String(value).trim(); return s ? s : null; }
function quantile(values: number[], q: number): number | null { if (!values.length) return null; const pos = (values.length - 1) * q; const base = Math.floor(pos); const rest = pos - base; const lower = values[base]!; const upper = values[base + 1] ?? lower; return round(lower + rest * (upper - lower), 2); }
function avg(values: number[]): number { return values.length ? values.reduce((a,b)=>a+b,0)/values.length : 0; }
function clamp(v: number, min: number, max: number): number { return Math.max(min, Math.min(max, v)); }
function round(v: number, p = 2): number { const f = 10 ** p; return Math.round(v * f) / f; }
