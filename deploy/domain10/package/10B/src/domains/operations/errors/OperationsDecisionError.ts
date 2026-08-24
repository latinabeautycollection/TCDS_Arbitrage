export type DecisionFailureCode =
  | "EVENT_CONTRACT_MISSING"
  | "EVENT_SCHEMA_INVALID"
  | "EVENT_CONFLICT"
  | "POLICY_AMBIGUOUS"
  | "POLICY_BINDING_INVALID"
  | "AUDIENCE_INVALID"
  | "TEMPLATE_RENDER_FAILED"
  | "DATABASE_CONFLICT"
  | "PLANNER_LEASE_LOST"
  | "INTERNAL";

export class OperationsDecisionError extends Error {
  constructor(
    message: string,
    public readonly code: DecisionFailureCode,
    public readonly retryable: boolean,
    options?: { cause?: unknown }
  ) {
    super(message, options);
    this.name = "OperationsDecisionError";
  }
}
