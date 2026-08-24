export type DeliveryChannel = "EMAIL" | "SMS";
export type DeliveryProvider = "MICROSOFT_GRAPH" | "TELNYX";

export type DeliveryState =
  | "PENDING"
  | "CLAIMED"
  | "SENDING"
  | "ACCEPTED_BY_PROVIDER"
  | "DELIVERED"
  | "UNKNOWN_PROVIDER_OUTCOME"
  | "FAILED_RETRYABLE"
  | "FAILED_FINAL"
  | "DEAD_LETTERED"
  | "SUPPRESSED"
  | "CANCELLED";

export interface ClaimedDelivery {
  deliveryId: string;
  outboxId: number;
  notificationId: string;
  recipientId: string;
  channel: DeliveryChannel;
  provider: DeliveryProvider;
  state: DeliveryState;
  attemptCount: number;
  maxAttempts: number;
  renderedSubject?: string;
  renderedTextBody: string;
  renderedHtmlBody?: string;
  emailAddress?: string;
  mobileE164?: string;
  eventId: string;
  eventType: string;
  severity: string;
  classification: string;
  correlationId: string;
  traceId?: string;
  requestId?: string;
  leaseOwner: string;
}

export interface DeliveryAttempt {
  attemptId: string;
  attemptNumber: number;
}

export interface EmailProviderSubmission {
  to: string;
  subject: string;
  textBody: string;
  htmlBody?: string;
  eventId: string;
  notificationId: string;
  deliveryId: string;
  attemptId: string;
  correlationId: string;
  traceId?: string;
  incidentId?: string;
  importance: "low" | "normal" | "high";
}

export interface SmsProviderSubmission {
  to: string;
  text: string;
  eventId: string;
  notificationId: string;
  deliveryId: string;
  attemptId: string;
  correlationId: string;
}

export interface ProviderAcceptance {
  provider: DeliveryProvider;
  httpStatus: number;
  providerRequestId?: string;
  providerMessageId?: string;
  retryAfterMs?: number;
  receipt: Record<string, unknown>;
}

export interface ProviderFailure {
  provider: DeliveryProvider;
  failureClass:
    | "AUTHENTICATION"
    | "AUTHORIZATION"
    | "THROTTLED"
    | "TIMEOUT"
    | "NETWORK"
    | "INVALID_REQUEST"
    | "PROVIDER_5XX"
    | "PROTOCOL"
    | "UNKNOWN";
  message: string;
  retryable: boolean;
  ambiguousOutcome: boolean;
  httpStatus?: number;
  providerCode?: string;
  retryAfterMs?: number;
}

export type ExecutionDisposition =
  | "ACCEPTED"
  | "RETRY_SCHEDULED"
  | "UNKNOWN_QUARANTINED"
  | "DEAD_LETTERED"
  | "SUPPRESSED"
  | "CANCELLED";

export interface ExecutionResult {
  deliveryId: string;
  channel: DeliveryChannel;
  disposition: ExecutionDisposition;
  attemptId?: string;
  attemptNumber?: number;
}

export interface NormalizedTelnyxDeliveryEvent {
  providerEventId: string;
  providerMessageId: string;
  eventType: "message.sent" | "message.finalized";
  occurredAt: string;
  status:
    | "queued"
    | "sending"
    | "sent"
    | "delivered"
    | "sending_failed"
    | "delivery_failed"
    | "delivery_unconfirmed";
  errors: Array<{ code?: string; title?: string; detail?: string }>;
  rawEvidence: Record<string, unknown>;
  correlationId?: string;
}
