import type {
  EmailProviderSubmission,
  ProviderAcceptance
} from "../models/deliveryTypes";

export interface EmailDeliveryPort {
  /**
   * Exactly one Microsoft Graph submission attempt.
   * A successful implementation must return only after Graph returns HTTP 202.
   * It must not contain business-level retry loops.
   */
  sendOnce(request: EmailProviderSubmission): Promise<ProviderAcceptance>;
}
