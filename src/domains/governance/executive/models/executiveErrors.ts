export class ExecutiveGovernanceError extends Error {
  constructor(public readonly code: string, message: string, public readonly httpStatus = 500, public readonly details?: unknown) {
    super(message); this.name='ExecutiveGovernanceError';
  }
}
