export type GeminiAuthErrorClass =
  | 'MISSING_CREDENTIALS'
  | 'INVALID_CREDENTIALS'
  | 'PERMISSION_DENIED'
  | 'QUOTA_EXCEEDED'
  | 'RATE_LIMITED'
  | 'SERVICE_UNAVAILABLE'
  | 'MODEL_UNAVAILABLE'
  | 'UNSUPPORTED_AUTH_MODE'
  | 'UNKNOWN';

export class GeminiAuthError extends Error {
  constructor(
    message: string,
    public readonly errorClass: GeminiAuthErrorClass,
    public readonly retryable = false,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'GeminiAuthError';
  }
}

export function classifyGeminiError(error: any): GeminiAuthError {
  const status = error?.status ?? error?.code ?? error?.response?.status;
  const message = String(error?.message ?? error?.response?.data?.error?.message ?? error);
  if (status === 401) return new GeminiAuthError(message, 'INVALID_CREDENTIALS', false, { status });
  if (status === 403) return new GeminiAuthError(message, 'PERMISSION_DENIED', false, { status });
  if (status === 404) return new GeminiAuthError(message, 'MODEL_UNAVAILABLE', false, { status });
  if (status === 429) return new GeminiAuthError(message, 'RATE_LIMITED', true, { status });
  if (status === 503 || status === 500) return new GeminiAuthError(message, 'SERVICE_UNAVAILABLE', true, { status });
  return new GeminiAuthError(message, 'UNKNOWN', true, { status });
}
