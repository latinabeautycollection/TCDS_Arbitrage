import { incidentIntegrationRegistry } from "../ports/incidentIntegrationRegistry";
import { prepareEscalationEmission,markEscalationEventEmitted,failEscalationEmission } from "../repositories/escalationRepository";
import type { EscalationClaim,EscalationEventEnvelope } from "../models/incidentTypes";
import { domain10Runtime } from "../../infrastructure/operationsRuntime";

export async function processEscalationClaim(claim:EscalationClaim,workerId:string):Promise<void>{
  const runtime=domain10Runtime();
  const prepared=await prepareEscalationEmission(claim.runtimeId,workerId);
  if(!prepared) return; // acknowledged/cancelled/configuration-blocked during recheck.

  const event:EscalationEventEnvelope={
    sourceKey:"DOMAIN_10_OPERATIONS",sourceEventId:prepared.sourceEventId,eventType:prepared.eventType,
    occurredAt:new Date().toISOString(),severity:prepared.severity,classification:prepared.classification,
    subjectType:"INCIDENT",subjectId:prepared.incidentId,correlationId:prepared.correlationId,
    schemaVersion:prepared.schemaVersion,producer:"DOMAIN10_10D",
    payload:{incident_id:prepared.incidentId,incident_key:prepared.incidentKey,root_event_id:prepared.rootEventId,
      source_notification_id:prepared.sourceNotificationId,escalation_policy_key:prepared.escalationPolicyKey,
      escalation_step:prepared.stepNumber,repeat_number:prepared.repeatNumber,
      target_audience_key:prepared.targetAudienceKey,reason:prepared.reason}
  };

  try{
    const accepted=await incidentIntegrationRegistry().notificationDecision.acceptOperationalEvent(event);
    // sourceEventId is deterministic. If this call succeeded before a process crash,
    // reviewed 10B returns the same eventId on the next idempotent replay.
    await markEscalationEventEmitted(prepared.emissionId,workerId,accepted.eventId);
    runtime.metrics.increment("domain10_incident_escalation_emitted_total",{step:String(prepared.stepNumber)});
  }catch(error){
    await failEscalationEmission(claim.runtimeId,workerId,error instanceof Error?error.message:"Unknown escalation emission error");
    throw error;
  }
}
