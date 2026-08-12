export type EmailSeverity =
  | "INFORMATIONAL" | "NOTICE" | "WARNING" | "HIGH" | "CRITICAL" | "EMERGENCY";

export type DataClassification = "PUBLIC" | "INTERNAL" | "CONFIDENTIAL" | "RESTRICTED";

export type DeliveryState =
  | "PENDING" | "CLAIMED" | "SENDING" | "ACCEPTED_BY_PROVIDER"
  | "UNKNOWN_PROVIDER_OUTCOME" | "FAILED_RETRYABLE" | "FAILED_FINAL"
  | "DEAD_LETTERED" | "SUPPRESSED" | "CANCELLED";

export interface EmailRecipient { address: string; name?: string; }

export interface NotificationRequest {
  eventId: string;
  notificationId: string;
  correlationId: string;
  incidentId?: string;
  eventType: string;
  severity: EmailSeverity;
  classification: DataClassification;

  /** Explicit recipients OR audienceKey. Never both. */
  recipients?: EmailRecipient[];
  audienceKey?: string;

  templateKey: string;
  templateVersion: number;
  policyVersion: string;
  variables: Record<string, string | number | boolean | null>;
  occurredAt: string;
}

export interface RenderedEmail {
  subject: string;
  textBody: string;
  htmlBody: string;
  templateKey: string;
  templateVersion: number;
  subjectHash: string;
  bodyHash: string;
}

export interface GraphSendRequest {
  to: EmailRecipient[];
  bcc?: EmailRecipient[];
  subject: string;
  textBody: string;
  htmlBody: string;
  eventId: string;
  notificationId: string;
  correlationId: string;
  deliveryId: string;
  attemptId: string;
  incidentId?: string;
  importance: "low" | "normal" | "high";
}

export interface GraphSendResult {
  accepted: true;
  httpStatus: 202;
  providerRequestId?: string;
  providerClientRequestId: string;
}

export interface ClaimedDelivery {
  deliveryId: string;
  requestId: string;
  idempotencyKey: string;
  state: DeliveryState;
  attemptCount: number;
  recipients: EmailRecipient[];
  renderedSubject: string;
  renderedTextBody: string;
  renderedHtmlBody: string;
  eventId: string;
  notificationId: string;
  correlationId: string;
  incidentId?: string;
  severity: EmailSeverity;
  leaseOwner: string;
}
