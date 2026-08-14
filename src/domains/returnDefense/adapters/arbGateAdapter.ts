
import type { PoolClient } from "pg";
export class ArbGateAdapter {
  public async assertVerified(client:PoolClient,refs:string[]):Promise<void>{
    const result=await client.query<{invalid:number}>(`select count(*)::int invalid
      from return_defense.external_entity_references
      where external_reference_id=any($1::uuid[]) and verification_status<>'VERIFIED'`,[refs]);
    if((result.rows[0]?.invalid??0)>0) throw new Error("ARB references are not verified");
  }
}
