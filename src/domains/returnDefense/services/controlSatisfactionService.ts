
import type { Pool } from "pg";
import type { RequestContext } from "../repositories/preventionControlPlaneRepository";

export class ControlSatisfactionService {
  public constructor(private readonly pool: Pool) {}
  public async satisfy(ctx:RequestContext,input:{
    requiredControlId:string;evidenceExternalReferenceId:string;
    verificationMethod:string;verificationPayload:Record<string,unknown>;
  }):Promise<string>{
    const c=await this.pool.connect();
    try{
      await c.query("BEGIN");
      await c.query("select set_config('app.tenant_id',$1,true)",[ctx.tenantId]);
      await c.query("select set_config('app.actor_id',$1,true)",[ctx.actorId]);
      await c.query("select set_config('app.correlation_id',$1,true)",[ctx.correlationId]);
      const r=await c.query<{id:string}>(`select return_defense.satisfy_required_control(
        $1::uuid,$2::uuid,$3,$4::jsonb) id`,[
        input.requiredControlId,input.evidenceExternalReferenceId,
        input.verificationMethod,JSON.stringify(input.verificationPayload)
      ]);
      await c.query("COMMIT"); return r.rows[0]!.id;
    }catch(e){await c.query("ROLLBACK");throw e;}finally{c.release();}
  }
}
