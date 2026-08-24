import type { PersistedOperationalEvent } from "../models/eventTypes";
import type { PolicyCandidate,RecipientResolution } from "../models/decisionTypes";
import { resolveAudienceRecipients } from "../repositories/audienceRepository";
import { OperationsDecisionError } from "../errors/OperationsDecisionError";

export async function resolveRecipients(
  event:PersistedOperationalEvent,
  policy:PolicyCandidate
):Promise<RecipientResolution[]>{
  try{
    const rows=await resolveAudienceRecipients(policy,event);
    const map=new Map<string,RecipientResolution>();
    for(const r of rows) map.set(r.recipientId,r);
    return [...map.values()];
  }catch(cause){
    throw new OperationsDecisionError(
      `Audience resolution failed for ${policy.audienceKey}`,
      "AUDIENCE_INVALID",false,{cause}
    );
  }
}
