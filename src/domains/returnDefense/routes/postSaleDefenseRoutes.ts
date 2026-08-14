
import { Router } from "express";
import type { Pool } from "pg";
import { enqueuePostSaleGateSchema } from "../validators/postSaleGateValidator";
import {
  requireTrustedContext,
  type TrustedRequest,
} from "../security/trustedRequestContext";

export function buildPostSaleDefenseRoutes(pool: Pool): Router {
  const router = Router();

  router.post("/domain8/post-sale/gates", async (req: TrustedRequest, res, next) => {
    try {
      const input = enqueuePostSaleGateSchema.parse(req.body);
      const context = requireTrustedContext(req);

      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("select set_config('app.tenant_id',$1,true)", [context.tenantId]);
        await client.query("select set_config('app.actor_id',$1,true)", [context.actorId]);
        await client.query("select set_config('app.correlation_id',$1,true)", [context.correlationId]);
        const result = await client.query<{ id: string }>(
          `select return_defense.enqueue_post_sale_gate(
            $1::uuid,$2,$3,$4::uuid,$5,$6,NULL
          ) id`,
          [
            input.passportId,
            input.gateStage,
            input.triggerType,
            input.triggerExternalReferenceId ?? null,
            input.priority,
            input.idempotencyKey,
          ],
        );
        await client.query("COMMIT");
        res.status(202).json({
          ok: true,
          postSaleGateExecutionRunId: result.rows[0]!.id,
        });
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      next(error);
    }
  });

  return router;
}
