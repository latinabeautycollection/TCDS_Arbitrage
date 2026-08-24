import { domain10Runtime } from "../infrastructure/operationsRuntime";
import type { PolicyCandidate, RecipientResolution } from "../models/decisionTypes";
import type { PersistedOperationalEvent } from "../models/eventTypes";

export async function resolveAudienceRecipients(
  policy:PolicyCandidate,
  event:PersistedOperationalEvent
):Promise<RecipientResolution[]>{
  const r=await domain10Runtime().pool.query<any>(`
    SELECT *
    FROM operations.resolve_authorized_audience($1,$2,$3,$4)
  `,[policy.audienceId,event.eventType,event.classification,event.decisionBasisAt]);

  return r.rows.map((x:any)=>({
    recipientId:x.recipient_id,
    displayName:x.display_name,
    ...(x.email_address?{emailAddress:x.email_address}:{}),
    ...(x.mobile_e164?{mobileE164:x.mobile_e164}:{}),
    audienceKey:policy.audienceKey,
    emailAuthorized:x.email_authorized,
    smsAuthorized:x.sms_authorized,
    ...(x.sms_subscription_status?{smsSubscriptionStatus:x.sms_subscription_status}:{}),
    authorizationSnapshot:x.authorization_snapshot
  }));
}
