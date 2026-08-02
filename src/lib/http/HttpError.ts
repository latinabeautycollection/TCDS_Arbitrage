export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    readonly details: Readonly<Record<string, unknown>> = {},
  ) {
    super(code);
    this.name = 'HttpError';
  }
}
