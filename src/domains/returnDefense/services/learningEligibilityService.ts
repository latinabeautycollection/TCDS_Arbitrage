
import type { Pool } from "pg";
import type { RequestContext } from "../repositories/preventionControlPlaneRepository";

export class LearningEligibilityService {
  public constructor(private readonly pool: Pool) {}
  public async review(
    context: RequestContext,
    exampleId: string,
    checks: {
      outcomeResolved:boolean;evidenceVerified:boolean;poisoned:boolean;
      overrideComplete:boolean;piiSafe:boolean;rootCauseComplete:boolean;
      preventabilityComplete:boolean;reference:string;
    },
  ): Promise<string> {
    const client=await this.pool.connect();
    try{
      await client.query("BEGIN");
      await client.query("select set_config('app.tenant_id',$1,true)",[context.tenantId]);
      await client.query("select set_config('app.actor_id',$1,true)",[context.actorId]);
      await client.query("select set_config('app.correlation_id',$1,true)",[context.correlationId]);
      const result=await client.query<{id:string}>(
        `select return_defense.review_learning_eligibility_v2(
          $1::uuid,$2,$3,$4,$5,$6,$7,$8,$9
        ) id`,
        [
          exampleId,checks.outcomeResolved,checks.evidenceVerified,checks.poisoned,
          checks.overrideComplete,checks.piiSafe,checks.rootCauseComplete,
          checks.preventabilityComplete,checks.reference,
        ],
      );
      await client.query("COMMIT");
      return result.rows[0]!.id;
    }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
  }
}
