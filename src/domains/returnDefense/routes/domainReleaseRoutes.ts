
import { Router } from "express";
import type { Pool } from "pg";
import { releaseDecisionSchema } from "../validators/domainReleaseValidator";
import {
  requireReleaseContext,
  type ReleaseTrustedRequest,
} from "../security/releaseTrustedContext";

export function buildDomainReleaseRoutes(pool: Pool): Router {
  const router = Router();

  router.get(
    "/domain8/release/:id/readiness",
    async (req: ReleaseTrustedRequest, res, next) => {
      try {
        const context = requireReleaseContext(req, [
          "DOMAIN8_RELEASE_MANAGER",
          "DOMAIN8_AUDITOR",
          "DOMAIN8_EXECUTIVE",
        ]);
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          await client.query(
            "select set_config('app.tenant_id',$1,true)",
            [context.tenantId],
          );
          const result = await client.query(
            `select * from return_defense.domain_operational_readiness_checks
             where domain_release_contract_id=$1::uuid
             order by check_category,check_code`,
            [req.params.id],
          );
          await client.query("COMMIT");
          res.json({ ok: true, checks: result.rows });
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        } finally {
          client.release();
        }
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    "/domain8/release/:id/decision",
    async (req: ReleaseTrustedRequest, res, next) => {
      try {
        const input = releaseDecisionSchema.parse(req.body);
        const context = requireReleaseContext(req, [
          "DOMAIN8_RELEASE_MANAGER",
        ]);
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          await client.query(
            "select set_config('app.tenant_id',$1,true)",
            [context.tenantId],
          );
          await client.query(
            "select set_config('app.actor_id',$1,true)",
            [context.actorId],
          );
          await client.query(
            "select set_config('app.correlation_id',$1,true)",
            [context.correlationId],
          );
          const result = await client.query<{ id: string }>(
            `select return_defense.issue_domain8_release_decision_v3(
              $1::uuid,$2::uuid,$3,$4
            ) id`,
            [req.params.id,input.packetId,input.decision,input.reason],
          );
          await client.query("COMMIT");
          res.json({ ok: true, releaseDecisionId: result.rows[0]!.id });
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        } finally {
          client.release();
        }
      } catch (error) {
        next(error);
      }
    },
  );

  return router;
}
