import type { Express } from "express";
import type { Pool } from "pg";
import { buildDomainReleaseRoutes } from "../routes/domainReleaseRoutes";
import { buildDomainReleaseHealthRoutes } from "../routes/domainReleaseHealthRoutes";
import { buildDomainReleaseMetricsRoutes } from "../routes/domainReleaseMetricsRoutes";

export interface Domain8ReleaseMountOptions {
  managementHttpEnabled?: boolean;
}

export function mountDomain8Release(
  app: Express,
  pool: Pool,
  options: Domain8ReleaseMountOptions = {},
): void {
  app.use(buildDomainReleaseHealthRoutes(pool));
  app.use(buildDomainReleaseMetricsRoutes(pool));

  // Management endpoints require an already-authenticated ReleaseTrustedRequest.
  // They remain off by default so 8G never invents or takes ownership of IAM.
  if (options.managementHttpEnabled === true) {
    app.use(buildDomainReleaseRoutes(pool));
  }
}
