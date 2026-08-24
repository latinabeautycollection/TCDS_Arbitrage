export type AssuranceMetricKey =
  | "PROVIDER_ACCEPTANCE_RATE_PCT"
  | "PROVIDER_ACCEPTANCE_LATENCY_P95_MS"
  | "UNKNOWN_ATTEMPT_RATE_PCT"
  | "DEAD_LETTER_RATE_PCT"
  | "PROVIDER_HEALTH_AVAILABILITY_PCT"
  | "INCIDENT_ACK_WITHIN_SLA_RATE_PCT"
  | "INCIDENT_ACK_LATENCY_P95_MS"
  | "ESCALATION_SEND_SUCCESS_RATE_PCT";

export type AssuranceRunOutcome="PASS"|"BREACH"|"INSUFFICIENT_DATA"|"ERROR";

export interface ClaimedAssuranceRun{
  runId:string;
  policyId:string;
  policyVersion:number;
  policyKey:string;
  metricKey:AssuranceMetricKey;
  windowStart:string;
  windowEnd:string;
  attemptCount:number;
}

export interface AssuranceEvaluationResult{
  runId:string;
  outcome:AssuranceRunOutcome;
  metricValue?:number;
  thresholdValue:number;
  comparison:"LTE"|"GTE";
  sampleSize:number;
  unit:"PERCENT"|"MILLISECONDS";
}

export interface AssuranceEventEnvelope{
  sourceKey:"DOMAIN10_ASSURANCE";
  sourceEventId:string;
  eventType:"COMMUNICATION_ASSURANCE_BREACH"|"COMMUNICATION_ASSURANCE_RECOVERY";
  occurredAt:string;
  severity:"INFORMATIONAL"|"NOTICE"|"WARNING"|"HIGH"|"CRITICAL"|"EMERGENCY";
  classification:"INTERNAL";
  subjectType:"COMMUNICATION_ASSURANCE_POLICY";
  subjectId:string;
  correlationId:string;
  schemaVersion:1;
  producer:"DOMAIN10_10E";
  payload:{
    assurance_event_id:string;
    episode_id:string;
    run_id:string;
    policy_key:string;
    policy_version:number;
    metric_key:AssuranceMetricKey;
    channel:string|null;
    provider:string|null;
    window_start:string;
    window_end:string;
    metric_value:number;
    threshold_value:number;
    comparison:"LTE"|"GTE";
    sample_size:number;
    reason:string;
  };
}

export interface ClaimedAssuranceEvent{
  assuranceEventId:string;
  event:AssuranceEventEnvelope;
  attemptCount:number;
  maxAttempts:number;
}
