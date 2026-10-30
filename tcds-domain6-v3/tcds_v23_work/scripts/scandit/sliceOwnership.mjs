/**
 * Path ownership for the certified Domain 6.2 slices.
 *
 * One concept, one owner. Each slice's verification script protects the paths that
 * slice owns, and a later certified slice is judged by its own gate rather than by
 * the gate of an earlier one. Nothing here widens an earlier allowlist: these lists
 * only say which slice a path belongs to.
 */

export const applicationRelative = (rel, prefix) =>
  prefix && rel.startsWith(prefix) ? rel.slice(prefix.length) : rel;

/** 6.2B owns camera and capture execution. */
export const DOMAIN6_2B_IMPLEMENTATION = [
  "src/lib/scanning/capture/",
  "src/lib/scanning/providers/",
  "src/hooks/useBarcodeScanner.ts",
];

/** 6.2C owns the Warehouse Control capture policy adapter. */
export const DOMAIN6_2C_IMPLEMENTATION = [
  "src/lib/scanning/policy/",
  "src/components/scanning/policy/",
];

/** 6.2D owns the workflow integration layer. */
export const DOMAIN6_2D_IMPLEMENTATION = [
  "src/lib/scanning/workflow/",
  "src/hooks/useWarehouseWorkflowScanner.ts",
  "tests/scanning-6.2d/",
  "config/typescript/scandit-6.2d.tsconfig.json",
  "config/vitest/scandit-6.2d.vitest.config.ts",
  "scripts/scandit/verify-domain6-2d-boundary.mjs",
  "scripts/scandit/sliceOwnership.mjs",
  "docs/domain6-2d/",
];

const startsWithAny = (rel, prefixes) =>
  prefixes.some((prefix) =>
    prefix.endsWith("/") ? rel.startsWith(prefix) : rel === prefix,
  );

/**
 * True when the path belongs to 6.2D. The database migration and the six API helpers
 * belong to the Domain 6 backend owner, so they are not on this list.
 */
export const isOwnedByDomain6_2D = (rel) =>
  startsWithAny(rel, DOMAIN6_2D_IMPLEMENTATION);

export const isDomain6_2BImplementation = (rel) =>
  startsWithAny(rel, DOMAIN6_2B_IMPLEMENTATION);

export const isDomain6_2CImplementation = (rel) =>
  startsWithAny(rel, DOMAIN6_2C_IMPLEMENTATION);
