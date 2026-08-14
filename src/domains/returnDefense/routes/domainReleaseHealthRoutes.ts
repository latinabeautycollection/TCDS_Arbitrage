
import { Router } from "express";
import type { Pool } from "pg";

export function buildDomainReleaseHealthRoutes(pool: Pool): Router {
  const router = Router();
  router.get("/health/domain8/release", async (_req, res, next) => {
    try {
      const result = await pool.query(
        `select status
         from return_defense.schema_contract_versions
         where contract_key='DOMAIN8_FINAL_CERTIFICATION_OPERATIONAL_RELEASE'
          and contract_version='8G.1.0'`,
      );
      const status = result.rows[0]?.status ?? "MISSING";
      res.status(status === "CERTIFIED" ? 200 : 503).json({
        ok: status === "CERTIFIED",
        contractStatus: status,
      });
    } catch (error) {
      next(error);
    }
  });
  return router;
}
