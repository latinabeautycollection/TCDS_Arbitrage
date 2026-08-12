import { createHash, randomUUID } from "node:crypto";
import { emailEnv } from "../config/emailEnv";
import type { EmailRecipient, NotificationRequest } from "../models/emailTypes";
import { assertEmailEnabled } from "../repositories/emailControlRepository";
import { resolveAndAuthorizeRecipients } from "./recipientAuthorizationService";
import { validateNoForbiddenVariables } from "./dataRedactionService";
import { renderEmail } from "./emailTemplateService";
import { createNotificationAndDeliveries } from "../repositories/emailDeliveryRepository";
import { emailRequests } from "../observability/emailMetrics";

function chunks<T>(items:T[],size:number):T[][]{
  const out:T[][]=[];
  for(let i=0;i<items.length;i+=size) out.push(items.slice(i,i+size));
  return out;
}
function stableHash(parts:string[]):string{
  return createHash("sha256").update(parts.join("|")).digest("hex");
}

export async function enqueueEmail(req:NotificationRequest):Promise<{deliveryIds:string[];created:number}>{
  const env=emailEnv();
  if(!env.DOMAIN10_EMAIL_ENABLED) throw new Error("Email disabled by environment kill switch");
  await assertEmailEnabled();

  validateNoForbiddenVariables(req.variables);
  const recipients=await resolveAndAuthorizeRecipients(req);

  if(recipients.length>env.DOMAIN10_EMAIL_MAX_RECIPIENTS_PER_NOTIFICATION){
    throw new Error("Notification recipient policy exceeded");
  }

  const rendered=await renderEmail(req.templateKey,req.templateVersion,req.variables);
  if(rendered.subject.length>env.DOMAIN10_EMAIL_MAX_SUBJECT_LENGTH) throw new Error("Subject too long");
  if(Buffer.byteLength(rendered.textBody)+Buffer.byteLength(rendered.htmlBody)>env.DOMAIN10_EMAIL_MAX_BODY_BYTES){
    throw new Error("Body too large");
  }

  const recipientBatches=chunks(recipients,env.DOMAIN10_EMAIL_MAX_RECIPIENTS_PER_MESSAGE);
  const requestId=randomUUID();

  const deliveries=recipientBatches.map((batch,index)=>({
    recipients:batch,
    idempotencyKey:stableHash([
      req.notificationId,req.eventId,req.templateKey,String(req.templateVersion),
      String(index),...batch.map(r=>r.address.toLowerCase()).sort()
    ])
  }));

  const result=await createNotificationAndDeliveries({
    requestId,eventId:req.eventId,notificationId:req.notificationId,correlationId:req.correlationId,
    ...(req.incidentId?{incidentId:req.incidentId}:{}),
    eventType:req.eventType,severity:req.severity,classification:req.classification,
    recipients,templateKey:req.templateKey,templateVersion:req.templateVersion,
    policyVersion:req.policyVersion,variables:req.variables,rendered,deliveries
  });

  emailRequests.inc();
  return result;
}
