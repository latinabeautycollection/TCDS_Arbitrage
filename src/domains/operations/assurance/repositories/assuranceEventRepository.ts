import { domain10Runtime } from "../../infrastructure/operationsRuntime";
import type {
  AssuranceEventEnvelope,
  ClaimedAssuranceEvent
} from "../models/assuranceTypes";

export async function claimAssuranceEvents(
  workerId:string,
  batchSize:number,
  leaseSeconds:number
):Promise<ClaimedAssuranceEvent[]>{
  const r=await domain10Runtime().pool.query<any>(`
    SELECT assurance_event_id,source_event_id,event_type,occurred_at,severity,
           correlation_id,subject_id,payload,attempt_count,max_attempts
    FROM operations.claim_assurance_events_10e($1,$2,$3)
  `,[workerId,batchSize,leaseSeconds]);

  return r.rows.map((x:any)=>{
    const payload=x.payload as AssuranceEventEnvelope["payload"];
    return {
      assuranceEventId:x.assurance_event_id,
      attemptCount:Number(x.attempt_count),
      maxAttempts:Number(x.max_attempts),
      event:{
        sourceKey:"DOMAIN10_ASSURANCE",
        sourceEventId:x.source_event_id,
        eventType:x.event_type,
        occurredAt:new Date(x.occurred_at).toISOString(),
        severity:x.severity,
        classification:"INTERNAL",
        subjectType:"COMMUNICATION_ASSURANCE_POLICY",
        subjectId:x.subject_id,
        correlationId:x.correlation_id,
        schemaVersion:1,
        producer:"DOMAIN10_10E",
        payload
      }
    };
  });
}

export async function markAssuranceEventEmitted(
  assuranceEventId:string,
  workerId:string,
  operationalEventId:string
):Promise<void>{
  await domain10Runtime().pool.query(`
    SELECT operations.mark_assurance_event_emitted_10e($1,$2,$3)
  `,[assuranceEventId,workerId,operationalEventId]);
}

export async function failAssuranceEventEmission(
  assuranceEventId:string,
  workerId:string,
  errorMessage:string,
  retryMs:number
):Promise<"RETRY"|"FAILED">{
  const r=await domain10Runtime().pool.query<{disposition:"RETRY"|"FAILED"}>(`
    SELECT operations.fail_assurance_event_emission_10e($1,$2,$3,$4) AS disposition
  `,[assuranceEventId,workerId,errorMessage.slice(0,1000),retryMs]);
  return r.rows[0]?.disposition??"FAILED";
}
