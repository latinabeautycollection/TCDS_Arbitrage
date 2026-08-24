import type { DeliveryProvider, ProviderFailure } from "../models/deliveryTypes";

export class DeliveryProviderError extends Error implements ProviderFailure {
  constructor(
    public readonly provider: DeliveryProvider,
    public readonly failureClass: ProviderFailure["failureClass"],
    message: string,
    public readonly retryable: boolean,
    public readonly ambiguousOutcome: boolean,
    public readonly httpStatus?: number,
    public readonly providerCode?: string,
    public readonly retryAfterMs?: number,
    options?: { cause?: unknown }
  ) {
    super(message, options);
    this.name = "DeliveryProviderError";
  }
}

export class DeliveryContractError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "DELIVERY_NOT_FOUND"
      | "LEASE_LOST"
      | "CHANNEL_DISABLED"
      | "SMS_NOT_ELIGIBLE"
      | "RECIPIENT_MISSING"
      | "PROVIDER_MISMATCH"
      | "INVALID_PROVIDER_ACCEPTANCE"
      | "RECEIPT_MISMATCH"
      | "DATABASE_CONTRACT"
  ) {
    super(message);
    this.name = "DeliveryContractError";
  }
}
