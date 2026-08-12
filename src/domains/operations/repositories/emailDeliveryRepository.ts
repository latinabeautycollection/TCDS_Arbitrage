import { pool } from "./db";
import type { ClaimedDelivery, EmailRecipient, RenderedEmail } from "../models/emailTypes";

export async function createNotificationAndDeliveries(args:{
  requestId:string; eventId:string; notificationId:string; correlationId:string; incidentId?:string;
  eventType:string; severity:string; classification:string; recipients:EmailRecipient[];
  templateKey:string; templateVersion:number; policyVersion:string; variables:Record<string,unknown>;
  rendered:RenderedEmail;
  deliveries:Array<{recipients:EmailRecipient[];idempotencyKey:string}>;
}):Promise<{deliveryIds:string[];created:number}>{
  const c=await pool.connect();
  try{
    await c.query("BEGIN");

    const existing=await c.query<{request_id:string}>(`
      SELECT request_id FROM operations.notification_requests WHERE notification_id=$1 FOR UPDATE`,
      [args.notificationId]);

    let requestId=args.requestId;
    if(existing.rows[0]){
      requestId=existing.rows[0].request_id;
    }else{
      await c.query(`INSERT INTO operations.notification_requests
        (request_id,event_id,notification_id,correlation_id,incident_id,event_type,severity,classification,
         recipients,template_key,template_version,policy_version,variables,status)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13::jsonb,'PENDING')`,
        [requestId,args.eventId,args.notificationId,args.correlationId,args.incidentId??null,args.eventType,args.severity,
         args.classification,JSON.stringify(args.recipients),args.templateKey,args.templateVersion,args.policyVersion,
         JSON.stringify(args.variables)]);
    }

    const ids:string[]=[];
    let created=0;
    for(const d of args.deliveries){
      const ins=await c.query<{delivery_id:string}>(`INSERT INTO operations.notification_deliveries
        (request_id,idempotency_key,state,recipients,rendered_subject,rendered_text_body,rendered_html_body,
         rendered_subject_hash,rendered_body_hash,next_attempt_at)
        VALUES($1,$2,'PENDING',$3::jsonb,$4,$5,$6,$7,$8,now())
        ON CONFLICT(idempotency_key) DO NOTHING RETURNING delivery_id`,
        [requestId,d.idempotencyKey,JSON.stringify(d.recipients),args.rendered.subject,args.rendered.textBody,
         args.rendered.htmlBody,args.rendered.subjectHash,args.rendered.bodyHash]);

      let deliveryId=ins.rows[0]?.delivery_id;
      if(deliveryId){
        created++;
        await c.query(`INSERT INTO operations.email_outbox(delivery_id,available_at)
          VALUES($1,now()) ON CONFLICT(delivery_id) DO NOTHING`,[deliveryId]);
      }else{
        const q=await c.query<{delivery_id:string}>(`
          SELECT delivery_id FROM operations.notification_deliveries WHERE idempotency_key=$1`,
          [d.idempotencyKey]);
        deliveryId=q.rows[0]?.delivery_id;
      }
      if(!deliveryId) throw new Error("Delivery idempotency lookup failed");
      ids.push(deliveryId);
    }

    await c.query("COMMIT");
    return {deliveryIds:ids,created};
  }catch(e){await c.query("ROLLBACK");throw e;}finally{c.release();}
}

export async function claimDeliveries(workerId:string,batch:number,leaseSeconds:number):Promise<ClaimedDelivery[]>{
  const c=await pool.connect();
  try{
    await c.query("BEGIN");

    // A previous worker that reached SENDING and lost its lease has an ambiguous outcome:
    // quarantine it rather than retrying.
    await c.query(`
      UPDATE operations.notification_deliveries
      SET state='UNKNOWN_PROVIDER_OUTCOME',lease_owner=NULL,lease_expires_at=NULL,updated_at=now()
      WHERE state='SENDING' AND lease_expires_at IS NOT NULL AND lease_expires_at < now()`);

    await c.query(`
      UPDATE operations.email_outbox o SET completed_at=now(),lock_owner=NULL,lock_expires_at=NULL
      FROM operations.notification_deliveries d
      WHERE d.delivery_id=o.delivery_id AND d.state='UNKNOWN_PROVIDER_OUTCOME' AND o.completed_at IS NULL`);

    const r=await c.query<{delivery_id:string}>(`
      WITH picked AS (
        SELECT o.delivery_id
        FROM operations.email_outbox o
        JOIN operations.notification_deliveries d USING(delivery_id)
        WHERE o.completed_at IS NULL
          AND o.available_at<=now()
          AND (o.lock_expires_at IS NULL OR o.lock_expires_at<now())
          AND d.state IN('PENDING','FAILED_RETRYABLE','CLAIMED')
        ORDER BY o.available_at,o.created_at
        FOR UPDATE OF o SKIP LOCKED
        LIMIT $1
      )
      UPDATE operations.email_outbox o
      SET lock_owner=$2,lock_expires_at=now()+make_interval(secs=>$3),locked_at=now()
      FROM picked p WHERE o.delivery_id=p.delivery_id
      RETURNING o.delivery_id`,[batch,workerId,leaseSeconds]);

    const ids=r.rows.map(x=>x.delivery_id);
    if(!ids.length){await c.query("COMMIT");return[];}

    await c.query(`UPDATE operations.notification_deliveries
      SET state='CLAIMED',lease_owner=$1,lease_expires_at=now()+make_interval(secs=>$2),updated_at=now()
      WHERE delivery_id=ANY($3::uuid[])`,[workerId,leaseSeconds,ids]);

    const q=await c.query<any>(`
      SELECT d.delivery_id,d.request_id,d.idempotency_key,d.state,d.attempt_count,d.recipients,
             d.rendered_subject,d.rendered_text_body,d.rendered_html_body,
             r.event_id,r.notification_id,r.correlation_id,r.incident_id,r.severity,d.lease_owner
      FROM operations.notification_deliveries d
      JOIN operations.notification_requests r USING(request_id)
      WHERE d.delivery_id=ANY($1::uuid[])`,[ids]);

    await c.query("COMMIT");
    return q.rows.map((x:any)=>({
      deliveryId:x.delivery_id,requestId:x.request_id,idempotencyKey:x.idempotency_key,state:x.state,
      attemptCount:x.attempt_count,recipients:x.recipients,renderedSubject:x.rendered_subject,
      renderedTextBody:x.rendered_text_body,renderedHtmlBody:x.rendered_html_body,eventId:x.event_id,
      notificationId:x.notification_id,correlationId:x.correlation_id,incidentId:x.incident_id??undefined,
      severity:x.severity,leaseOwner:x.lease_owner
    }));
  }catch(e){await c.query("ROLLBACK");throw e;}finally{c.release();}
}

export async function beginAttempt(deliveryId:string,workerId:string):Promise<string>{
  const r=await pool.query<{attempt_id:string}>(`
    WITH upd AS(
      UPDATE operations.notification_deliveries
      SET state='SENDING',attempt_count=attempt_count+1,updated_at=now()
      WHERE delivery_id=$1 AND state='CLAIMED' AND lease_owner=$2 AND lease_expires_at>now()
      RETURNING attempt_count
    )
    INSERT INTO operations.delivery_attempts(delivery_id,attempt_number,outcome)
    SELECT $1,attempt_count,'STARTED' FROM upd RETURNING attempt_id`,[deliveryId,workerId]);
  if(!r.rows[0]) throw new Error("Lease lost before send");
  return r.rows[0].attempt_id;
}

export async function markAccepted(deliveryId:string,attemptId:string,status:202,requestId?:string):Promise<void>{
  const c=await pool.connect();
  try{
    await c.query("BEGIN");
    await c.query(`UPDATE operations.delivery_attempts
      SET completed_at=now(),outcome='ACCEPTED',http_status=$2,provider_request_id=$3
      WHERE attempt_id=$1`,[attemptId,status,requestId??null]);
    await c.query(`UPDATE operations.notification_deliveries
      SET state='ACCEPTED_BY_PROVIDER',provider_accepted_at=now(),
          lease_owner=NULL,lease_expires_at=NULL,updated_at=now()
      WHERE delivery_id=$1`,[deliveryId]);
    await c.query(`UPDATE operations.email_outbox
      SET completed_at=now(),lock_owner=NULL,lock_expires_at=NULL
      WHERE delivery_id=$1`,[deliveryId]);
    await c.query(`INSERT INTO operations.provider_receipts(delivery_id,attempt_id,receipt_type,payload)
      VALUES($1,$2,'GRAPH_202',$3::jsonb)`,
      [deliveryId,attemptId,JSON.stringify({httpStatus:202,providerRequestId:requestId??null})]);
    await c.query("COMMIT");
  }catch(e){await c.query("ROLLBACK");throw e;}finally{c.release();}
}

export async function markFailure(args:{
  deliveryId:string;attemptId:string;failure:string;message:string;httpStatus?:number;providerCode?:string;
  retryable:boolean;ambiguous:boolean;maxAttempts:number;nextAttemptAt?:Date;
}):Promise<"RETRY"|"DEAD"|"UNKNOWN">{
  const c=await pool.connect();
  try{
    await c.query("BEGIN");
    await c.query(`UPDATE operations.delivery_attempts SET completed_at=now(),outcome=$2,http_status=$3,
      provider_code=$4,error_class=$5,error_message=$6,ambiguous_outcome=$7 WHERE attempt_id=$1`,
      [args.attemptId,args.ambiguous?"UNKNOWN":args.retryable?"RETRYABLE_FAILURE":"FINAL_FAILURE",
       args.httpStatus??null,args.providerCode??null,args.failure,args.message.slice(0,1000),args.ambiguous]);

    const q=await c.query<{attempt_count:number}>(`
      SELECT attempt_count FROM operations.notification_deliveries WHERE delivery_id=$1 FOR UPDATE`,
      [args.deliveryId]);
    const count=q.rows[0]?.attempt_count??args.maxAttempts;

    if(args.ambiguous){
      await c.query(`UPDATE operations.notification_deliveries
        SET state='UNKNOWN_PROVIDER_OUTCOME',lease_owner=NULL,lease_expires_at=NULL,updated_at=now()
        WHERE delivery_id=$1`,[args.deliveryId]);
      await c.query(`UPDATE operations.email_outbox
        SET completed_at=now(),lock_owner=NULL,lock_expires_at=NULL WHERE delivery_id=$1`,[args.deliveryId]);
      await c.query("COMMIT");return"UNKNOWN";
    }

    if(args.retryable && count<args.maxAttempts){
      const next=args.nextAttemptAt??new Date();
      await c.query(`UPDATE operations.notification_deliveries
        SET state='FAILED_RETRYABLE',next_attempt_at=$2,lease_owner=NULL,lease_expires_at=NULL,updated_at=now()
        WHERE delivery_id=$1`,[args.deliveryId,next]);
      await c.query(`UPDATE operations.email_outbox
        SET available_at=$2,lock_owner=NULL,lock_expires_at=NULL,locked_at=NULL WHERE delivery_id=$1`,
        [args.deliveryId,next]);
      await c.query("COMMIT");return"RETRY";
    }

    await c.query(`UPDATE operations.notification_deliveries
      SET state='DEAD_LETTERED',lease_owner=NULL,lease_expires_at=NULL,updated_at=now()
      WHERE delivery_id=$1`,[args.deliveryId]);
    await c.query(`UPDATE operations.email_outbox
      SET completed_at=now(),lock_owner=NULL,lock_expires_at=NULL WHERE delivery_id=$1`,[args.deliveryId]);
    await c.query(`INSERT INTO operations.dead_letters(delivery_id,reason,last_error)
      VALUES($1,$2,$3)
      ON CONFLICT(delivery_id) DO UPDATE
      SET reason=excluded.reason,last_error=excluded.last_error,updated_at=now()`,
      [args.deliveryId,args.failure,args.message.slice(0,1000)]);
    await c.query("COMMIT");return"DEAD";
  }catch(e){await c.query("ROLLBACK");throw e;}finally{c.release();}
}
