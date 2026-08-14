
import type { Express } from "express";
import type { Pool } from "pg";
import { buildDomainReleaseRoutes } from "../routes/domainReleaseRoutes";
import { buildDomainReleaseHealthRoutes } from "../routes/domainReleaseHealthRoutes";

export function mountDomain8Release(app: Express, pool: Pool): void {
  app.use(buildDomainReleaseRoutes(pool));
  app.use(buildDomainReleaseHealthRoutes(pool));
}
