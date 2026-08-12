export type EmailFailure =
  | "AUTHENTICATION" | "AUTHORIZATION" | "THROTTLED" | "TIMEOUT"
  | "NETWORK" | "INVALID_REQUEST" | "PROVIDER_5XX" | "PROTOCOL" | "UNKNOWN";

export class EmailProviderError extends Error {
  constructor(
    message: string,
    public readonly failure: EmailFailure,
    public readonly retryable: boolean,
    public readonly ambiguousOutcome: boolean,
    public readonly httpStatus?: number,
    public readonly providerCode?: string,
    public readonly retryAfterMs?: number,
    options?: { cause?: unknown }
  ) {
    super(message, options);
    this.name = "EmailProviderError";
  }
}
