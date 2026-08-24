import { domain10Runtime } from "../infrastructure/operationsRuntime";
import type { PersistedOperationalEvent } from "../models/eventTypes";

export interface ClaimedPlanningItem {
  eventId: string;
  planningOutboxId: number;
}

export interface PlanningAttempt {
  planningAttemptId: string;
  attemptNumber: number;
}

export async function claimPlanningItems(
  workerId: string,
  batchSize: number,
  leaseSeconds: number
): Promise<ClaimedPlanningItem[]> {
  const r = await domain10Runtime().pool.query<{planning_outbox_id:number;event_id:string}>(`
    SELECT planning_outbox_id,event_id
    FROM operations.claim_event_planning_outbox($1,$2,$3)
  `, [workerId,batchSize,leaseSeconds]);

  return r.rows.map(x => ({
    planningOutboxId:Number(x.planning_outbox_id),
    eventId:x.event_id
  }));
}

export async function getOperationalEvent(eventId:string):Promise<PersistedOperationalEvent>{
  const r=await domain10Runtime().pool.query<any>(`
    SELECT e.event_id,e.source_id,s.source_key,e.source_event_id,e.event_type,e.occurred_at,e.received_at,
           ep.decision_basis_at,e.severity,e.classification,e.subject_type,e.subject_id,e.correlation_id,e.causation_id,
           e.trace_id,e.request_id,e.schema_version,e.payload,e.payload_hash,e.event_contract_hash,e.producer
    FROM operations.operational_events e
    JOIN operations.event_sources s ON s.source_id=e.source_id
    JOIN operations.event_processing ep ON ep.event_id=e.event_id
    WHERE e.event_id=$1
  `,[eventId]);
  const x=r.rows[0];
  if(!x) throw new Error(`Operational event ${eventId} not found`);
  return {
    eventId:x.event_id,sourceId:x.source_id,sourceKey:x.source_key,sourceEventId:x.source_event_id,
    eventType:x.event_type,occurredAt:new Date(x.occurred_at).toISOString(),
    receivedAt:new Date(x.received_at).toISOString(),
    decisionBasisAt:new Date(x.decision_basis_at).toISOString(),
    severity:x.severity,classification:x.classification,
    ...(x.subject_type?{subjectType:x.subject_type}:{}),
    ...(x.subject_id?{subjectId:x.subject_id}:{}),
    correlationId:x.correlation_id,
    ...(x.causation_id?{causationId:x.causation_id}:{}),
    ...(x.trace_id?{traceId:x.trace_id}:{}),
    ...(x.request_id?{requestId:x.request_id}:{}),
    schemaVersion:x.schema_version,payload:x.payload,payloadHash:x.payload_hash,
    ...(x.event_contract_hash?{eventContractHash:x.event_contract_hash}:{}),
    producer:x.producer
  };
}

export async function beginPlanningAttempt(eventId:string,workerId:string):Promise<PlanningAttempt>{
  const r=await domain10Runtime().pool.query<{planning_attempt_id:string;attempt_number:number}>(`
    SELECT planning_attempt_id,attempt_number
    FROM operations.begin_event_planning_attempt($1,$2)
  `,[eventId,workerId]);
  const row=r.rows[0];
  if(!row) throw new Error("Unable to begin planning attempt");
  return {planningAttemptId:row.planning_attempt_id,attemptNumber:row.attempt_number};
}

export async function failPlanningAttempt(args:{
  eventId:string;planningAttemptId:string;workerId:string;errorCode:string;errorMessage:string;
  retryable:boolean;nextAttemptAt:Date;maxAttempts:number;
}):Promise<void>{
  await domain10Runtime().pool.query(`
    SELECT operations.fail_event_planning($1,$2,$3,$4,$5,$6,$7,$8)
  `,[args.eventId,args.planningAttemptId,args.workerId,args.errorCode,
     args.errorMessage.slice(0,1000),args.retryable,args.nextAttemptAt,args.maxAttempts]);
}
