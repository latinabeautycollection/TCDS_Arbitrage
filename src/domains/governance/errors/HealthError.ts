export class HealthError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly retryable: boolean,
    public readonly details?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name = "HealthError";
  }
}
