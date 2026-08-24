import type { EmailDeliveryPort } from "../ports/emailDeliveryPort";
import type {
  EmailProviderSubmission,
  ProviderAcceptance,
  ProviderFailure
} from "../models/deliveryTypes";
import { DeliveryProviderError } from "../errors/DeliveryOrchestrationError";

interface ExistingGraphEmailRecipient {
  address: string;
  name?: string;
}

interface ExistingGraphSendRequest {
  to: ExistingGraphEmailRecipient[];
  bcc?: ExistingGraphEmailRecipient[];
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

interface ExistingGraphSendResult {
  accepted: true;
  httpStatus: 202;
  providerRequestId?: string;
  providerClientRequestId: string;
}

/**
 * Structural contract of the existing production MicrosoftGraphEmailProvider.
 * 10C does not own Entra authentication, sender mailbox selection, Graph base
 * URL, certificate configuration, or HTTP transport.
 */
export interface ExistingGraphSender {
  send(request: ExistingGraphSendRequest): Promise<ExistingGraphSendResult>;
}

type ExistingProviderErrorLike = Error & {
  failure?: ProviderFailure["failureClass"];
  retryable?: boolean;
  ambiguousOutcome?: boolean;
  httpStatus?: number;
  providerCode?: string;
  retryAfterMs?: number;
};

function plainTextToSafeHtml(text: string): string {
  const escaped = text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
  return `<pre>${escaped}</pre>`;
}

function normalizeExistingGraphError(error: unknown): DeliveryProviderError {
  if (error instanceof DeliveryProviderError) return error;

  if (error instanceof Error) {
    const e = error as ExistingProviderErrorLike;
    const known = new Set<ProviderFailure["failureClass"]>([
      "AUTHENTICATION","AUTHORIZATION","THROTTLED","TIMEOUT","NETWORK",
      "INVALID_REQUEST","PROVIDER_5XX","PROTOCOL","UNKNOWN"
    ]);
    if (e.failure && known.has(e.failure)) {
      return new DeliveryProviderError(
        "MICROSOFT_GRAPH",
        e.failure,
        e.message,
        Boolean(e.retryable),
        Boolean(e.ambiguousOutcome),
        e.httpStatus,
        e.providerCode,
        e.retryAfterMs,
        { cause: error }
      );
    }
  }

  // Unknown exception crossing an actual provider invocation boundary is
  // conservatively ambiguous: do not automatically resend.
  return new DeliveryProviderError(
    "MICROSOFT_GRAPH",
    "UNKNOWN",
    error instanceof Error ? error.message : "Unknown Microsoft Graph provider error",
    false,
    true,
    undefined,
    undefined,
    undefined,
    { cause: error }
  );
}

export function adaptExistingMicrosoftGraphSender(sender: ExistingGraphSender): EmailDeliveryPort {
  return {
    async sendOnce(request: EmailProviderSubmission): Promise<ProviderAcceptance> {
      try {
        const result = await sender.send({
          to: [{ address: request.to }],
          subject: request.subject,
          textBody: request.textBody,
          htmlBody: request.htmlBody ?? plainTextToSafeHtml(request.textBody),
          eventId: request.eventId,
          notificationId: request.notificationId,
          correlationId: request.correlationId,
          deliveryId: request.deliveryId,
          attemptId: request.attemptId,
          ...(request.incidentId ? { incidentId: request.incidentId } : {}),
          importance: request.importance
        });

        if (result.httpStatus !== 202 || result.accepted !== true) {
          throw new DeliveryProviderError(
            "MICROSOFT_GRAPH",
            "PROTOCOL",
            "Microsoft Graph sendMail did not satisfy the HTTP 202 acceptance contract",
            false,
            false,
            result.httpStatus
          );
        }

        return {
          provider: "MICROSOFT_GRAPH",
          httpStatus: 202,
          ...(result.providerRequestId ? { providerRequestId: result.providerRequestId } : {}),
          receipt: {
            httpStatus: 202,
            providerRequestId: result.providerRequestId ?? null,
            providerClientRequestId: result.providerClientRequestId
          }
        };
      } catch (error) {
        throw normalizeExistingGraphError(error);
      }
    }
  };
}
