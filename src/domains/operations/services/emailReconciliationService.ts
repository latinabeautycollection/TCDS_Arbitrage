import { pool } from "../repositories/db";
import { appendAudit } from "../repositories/emailAuditRepository";

/**
 * Microsoft Graph sendMail 202 proves provider acceptance, not recipient delivery.
 * UNKNOWN_PROVIDER_OUTCOME is never automatically retried.
 */
export async function listAmbiguousDeliveries(limit=100){
  const r=await pool.query(`
    SELECT delivery_id,request_id,state,attempt_count,updated_at
    FROM operations.notification_deliveries
    WHERE state='UNKNOWN_PROVIDER_OUTCOME'
    ORDER BY updated_at ASC LIMIT $1`,[limit]);
  return r.rows;
}

export async function resolveAmbiguous(
  deliveryId:string,
  resolution:"ACCEPTED_BY_PROVIDER"|"FAILED_FINAL",
  actor:string,
  reason:string
):Promise<void>{
  const c=await pool.connect();
  try{
    await c.query("BEGIN");
    const r=await c.query(`UPDATE operations.notification_deliveries
      SET state=$2,updated_at=now()
      WHERE delivery_id=$1 AND state='UNKNOWN_PROVIDER_OUTCOME'
      RETURNING delivery_id`,[deliveryId,resolution]);
    if(r.rowCount!==1) throw new Error("Delivery is not in UNKNOWN_PROVIDER_OUTCOME");
    await c.query("COMMIT");
  }catch(e){await c.query("ROLLBACK");throw e;}finally{c.release();}

  await appendAudit({
    entityType:"notification_delivery",
    entityId:deliveryId,
    action:"AMBIGUOUS_OUTCOME_RESOLVED",
    actor,
    details:{resolution,reason}
  });
}
