
import type { Pool, PoolClient } from "pg";
import type { RequestContext } from "./preventionControlPlaneRepository";
export class PreSaleGateRepository {
  public constructor(private readonly pool:Pool){}
  public async transaction<T>(ctx:RequestContext,fn:(c:PoolClient)=>Promise<T>):Promise<T>{
    const c=await this.pool.connect();
    try{
      await c.query("BEGIN");
      await c.query("select set_config('app.tenant_id',$1,true)",[ctx.tenantId]);
      await c.query("select set_config('app.actor_id',$1,true)",[ctx.actorId]);
      await c.query("select set_config('app.correlation_id',$1,true)",[ctx.correlationId]);
      const v=await fn(c); await c.query("COMMIT"); return v;
    }catch(e){await c.query("ROLLBACK");throw e;}finally{c.release();}
  }
  public async claim(ctx:RequestContext,workerId:string,limit:number){
    return this.transaction(ctx,async c=>(await c.query(
      "select * from return_defense.claim_pre_sale_gates($1,$2,interval '5 minutes')",
      [workerId,limit],
    )).rows);
  }
}
