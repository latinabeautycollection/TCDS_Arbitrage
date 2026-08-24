import type { SmsDeliveryPort } from "../ports/smsDeliveryPort";
import type {
  ProviderAcceptance,
  ProviderFailure,
  SmsProviderSubmission
} from "../models/deliveryTypes";
import { DeliveryProviderError } from "../errors/DeliveryOrchestrationError";

export interface ExistingTelnyxSender {
  /**
   * Provider-owned sender/profile/API-key configuration stays inside the
   * existing Telnyx subsystem. 10C provides only recipient, content and
   * correlation metadata.
   */
  sendOperationalMessage(message: {
    to: string;
    text: string;
    tags: string[];
  }): Promise<{
    httpStatus: number;
    messageId?: string;
    providerRequestId?: string;
    status?: string;
  }>;
}

type ExistingTelnyxErrorLike = Error & {
  failure?: ProviderFailure["failureClass"];
  retryable?: boolean;
  ambiguousOutcome?: boolean;
  httpStatus?: number;
  providerCode?: string;
  retryAfterMs?: number;
};

function normalizeExistingTelnyxError(error: unknown): DeliveryProviderError {
  if (error instanceof DeliveryProviderError) return error;

  if (error instanceof Error) {
    const e = error as ExistingTelnyxErrorLike;
    const known = new Set<ProviderFailure["failureClass"]>([
      "AUTHENTICATION","AUTHORIZATION","THROTTLED","TIMEOUT","NETWORK",
      "INVALID_REQUEST","PROVIDER_5XX","PROTOCOL","UNKNOWN"
    ]);
    if (e.failure && known.has(e.failure)) {
      return new DeliveryProviderError(
        "TELNYX",
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

  return new DeliveryProviderError(
    "TELNYX",
    "UNKNOWN",
    error instanceof Error ? error.message : "Unknown Telnyx provider error",
    false,
    true,
    undefined,
    undefined,
    undefined,
    { cause: error }
  );
}

export function adaptExistingTelnyxSender(sender: ExistingTelnyxSender): SmsDeliveryPort {
  return {
    async sendOnce(request: SmsProviderSubmission): Promise<ProviderAcceptance> {
      try {
        const result = await sender.sendOperationalMessage({
          to: request.to,
          text: request.text,
          tags: [
            "tcds-domain10",
            `delivery:${request.deliveryId}`,
            `notification:${request.notificationId}`
          ]
        });

        if (result.httpStatus < 200 || result.httpStatus >= 300 || !result.messageId) {
          throw new DeliveryProviderError(
            "TELNYX",
            "PROTOCOL",
            "Telnyx message submission requires HTTP 2xx and a provider message ID",
            false,
            false,
            result.httpStatus
          );
        }

        return {
          provider: "TELNYX",
          httpStatus: result.httpStatus,
          ...(result.providerRequestId ? { providerRequestId: result.providerRequestId } : {}),
          providerMessageId: result.messageId,
          receipt: {
            httpStatus: result.httpStatus,
            providerRequestId: result.providerRequestId ?? null,
            providerMessageId: result.messageId,
            initialStatus: result.status ?? "queued"
          }
        };
      } catch (error) {
        throw normalizeExistingTelnyxError(error);
      }
    }
  };
}
