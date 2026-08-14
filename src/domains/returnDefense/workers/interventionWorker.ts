
import type { Pool } from "pg";
import { returnDefenseLogger } from "../observability/returnDefenseLogger";

export class InterventionWorker {
  public constructor(private readonly pool:Pool,private readonly workerId:string){}
  public async claim(limit=25):Promise<Array<Record<string,unknown>>>{
    const result=await this.pool.query(
      "select * from return_defense.claim_interventions($1,$2,interval '5 minutes')",
      [this.workerId,limit],
    );
    return result.rows;
  }
  public async recover():Promise<number>{
    const result=await this.pool.query<{count:number}>(
      "select return_defense.recover_stale_interventions(500) count",
    );
    const count=Number(result.rows[0]?.count??0);
    if(count>0) returnDefenseLogger.warn({count},"recovered stale interventions");
    return count;
  }
}
