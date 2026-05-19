import { buildCanonicalProductKey } from './buildCanonicalProductKey';
import { deriveCategoryIdentity } from './categoryIdentityRules';
import { emptyIdentity, type NormalizedProductIdentity } from './commonIdentity';

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

export function deriveCandidateIdentity(input: {
  categoryKey: string | null;
  title: string | null;
  normalizedTitle: string | null;
  brand: string | null;
  model: string | null;
}): NormalizedProductIdentity {
  if (!input.title && !input.normalizedTitle) {
    const identity = emptyIdentity(input.categoryKey);
    identity.identityConfidence = 0.05;
    return identity;
  }

  const identity = deriveCategoryIdentity({
    categoryKey: input.categoryKey,
    title: input.title ?? input.normalizedTitle ?? '',
    normalizedTitle: input.normalizedTitle,
    brand: input.brand,
    model: input.model,
  });

  identity.canonicalProductKey = buildCanonicalProductKey(identity);
  identity.identityConfidence = computeConfidence(identity);

  return identity;
}
