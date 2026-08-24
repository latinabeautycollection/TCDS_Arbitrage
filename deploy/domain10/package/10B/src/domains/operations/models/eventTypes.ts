export type Severity =
  | "INFORMATIONAL" | "NOTICE" | "WARNING" | "HIGH" | "CRITICAL" | "EMERGENCY";

export type Classification = "PUBLIC" | "INTERNAL" | "CONFIDENTIAL" | "RESTRICTED";

export interface OperationalEventEnvelope {
  sourceKey: string;
  sourceEventId: string;
  eventType: string;
  occurredAt: string;
  severity: Severity;
  classification: Classification;
  subjectType?: string;
  subjectId?: string;
  correlationId: string;
  causationId?: string;
  traceId?: string;
  requestId?: string;
  schemaVersion: number;
  producer: string;
  payload: Record<string, unknown>;
}

export interface PersistedOperationalEvent {
  eventId: string;
  sourceId: string;
  sourceKey: string;
  sourceEventId: string;
  eventType: string;
  occurredAt: string;
  receivedAt: string;
  decisionBasisAt: string;
  severity: Severity;
  classification: Classification;
  subjectType?: string;
  subjectId?: string;
  correlationId: string;
  causationId?: string;
  traceId?: string;
  requestId?: string;
  schemaVersion: number;
  payload: Record<string, unknown>;
  payloadHash: string;
  eventContractHash?: string;
  producer: string;
}
