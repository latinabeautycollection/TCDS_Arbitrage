import type { PersistedOperationalEvent } from "../models/eventTypes";
import type { PolicyCandidate } from "../models/decisionTypes";
import { getPolicyCandidates } from "../repositories/policyRepository";
import { OperationsDecisionError } from "../errors/OperationsDecisionError";

export async function resolveAuthoritativePolicy(
  event:PersistedOperationalEvent
):Promise<{candidates:PolicyCandidate[];winner?:PolicyCandidate}>{
  const candidates=await getPolicyCandidates(event);
  if(!candidates.length) return {candidates};

  const top=candidates[0]!;
  const tied=candidates.filter(
    p=>p.decisionPriority===top.decisionPriority &&
       p.patternSpecificity===top.patternSpecificity
  );

  if(tied.length>1){
    throw new OperationsDecisionError(
      `Ambiguous notification policy for ${event.eventType}: `+
      tied.map(x=>`${x.policyKey}@${x.policyVersion}`).join(", "),
      "POLICY_AMBIGUOUS",false
    );
  }

  const channels=new Set(top.templates.map(t=>t.channel));
  if(top.emailEnabled && !channels.has("EMAIL")){
    throw new OperationsDecisionError("Frozen policy is missing EMAIL template binding","POLICY_BINDING_INVALID",false);
  }
  if(top.smsEnabled && !channels.has("SMS")){
    throw new OperationsDecisionError("Frozen policy is missing SMS template binding","POLICY_BINDING_INVALID",false);
  }
  if(!top.emailEnabled && channels.has("EMAIL")){
    throw new OperationsDecisionError("Frozen policy has unexpected EMAIL binding","POLICY_BINDING_INVALID",false);
  }
  if(!top.smsEnabled && channels.has("SMS")){
    throw new OperationsDecisionError("Frozen policy has unexpected SMS binding","POLICY_BINDING_INVALID",false);
  }

  return {candidates,winner:top};
}
