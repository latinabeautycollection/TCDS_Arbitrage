
import type { Pool } from "pg";
import type { RequestContext } from "../repositories/preventionControlPlaneRepository";

export class ExecutiveIntelligenceService {
  public constructor(private readonly pool: Pool) {}
  public async currentPosition(context:RequestContext){
    const client=await this.pool.connect();
    try{
      await client.query("BEGIN");
      await client.query("select set_config('app.tenant_id',$1,true)",[context.tenantId]);
      const result=await client.query(
        "select * from return_defense.v_executive_current_loss_position",
      );
      await client.query("COMMIT");
      return result.rows;
    }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
  }
}
