import { domain10Runtime } from "../../infrastructure/operationsRuntime";
import type { EscalationClaim,PreparedEscalationEmission } from "../models/incidentTypes";

export async function claimDueEscalations(workerId:string,batchSize:number,leaseSeconds:number):Promise<EscalationClaim[]>{
  const r=await domain10Runtime().pool.query<any>(`
    SELECT runtime_id,incident_id,escalation_id,step_number,next_repeat_number
    FROM operations.claim_due_incident_escalations_10d($1,$2,$3)
  `,[workerId,batchSize,leaseSeconds]);
  return r.rows.map((x:any)=>({runtimeId:x.runtime_id,incidentId:x.incident_id,escalationId:x.escalation_id,stepNumber:x.step_number,repeatNumber:x.next_repeat_number}));
}

export async function prepareEscalationEmission(runtimeId:string,workerId:string):Promise<PreparedEscalationEmission|null>{
  const r=await domain10Runtime().pool.query<any>(`
    SELECT * FROM operations.prepare_escalation_emission_10d($1,$2)
  `,[runtimeId,workerId]);
  const x=r.rows[0];
  if(!x||!x.emission_id) return null;
  return {
    emissionId:x.emission_id,runtimeId:x.runtime_id,incidentId:x.incident_id,incidentKey:x.incident_key,
    sourceEventId:x.source_event_id,eventType:x.event_type,schemaVersion:x.schema_version,
    severity:x.severity,classification:x.classification,correlationId:x.correlation_id,
    rootEventId:x.root_event_id,sourceNotificationId:x.source_notification_id,
    escalationPolicyKey:x.escalation_policy_key,stepNumber:x.step_number,repeatNumber:x.repeat_number,
    targetAudienceKey:x.target_audience_key,reason:x.reason
  };
}

export async function markEscalationEventEmitted(emissionId:string,workerId:string,eventId:string):Promise<void>{
  await domain10Runtime().pool.query(`SELECT operations.mark_escalation_event_emitted_10d($1,$2,$3)`,[emissionId,workerId,eventId]);
}

export async function failEscalationEmission(runtimeId:string,workerId:string,error:string):Promise<void>{
  await domain10Runtime().pool.query(`SELECT operations.fail_escalation_emission_10d($1,$2,$3)`,[runtimeId,workerId,error.slice(0,1000)]);
}

export interface SettlementClaim{emissionId:string;}
export async function claimEscalationSettlements(workerId:string,batchSize:number,leaseSeconds:number):Promise<SettlementClaim[]>{
  const r=await domain10Runtime().pool.query<any>(`
    SELECT emission_id FROM operations.claim_escalation_settlements_10d($1,$2,$3)
  `,[workerId,batchSize,leaseSeconds]);
  return r.rows.map((x:any)=>({emissionId:x.emission_id}));
}

export async function settleEscalationEmission(emissionId:string,workerId:string):Promise<"PENDING"|"SETTLED">{
  const r=await domain10Runtime().pool.query<{result:"PENDING"|"SETTLED"}>(`
    SELECT operations.settle_escalation_emission_10d($1,$2) AS result
  `,[emissionId,workerId]);
  return r.rows[0]?.result??"PENDING";
}
