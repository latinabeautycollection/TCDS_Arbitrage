
import { Router } from "express";
import type { Pool } from "pg";

export function buildPostSaleHealthRoutes(pool: Pool): Router {
  const router = Router();

  router.get("/health/domain8/post-sale", async (_req, res, next) => {
    try {
      const result = await pool.query<{ contract_status: string }>(
        `select status contract_status
         from return_defense.schema_contract_versions
         where contract_key='DOMAIN8_POST_SALE_LOSS_PREVENTION_RECOVERY'
          and contract_version='8E.1.1'`,
      );
      const status = result.rows[0]?.contract_status ?? "MISSING";
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
