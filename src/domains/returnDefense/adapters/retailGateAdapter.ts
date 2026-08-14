
import type { PoolClient } from "pg";
export class RetailGateAdapter {
  public async load(client:PoolClient,refs:string[]):Promise<Record<string,unknown>>{
    const result=await client.query(`select
      bool_and(r.verification_status='VERIFIED') verified,
      max(r.last_verified_at) last_verified_at
      from return_defense.external_entity_references r
      where r.external_reference_id=any($1::uuid[])`,[refs]);
    return result.rows[0]??{};
  }
}
