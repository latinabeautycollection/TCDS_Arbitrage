export const OBSERVATION_TYPES = new Set([
  'REQUEST','DATABASE_OPERATION','WORKER_EXECUTION','QUEUE_ENQUEUE','QUEUE_DEQUEUE','QUEUE_RETRY',
  'QUEUE_DEAD_LETTER','EXTERNAL_API_CALL','DOMAIN_EVENT','OUTBOX_EVENT','HEALTH_CHANGE',
  'READINESS_CHANGE','POLICY_CHANGE','CAPITAL_SAFETY_CHANGE','MUTATION_REFERENCE',
  'AUDIT_REFERENCE','ERROR','RECOVERY'
] as const);

export const LOW_CARDINALITY_METRIC_LABELS = new Set([
  'domain','component_type','observation_type','outcome','provider_type','severity'
]);

export const FORBIDDEN_METRIC_LABELS = new Set([
  'correlation_id','request_id','trace_id','span_id','user_id','order_id','shipment_id',
  'entity_id','job_id','queue_message_id'
]);

// Metadata is intentionally scalar-only and centrally allowlisted. 11G stores
// operational dimensions, not shadow copies of business payloads.
export const SAFE_METADATA_KEYS = new Set([
  'aggregateType','aggregateId','domainEventId','topic','status','attempts',
  'sourceSchema','sourceTable','sourceEntityId','eventType','targetReference',
  'providerType','retryCount','errorCode','errorClass','count','state','result',
  'queueName','workerName','endpoint','method','httpStatus','dependency','componentType',
  'operationClass','reasonCode','previousState','currentState','policyCode','policyVersion',
  'assessmentState','readinessState','healthState','outboxStatus','mutationKind'
]);
