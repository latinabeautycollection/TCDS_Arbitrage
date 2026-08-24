import { domain10Runtime } from "../../infrastructure/operationsRuntime";
import type {
  ClaimedDelivery,
  DeliveryAttempt,
  DeliveryChannel,
  ProviderAcceptance,
  ProviderFailure
} from "../models/deliveryTypes";

export async function claimDeliveries(
  channel: DeliveryChannel,
  workerId: string,
  batchSize: number,
  leaseSeconds: number
): Promise<ClaimedDelivery[]> {
  const claimed = await domain10Runtime().pool.query<{ outbox_id: number; delivery_id: string }>(`
    SELECT outbox_id,delivery_id
    FROM operations.claim_notification_outbox($1,$2,$3,$4)
  `, [channel, workerId, batchSize, leaseSeconds]);

  if (!claimed.rows.length) return [];

  const ids = claimed.rows.map((x) => x.delivery_id);
  const details = await domain10Runtime().pool.query<any>(`
    SELECT
      d.delivery_id,o.outbox_id,d.notification_id,d.recipient_id,d.channel,d.provider,
      d.state,d.attempt_count,d.max_attempts,d.rendered_subject,d.rendered_text_body,
      d.rendered_html_body,nr.email_snapshot,nr.mobile_snapshot,n.correlation_id,
      n.trace_id,n.request_id,e.event_id,e.event_type,e.severity,e.classification,
      d.lease_owner
    FROM operations.notification_deliveries d
    JOIN operations.notification_outbox o ON o.delivery_id=d.delivery_id
    JOIN operations.notification_requests n ON n.notification_id=d.notification_id
    JOIN operations.operational_events e ON e.event_id=n.event_id
    JOIN operations.notification_recipients nr
      ON nr.notification_id=d.notification_id
     AND nr.recipient_id=d.recipient_id
    WHERE d.delivery_id=ANY($1::uuid[])
    ORDER BY o.outbox_id
  `, [ids]);

  return details.rows.map((x: any) => ({
    deliveryId:x.delivery_id,outboxId:Number(x.outbox_id),notificationId:x.notification_id,
    recipientId:x.recipient_id,channel:x.channel,provider:x.provider,state:x.state,
    attemptCount:x.attempt_count,maxAttempts:x.max_attempts,
    ...(x.rendered_subject?{renderedSubject:x.rendered_subject}:{}),
    renderedTextBody:x.rendered_text_body,
    ...(x.rendered_html_body?{renderedHtmlBody:x.rendered_html_body}:{}),
    ...(x.email_snapshot?{emailAddress:x.email_snapshot}:{}),
    ...(x.mobile_snapshot?{mobileE164:x.mobile_snapshot}:{}),
    eventId:x.event_id,eventType:x.event_type,severity:x.severity,classification:x.classification,
    correlationId:x.correlation_id,
    ...(x.trace_id?{traceId:x.trace_id}:{}),
    ...(x.request_id?{requestId:x.request_id}:{}),
    leaseOwner:x.lease_owner
  }));
}

export type BeginExecutionResult =
  | ({ status:"STARTED" } & DeliveryAttempt)
  | { status:"SUPPRESSED"; reason:string }
  | { status:"RELEASED"; reason:string };

export async function beginDeliveryAttempt(
  deliveryId:string,
  workerId:string
):Promise<BeginExecutionResult>{
  const r=await domain10Runtime().pool.query<{
    attempt_id:string|null;
    attempt_number:number|null;
    execution_status:"STARTED"|"SUPPRESSED"|"RELEASED";
    reason:string|null;
  }>(`
    SELECT attempt_id,attempt_number,execution_status,reason
    FROM operations.begin_delivery_execution_10c($1,$2)
  `,[deliveryId,workerId]);

  const row=r.rows[0];
  if(!row) throw new Error("begin_delivery_execution_10c returned no row");

  if(row.execution_status==="SUPPRESSED"){
    return {status:"SUPPRESSED",reason:row.reason??"SMS_NOT_CURRENTLY_SUBSCRIBED"};
  }
  if(row.execution_status==="RELEASED"){
    return {status:"RELEASED",reason:row.reason??"DELIVERY_NOT_READY"};
  }
  if(!row.attempt_id||!row.attempt_number) throw new Error("10C STARTED without attempt identity");
  return {status:"STARTED",attemptId:row.attempt_id,attemptNumber:row.attempt_number};
}

export async function recordProviderAcceptance(
  deliveryId:string,
  attemptId:string,
  workerId:string,
  acceptance:ProviderAcceptance
):Promise<void>{
  await domain10Runtime().pool.query(`
    SELECT operations.record_provider_acceptance_10c($1,$2,$3,$4,$5,$6,$7::jsonb)
  `,[
    deliveryId,attemptId,workerId,
    acceptance.providerRequestId??null,
    acceptance.providerMessageId??null,
    acceptance.httpStatus,
    JSON.stringify(acceptance.receipt)
  ]);
}

export async function recordProviderFailure(args:{
  deliveryId:string;
  attemptId:string;
  workerId:string;
  failure:ProviderFailure;
  nextAttemptAt:Date;
}):Promise<"RETRY"|"UNKNOWN"|"DEAD">{
  const r=await domain10Runtime().pool.query<{disposition:"RETRY"|"UNKNOWN"|"DEAD"}>(`
    SELECT operations.fail_delivery_execution_10c(
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10
    ) AS disposition
  `,[
    args.deliveryId,args.attemptId,args.workerId,args.failure.failureClass,
    args.failure.message,args.failure.httpStatus??null,args.failure.providerCode??null,
    args.failure.retryable,args.failure.ambiguousOutcome,args.nextAttemptAt
  ]);
  const disposition=r.rows[0]?.disposition;
  if(!disposition) throw new Error("fail_delivery_execution_10c returned no disposition");
  return disposition;
}

export async function acquireChannelPermit(
  channel:DeliveryChannel,
  recipientCount:number
):Promise<boolean>{
  const r=await domain10Runtime().pool.query<{allowed:boolean}>(`
    SELECT operations.acquire_channel_rate_permit_10c($1,$2) AS allowed
  `,[channel,recipientCount]);
  return r.rows[0]?.allowed??false;
}

export async function releaseClaimWithoutAttempt(
  deliveryId:string,
  workerId:string,
  delayMs:number,
  reason:string
):Promise<void>{
  await domain10Runtime().pool.query(`
    SELECT operations.release_delivery_claim_10c($1,$2,$3,$4)
  `,[deliveryId,workerId,delayMs,reason]);
}
