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
  "database/migrations/",
];

/**
 * The only Domain 6 business-feature files 6.2D may modify, and only to thread the
 * operation context through the existing authoritative helpers. Every other file in
 * those feature directories stays protected.
 */
export const DOMAIN6_2D_API_HELPERS = [
  "src/features/receiving/services/receivingApi.ts",
  "src/features/storage/services/storageApi.ts",
  "src/features/picking/services/pickingApi.ts",
  "src/features/packShip/services/packShipApi.ts",
  "src/features/inventory/services/inventoryApi.ts",
  "src/features/returns/services/returnsApi.ts",
];

const startsWithAny = (rel, prefixes) =>
  prefixes.some((prefix) =>
    prefix.endsWith("/") ? rel.startsWith(prefix) : rel === prefix,
  );

/** True when the path belongs to 6.2D, including its approved helper changes. */
export const isOwnedByDomain6_2D = (rel) =>
  startsWithAny(rel, DOMAIN6_2D_IMPLEMENTATION) ||
  DOMAIN6_2D_API_HELPERS.includes(rel);

export const isDomain6_2BImplementation = (rel) =>
  startsWithAny(rel, DOMAIN6_2B_IMPLEMENTATION);

export const isDomain6_2CImplementation = (rel) =>
  startsWithAny(rel, DOMAIN6_2C_IMPLEMENTATION);
