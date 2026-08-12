import { createHash } from "node:crypto";
import { pool } from "./db";

export async function appendAudit(args:{
  entityType:string;entityId:string;action:string;actor:string;details:Record<string,unknown>
}):Promise<void>{
  const c=await pool.connect();
  try{
    await c.query("BEGIN");
    await c.query("SELECT pg_advisory_xact_lock(hashtext('operations.audit_ledger'))");
    const prev=await c.query<{record_hash:string}>(`
      SELECT record_hash FROM operations.audit_ledger ORDER BY audit_id DESC LIMIT 1`);
    const previousHash=prev.rows[0]?.record_hash??null;
    const occurredAt=new Date().toISOString();
    const canonical=JSON.stringify({
      previousHash,entityType:args.entityType,entityId:args.entityId,
      action:args.action,actor:args.actor,details:args.details,occurredAt
    });
    const recordHash=createHash("sha256").update(canonical).digest("hex");
    await c.query(`INSERT INTO operations.audit_ledger
      (entity_type,entity_id,action,actor,details,previous_hash,record_hash,occurred_at)
      VALUES($1,$2,$3,$4,$5::jsonb,$6,$7,$8)`,
      [args.entityType,args.entityId,args.action,args.actor,JSON.stringify(args.details),previousHash,recordHash,occurredAt]);
    await c.query("COMMIT");
  }catch(e){await c.query("ROLLBACK");throw e;}finally{c.release();}
}
