export class PhotographyError extends Error {
  constructor(
    message: string,
    public readonly code = 'PHOTOGRAPHY_ERROR',
    public readonly retryable = false,
    public readonly details: Record<string, unknown> = {}
  ) { super(message); this.name = 'PhotographyError'; }
}
