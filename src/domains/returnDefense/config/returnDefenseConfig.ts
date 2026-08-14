export const returnDefenseConfig = {
  routesEnabled: process.env.DOMAIN8_ROUTES_ENABLED === "true",
  basePath: process.env.DOMAIN8_BASE_PATH ?? "/domain8",
  defaultSnapshotFreshnessSeconds: Number(
    process.env.DOMAIN8_SNAPSHOT_FRESHNESS_SECONDS ?? 900,
  ),
  maxSnapshotFreshnessSeconds: 2_592_000,
} as const;
