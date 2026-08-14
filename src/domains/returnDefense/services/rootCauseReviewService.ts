
import type { Pool } from "pg";
import type { RequestContext } from "../repositories/preventionControlPlaneRepository";

export class RootCauseReviewService {
  public constructor(private readonly pool: Pool) {}
  public async review(
    context: RequestContext,
    assignmentId: string,
    decision: "APPROVE"|"REJECT",
    reason: string,
  ): Promise<void> {
    const client=await this.pool.connect();
    try{
      await client.query("BEGIN");
      await client.query("select set_config('app.tenant_id',$1,true)",[context.tenantId]);
      await client.query("select set_config('app.actor_id',$1,true)",[context.actorId]);
      await client.query("select set_config('app.correlation_id',$1,true)",[context.correlationId]);
      await client.query(
        "select return_defense.review_root_cause_assignment($1::uuid,$2,$3)",
        [assignmentId,decision,reason],
      );
      await client.query("COMMIT");
    }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
  }
}
