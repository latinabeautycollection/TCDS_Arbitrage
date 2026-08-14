
import type { Pool } from "pg";
import type { RequestContext } from "../repositories/preventionControlPlaneRepository";

export class OutcomeIngestionService {
  public constructor(private readonly pool: Pool) {}

  public async record(
    context: RequestContext,
    input: {
      passportId: string;
      outcomeType: string;
      observedAt: string;
      idempotencyKey: string;
      payload: Record<string, unknown>;
    },
  ): Promise<string> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("select set_config('app.tenant_id',$1,true)", [context.tenantId]);
      await client.query("select set_config('app.actor_id',$1,true)", [context.actorId]);
      await client.query("select set_config('app.correlation_id',$1,true)", [context.correlationId]);
      const result = await client.query<{ id: string }>(
        `select return_defense.record_outcome_observation_v2(
          $1::uuid,$2,$3::timestamptz,NULL,NULL,NULL,NULL,NULL,NULL,$4,$5::jsonb
        ) id`,
        [
          input.passportId,input.outcomeType,input.observedAt,
          input.idempotencyKey,JSON.stringify(input.payload),
        ],
      );
      await client.query("COMMIT");
      return result.rows[0]!.id;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
