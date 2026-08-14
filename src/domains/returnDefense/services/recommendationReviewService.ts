
import type { Pool } from "pg";
import type { RequestContext } from "../repositories/preventionControlPlaneRepository";

export class RecommendationReviewService {
  public constructor(private readonly pool: Pool) {}
  public async approveForExperiment(
    context:RequestContext,recommendationId:string,
  ):Promise<void>{
    const client=await this.pool.connect();
    try{
      await client.query("BEGIN");
      await client.query("select set_config('app.tenant_id',$1,true)",[context.tenantId]);
      await client.query("select set_config('app.actor_id',$1,true)",[context.actorId]);
      await client.query("select set_config('app.correlation_id',$1,true)",[context.correlationId]);
      await client.query(
        "select return_defense.approve_recommendation_for_experiment_v3($1::uuid)",
        [recommendationId],
      );
      await client.query("COMMIT");
    }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
  }
}
