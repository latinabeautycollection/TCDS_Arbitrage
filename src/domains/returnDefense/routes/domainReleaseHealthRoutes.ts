import { Router } from "express";
import type { Pool } from "pg";

export function buildDomainReleaseHealthRoutes(pool: Pool): Router {
  const router = Router();

  router.get("/health/domain8/release", async (_req, res, next) => {
    try {
      const result = await pool.query<{ status: string }>(
        `select status
         from return_defense.schema_contract_versions
         where contract_key='DOMAIN8_FINAL_CERTIFICATION_OPERATIONAL_RELEASE'
          and contract_version in ('8G.1.3','8G.1.2')
         order by case contract_version when '8G.1.3' then 0 else 1 end
         limit 1`,
      );
      const status = result.rows[0]?.status ?? "MISSING";
      const live = status === "INSTALLED" || status === "CERTIFIED";
      res.status(live ? 200 : 503).json({
        ok: live,
        live,
        certified: status === "CERTIFIED",
        contractStatus: status,
      });
    } catch (error) {
      next(error);
    }
  });

  router.get("/ready/domain8/release", async (_req, res, next) => {
    try {
      const result = await pool.query<{ status: string }>(
        `select status
         from return_defense.schema_contract_versions
         where contract_key='DOMAIN8_FINAL_CERTIFICATION_OPERATIONAL_RELEASE'
          and contract_version='8G.1.3'`,
      );
      const status = result.rows[0]?.status ?? "MISSING";
      res.status(status === "CERTIFIED" ? 200 : 503).json({
        ok: status === "CERTIFIED",
        certified: status === "CERTIFIED",
        contractStatus: status,
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
