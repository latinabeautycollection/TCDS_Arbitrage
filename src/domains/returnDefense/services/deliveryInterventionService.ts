
import type { Pool } from "pg";
import type { RequestContext } from "../repositories/preventionControlPlaneRepository";

export class DeliveryInterventionService {
  public constructor(private readonly pool: Pool) {}

  public async create(
    context: RequestContext,
    passportId: string,
    preventionDecisionId: string,
    interventions: Array<Record<string, unknown>>,
  ): Promise<number> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("select set_config('app.tenant_id',$1,true)", [context.tenantId]);
      await client.query("select set_config('app.actor_id',$1,true)", [context.actorId]);
      await client.query("select set_config('app.correlation_id',$1,true)", [context.correlationId]);
      const result = await client.query<{ count: number }>(
        `select return_defense.create_post_sale_interventions(
          $1::uuid,$2::uuid,$3::jsonb
        ) count`,
        [passportId, preventionDecisionId, JSON.stringify(interventions)],
      );
      await client.query("COMMIT");
      return Number(result.rows[0]?.count ?? 0);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
