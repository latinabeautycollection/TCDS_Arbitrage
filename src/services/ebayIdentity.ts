
import type {
  DetailedEbayItem,
  CatalogProductDetail,
  NormalizedLocalizedAspect,
  TaxonomyAspectResponse,
} from './ebayClient';

export interface PropertyRoomIdentity {
  listingId: string;
  title: string;
  normalizedTitle: string | null;
  brand: string | null;
  model: string | null;
  mpn?: string | null;
  gtin?: string | null;
  categoryId: string | null;
  conditionText: string | null;
  descriptionText?: string | null;
}

export interface IdentityMatchResult {
  identityScore: number;
  titleScore: number;
  categoryScore: number;
  conditionScore: number;
  overallScore: number;
  gatePassed: boolean;
  gateReasons: string[];
  canonicalProductKey: string | null;
  normalizedBrand: string | null;
  normalizedModel: string | null;
  normalizedMpn: string | null;
  gtins: string[];
  epid: string | null;
  preferredCategoryId: string | null;
  preferredCategoryPath: string | null;
  matchedAspectPairs: Record<string, string[]>;
}

export function comparePropertyRoomToEbay(
  propertyRoom: PropertyRoomIdentity,
  ebayItem: DetailedEbayItem,
  taxonomy: TaxonomyAspectResponse | null,
): IdentityMatchResult {
  const compBrand = normalizeNullable(
    ebayItem.brand ??
      ebayItem.product?.brand ??
      getAspectValue(ebayItem.localizedAspects, ['Brand']),
  );

  const compModel = normalizeNullable(
  getAspectValue(ebayItem.localizedAspects, ['Model', 'Model Name']) ??
    ebayItem.product?.title ??
    null,
);
const compMpn = normalizeNullable(
  getAspectValue(ebayItem.localizedAspects, ['MPN', 'Manufacturer Part Number']) ??
    ebayItem.product?.mpns?.[0] ??
    null,
);

  const compGtins = uniqueStrings([
    ...(ebayItem.gtins ?? []),
    ...(ebayItem.product?.gtins ?? []),
  ]);

const brandMatch = exactMatch(propertyRoom.brand, compBrand) ? 1 : 0;
const modelMatch = identifierContains(propertyRoom.model, compModel, ebayItem.title) ? 1 : 0;
const mpnMatch   = identifierContains(propertyRoom.mpn ?? null, compMpn, ebayItem.title) ? 1 : 0;  
  const gtinMatch =
    propertyRoom.gtin && compGtins.some((value) => normalizeKey(value) === normalizeKey(propertyRoom.gtin ?? null))
      ? 1
      : 0;

const _titleA = propertyRoom.normalizedTitle ?? propertyRoom.title;
const _titleB = ebayItem.title;
const titleScore = scoreTokenOverlap(_titleA, _titleB);
if (titleScore >= 0.95 && _titleA && _titleB) {
  // TEMP DIAGNOSTIC — remove after title_similarity bug resolved
  console.log(JSON.stringify({
    tag: 'TITLE_SIM_DIAG',
    score: titleScore,
    a: _titleA,
    b: _titleB,
    aType: typeof _titleA,
    bType: typeof _titleB,
    aLen: _titleA?.length,
    bLen: _titleB?.length,
    ebayItemId: ebayItem.itemId,
  }));
}

  const categoryScore = scoreCategory(propertyRoom.categoryId, ebayItem.categoryId ?? null);
  const conditionScore = scoreCondition(propertyRoom.conditionText, ebayItem.condition ?? null);

  const matchedAspectPairs = collectRelevantAspects(
    ebayItem.localizedAspects,
    taxonomy,
    propertyRoom,
  );

  const aspectCoverageScore = computeAspectCoverageScore(matchedAspectPairs);

  const identityScore = round(
    gtinMatch === 1
      ? 1
      : mpnMatch === 1 && brandMatch === 1
        ? 0.97
        : brandMatch * 0.35 + modelMatch * 0.30 + mpnMatch * 0.20 + aspectCoverageScore * 0.15,
    4,
  );

  const overallScore = round(
    identityScore * 0.55 +
      titleScore * 0.20 +
      categoryScore * 0.15 +
      conditionScore * 0.10,
    4,
  );

  const gateReasons: string[] = [];
  const hasModel = Boolean(propertyRoom.model || (propertyRoom.mpn ?? null));
  const hasBrand = Boolean(propertyRoom.brand);

  if (hasBrand && hasModel) {
    // Track A: full identity — brand + model/mpn present
    if (identityScore < 0.70) gateReasons.push('IDENTITY_SCORE_BELOW_THRESHOLD');
if (identityScore < 0.85 && titleScore < 0.30) gateReasons.push('TITLE_SCORE_BELOW_THRESHOLD');
  } else if (hasBrand && !hasModel) {
    // Track B: brand-only — require brand match + title similarity
    // brandMatch=0 means eBay item is a different brand entirely
    if (brandMatch === 0) gateReasons.push('IDENTITY_SCORE_BELOW_THRESHOLD');
    if (titleScore < 0.20) gateReasons.push('TITLE_SCORE_BELOW_THRESHOLD');
  } else {
    // Track C: unbranded — title + category only
    if (identityScore < 0.09) gateReasons.push('IDENTITY_SCORE_BELOW_THRESHOLD');
    if (titleScore < 0.25) gateReasons.push('TITLE_SCORE_BELOW_THRESHOLD');
  }
  if (categoryScore < 0.50) gateReasons.push('CATEGORY_SCORE_BELOW_THRESHOLD');
  if (conditionScore < 0.50) gateReasons.push('CONDITION_SCORE_BELOW_THRESHOLD');

  return {
    identityScore,
    titleScore,
    categoryScore,
    conditionScore,
    overallScore,
    gatePassed: gateReasons.length === 0,
    gateReasons,
    canonicalProductKey: buildCanonicalProductKey(
      propertyRoom.brand ?? compBrand,
      propertyRoom.model ?? compModel,
      propertyRoom.mpn ?? compMpn,
      propertyRoom.gtin ?? compGtins[0] ?? ebayItem.epid ?? null,
    ),
    normalizedBrand: normalizeNullable(propertyRoom.brand ?? compBrand),
    normalizedModel: normalizeNullable(propertyRoom.model ?? compModel),
    normalizedMpn: normalizeNullable(propertyRoom.mpn ?? compMpn),
    gtins: compGtins,
    epid: normalizeNullable(ebayItem.epid ?? ebayItem.product?.epid ?? null),
    preferredCategoryId: normalizeNullable(ebayItem.categoryId ?? ebayItem.product?.primaryCategoryId ?? null),
    preferredCategoryPath: normalizeNullable(ebayItem.categoryPath ?? null),
    matchedAspectPairs,
  };
}

export function collectRelevantAspects(
  aspects: NormalizedLocalizedAspect[] | undefined,
  taxonomy: TaxonomyAspectResponse | null,
  propertyRoom: PropertyRoomIdentity,
): Record<string, string[]> {
  const output: Record<string, string[]> = {};
  const wanted = new Set(
    (taxonomy?.aspects ?? [])
      .slice(0, 25)
      .map((aspect) => aspect.localizedAspectName.toLowerCase()),
  );

  for (const aspect of aspects ?? []) {
    if (wanted.size > 0 && !wanted.has(aspect.name.toLowerCase())) continue;
    output[aspect.name] = [...aspect.values];
  }

  if (propertyRoom.brand && !output.Brand) output.Brand = [propertyRoom.brand];
  if (propertyRoom.model && !output.Model) output.Model = [propertyRoom.model];
  if (propertyRoom.mpn && !output.MPN) output.MPN = [propertyRoom.mpn];
  return output;
}

function computeAspectCoverageScore(pairs: Record<string, string[]>): number {
  const count = Object.keys(pairs).length;
  if (count >= 8) return 1;
  if (count >= 5) return 0.8;
  if (count >= 3) return 0.6;
  if (count >= 1) return 0.4;
  return 0;
}

function scoreCategory(source: string | null, comp: string | null): number {
  const a = normalizeKey(source);
  const b = normalizeKey(comp);
  if (!a || !b) return 0.5;
  if (a === b) return 1;
  if (a.startsWith(b) || b.startsWith(a)) return 0.8;
  return 0.2;
}

function scoreCondition(source: string | null, comp: string | null): number {
  const a = normalizeConditionBand(source);
  const b = normalizeConditionBand(comp);
  if (!a || !b) return 0.6;
  if (a === b) return 1;
  if (a === 'used' && b === 'used') return 0.9;
  if ((a === 'new' && b === 'open_box') || (a === 'open_box' && b === 'new')) return 0.8;
  if (a === 'poor' || b === 'poor') return 0.2;
  return 0.4;
}

function scoreTokenOverlap(sourceTitle: string, compTitle: string): number {
  const source = tokenize(sourceTitle);
  const comp = tokenize(compTitle);
  if (source.size === 0 || comp.size === 0) return 0;

  let intersection = 0;
  for (const token of source) {
    if (comp.has(token)) intersection += 1;
  }

  // Use max of three metrics so we're robust to title-length mismatches in either direction:
  //   - containmentSource: % of source tokens that appear in comp
  //     (handles sparse PR title vs verbose eBay title — the dominant failure mode)
  //   - containmentComp:   % of comp tokens that appear in source
  //   - jaccard:           symmetric baseline (legacy behavior preserved as floor)
  const containmentSource = intersection / source.size;
  const containmentComp = intersection / comp.size;
  const union = new Set([...source, ...comp]).size;
  const jaccard = union > 0 ? intersection / union : 0;

  return round(Math.max(containmentSource, containmentComp, jaccard), 4);
}

function buildCanonicalProductKey(
  brand: string | null | undefined,
  model: string | null | undefined,
  mpn: string | null | undefined,
  identifier: string | null | undefined,
): string | null {
  const parts = [
    normalizeKey(brand ?? null),
    normalizeKey(model ?? null),
    normalizeKey(mpn ?? null),
    normalizeKey(identifier ?? null),
  ].filter((value): value is string => Boolean(value));

  return parts.length > 0 ? parts.join('::') : null;
}

function exactMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = normalizeKey(a ?? null);
  const right = normalizeKey(b ?? null);
  return Boolean(left && right && left === right);
}

function getAspectValue(
  aspects: NormalizedLocalizedAspect[] | undefined,
  names: string[],
): string | undefined {
  const wanted = new Set(names.map((value) => value.toLowerCase()));
  for (const aspect of aspects ?? []) {
    if (wanted.has(aspect.name.toLowerCase()) && aspect.values.length > 0) {
      return aspect.values[0];
    }
  }
  return undefined;
}

function normalizeConditionBand(
  value: string | null | undefined,
): 'new' | 'open_box' | 'used' | 'poor' | null {
  if (!value) return null;
  const normalized = value.toLowerCase();

  if (
    normalized.includes('damaged') ||
    normalized.includes('broken') ||
    normalized.includes('for parts') ||
    normalized.includes('parts only') ||
    normalized.includes('poor')
  ) return 'poor';

  if (normalized.includes('open box')) return 'open_box';
  if (normalized.includes('new')) return 'new';
  return 'used';
}

function tokenize(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s\-]/gu, ' ')
      .split(/\s+/)
      .map((token) => token.trim())
      .filter((token) => token.length >= 2)
      .slice(0, 24),
  );
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))];
}

function normalizeKey(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
  return normalized.length > 0 ? normalized : null;
}
function identifierContains(
  cand: string | null | undefined,
  structured: string | null | undefined,
  title: string | null | undefined,
): boolean {
  if (!cand) return false;
  const needle = normalizeKey(cand);
  if (!needle || needle.length < 3) return false;
  for (const hay of [structured, title]) {
    if (!hay) continue;
    const h = normalizeKey(hay);
    if (!h) continue;
    if (h === needle || h.includes(needle)) return true;
  }
  return false;
}

function normalizeNullable(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function round(value: number, places = 4): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}
