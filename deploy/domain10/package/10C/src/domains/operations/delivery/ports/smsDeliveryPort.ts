import type {
  ProviderAcceptance,
  SmsProviderSubmission
} from "../models/deliveryTypes";

export interface SmsDeliveryPort {
  /**
   * Exactly one Telnyx POST /v2/messages submission attempt.
   * A successful implementation should return the Telnyx message ID from the
   * HTTP 2xx response. Delivery confirmation is handled later from verified
   * Telnyx message.finalized evidence.
   */
  sendOnce(request: SmsProviderSubmission): Promise<ProviderAcceptance>;
}
