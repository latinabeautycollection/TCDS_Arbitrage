import { buildCanonicalProductKey } from './buildCanonicalProductKey';
import { deriveCategoryIdentity } from './categoryIdentityRules';
import type { NormalizedProductIdentity } from './commonIdentity';

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function computeConfidence(identity: NormalizedProductIdentity): number {
  const score =
    (identity.normalizedBrand ? 0.20 : 0) +
    (identity.normalizedProductType ? 0.15 : 0) +
    (identity.normalizedModelFamily ? 0.20 : 0) +
    (identity.normalizedModelToken ? 0.20 : 0) +
    (identity.categoryKey ? 0.10 : 0) +
    (!identity.isAccessory ? 0.05 : 0) +
    (!identity.isBundle ? 0.05 : 0) +
    (identity.canonicalProductKey ? 0.05 : 0);

  return clamp(score, 0, 1);
}

function extractFirstSoldItemTitle(rawPayloadJson: unknown): string | null {
  if (!rawPayloadJson || typeof rawPayloadJson !== 'object') return null;
  const payload = rawPayloadJson as Record<string, unknown>;
  const soldItems = payload.soldItems;
  if (!Array.isArray(soldItems) || soldItems.length === 0) return null;
  const first = soldItems[0];
  if (!first || typeof first !== 'object') return null;
  const title = (first as Record<string, unknown>).title;
  return typeof title === 'string' && title.trim().length > 0 ? title : null;
}

export function deriveWatchlistIdentity(input: {
  categoryKey: string;
  familyName: string;
  brand: string | null;
  modelFamily: string | null;
  rawPayloadJson?: unknown;
}): NormalizedProductIdentity {
  const supportingTitle = extractFirstSoldItemTitle(input.rawPayloadJson);
  const title = supportingTitle || input.familyName;

  const identity = deriveCategoryIdentity({
    categoryKey: input.categoryKey,
    title,
    normalizedTitle: input.familyName,
    brand: input.brand,
    model: input.modelFamily,
  });

  identity.canonicalProductKey = buildCanonicalProductKey(identity);
  identity.identityConfidence = computeConfidence(identity);

  return identity;
}
