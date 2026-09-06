export type ObservationType =
  | 'REQUEST'|'DATABASE_OPERATION'|'WORKER_EXECUTION'
  | 'QUEUE_ENQUEUE'|'QUEUE_DEQUEUE'|'QUEUE_RETRY'|'QUEUE_DEAD_LETTER'
  | 'EXTERNAL_API_CALL'|'DOMAIN_EVENT'|'OUTBOX_EVENT'
  | 'HEALTH_CHANGE'|'READINESS_CHANGE'|'POLICY_CHANGE'|'CAPITAL_SAFETY_CHANGE'
  | 'MUTATION_REFERENCE'|'AUDIT_REFERENCE'|'ERROR'|'RECOVERY';

export type ObservationOutcome='SUCCESS'|'FAILURE'|'DEGRADED'|'RETRY'|'TIMEOUT'|'CANCELLED'|'UNKNOWN';
export type ObservationSeverity='DEBUG'|'INFO'|'WARN'|'ERROR'|'CRITICAL';

export interface ObservabilityPrincipal {
  reference:string;
  authSessionId:string;
  permissions:string[];
}

export interface TraceContext {
  traceId?:string;
  spanId?:string;
  parentSpanId?:string;
  traceFlags?:number;
  traceState?:string;
}

export interface ObservabilityContext extends TraceContext {
  correlationId?:string;
  requestId?:string;
  causationId?:string;
}

export interface ObservationInput extends Partial<TraceContext> {
  observationType:ObservationType;
  subjectDomainCode:string;
  subjectComponentId?:string;
  operationCode:string;
  outcome:ObservationOutcome;
  severity:ObservationSeverity;
  correlationId:string;
  requestId:string;
  causationId?:string;
  eventId?:string;
  transactionId?:string;
  jobId?:string;
  queueMessageId?:string;
  authoritativeReference?:string;
  authoritativeRecordSha256?:string;
  durationMs?:number;
  metadata:Record<string,unknown>;
  sourceEventId?:string;
  occurredAt:Date;
  idempotencyKey:string;
}

export interface ObservationRow {
  observation_id:string;
  observation_type_code:string;
  producer_domain_code:string;
  producer_component_id:string;
  subject_domain_code:string;
  subject_component_id:string|null;
  operation_code:string;
  outcome:string;
  severity:string;
  correlation_id:string;
  request_id:string|null;
  causation_id:string|null;
  event_id:string|null;
  trace_id:string|null;
  span_id:string|null;
  parent_span_id:string|null;
  principal_authority:string;
  trusted_actor_reference:string;
  auth_session_id:string|null;
  authoritative_reference:string|null;
  duration_ms:string|null;
  metadata:Record<string,unknown>;
  occurred_at:Date|string;
  recorded_at:Date|string;
}

export interface QueryWindow {from:Date;to:Date;limit:number;}
