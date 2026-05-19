import type { NormalizedProductIdentity } from './commonIdentity';
import { safeSlug } from './normalizeText';

export function buildCanonicalProductKey(identity: NormalizedProductIdentity): string | null {
  const parts = [
    identity.categoryKey,
    identity.normalizedBrand,
    identity.normalizedProductType,
    identity.normalizedModelFamily,
    identity.normalizedModelToken,
    identity.normalizedGeneration,
    identity.normalizedVariant,
    identity.normalizedPlatform,
    identity.normalizedStorage,
  ];
  // Drop a part if it duplicates the previous non-null part (avoids iphone|13|13)
  const deduped: (string | null | undefined)[] = [];
  let last: string | null = null;
  for (const p of parts) {
    if (!p) { deduped.push(p); continue; }
    if (p === last) continue;
    deduped.push(p);
    last = p;
  }
  return safeSlug(deduped);
}
