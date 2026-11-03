import type { WorkflowScanDecision } from "../contracts/WorkflowScanDecision";

/**
 * One failure shape at the 6.2D boundary.
 *
 * The six authoritative API helpers report failure in different ways: a typed error
 * class carrying `code` (storage, Pack/Ship, inventory), a plain `Error` whose message is
 * the code (picking, receiving), a browser `AbortError` when a request times out, or, for
 * returns, a thrown plain object carrying `code`. The helpers stay exactly as they are;
 * this module reads all of those shapes and returns one classification.
 */
export type WorkflowFailureKind =
  /** The transport outcome is unknown, so the server may already have committed. */
  | "UNCERTAIN"
  | "SESSION_EXPIRED"
  | "CONFLICT"
  | "STALE_STATE"
  | "REJECTED";

export interface WorkflowFailure {
  kind: WorkflowFailureKind;
  code: string;
  supportReference?: string;
}

const UNCERTAIN_CODES = new Set([
  "REQUEST_TIMEOUT",
  "NETWORK_ERROR",
  "NETWORK_UNAVAILABLE",
  "RETURN_API_UNAVAILABLE",
]);

// Status 0 is a request that never got an answer, 408 a timeout. Every 5xx is uncertain
// too: the server failed while handling the request, possibly after it had committed, so
// the retry must carry the same identity.
const UNCERTAIN_STATUS = new Set([0, 408]);

// Picking, receiving and Pack/Ship report a server failure only as text, such as
// HTTP_500 or PICK_API_503, without a numeric status.
const SERVER_FAILURE_CODE = /^(?:HTTP|PICK_API)_5\d\d$/;

// The Fetch API rejects with a TypeError when the network cannot be reached. Any other
// TypeError is a defect, and must not be retried as though it were a lost response.
const NETWORK_TYPE_ERROR = /failed to fetch|load failed|network/i;

function field(value: unknown, key: string): unknown {
  return value && typeof value === "object" && key in value
    ? (value as Record<string, unknown>)[key]
    : undefined;
}

export function classifyWorkflowFailure(error: unknown): WorkflowFailure {
  if (field(error, "name") === "AbortError") {
    return { kind: "UNCERTAIN", code: "REQUEST_TIMEOUT" };
  }

  if (error instanceof TypeError) {
    return NETWORK_TYPE_ERROR.test(error.message)
      ? { kind: "UNCERTAIN", code: "NETWORK_ERROR" }
      : { kind: "REJECTED", code: "WORKFLOW_CLIENT_FAULT" };
  }

  const rawCode = field(error, "code");
  const code =
    typeof rawCode === "string" && rawCode
      ? rawCode
      : error instanceof Error && error.message
        ? error.message
        : "WORKFLOW_UNKNOWN_FAILURE";

  const rawStatus = field(error, "status");
  const status = typeof rawStatus === "number" ? rawStatus : undefined;

  const rawReference = field(error, "supportReference");
  const reference =
    typeof rawReference === "string" && rawReference
      ? { supportReference: rawReference }
      : {};

  const serverFailure =
    (status !== undefined && status >= 500 && status <= 599) || SERVER_FAILURE_CODE.test(code);

  if (
    UNCERTAIN_CODES.has(code) ||
    serverFailure ||
    (status !== undefined && UNCERTAIN_STATUS.has(status))
  ) {
    return { kind: "UNCERTAIN", code, ...reference };
  }
  if (code === "SESSION_EXPIRED" || status === 401) {
    return { kind: "SESSION_EXPIRED", code, ...reference };
  }
  if (code === "STALE_VERSION" || status === 412) {
    return { kind: "STALE_STATE", code, ...reference };
  }
  if (code === "CONFLICT" || status === 409) {
    return { kind: "CONFLICT", code, ...reference };
  }
  return { kind: "REJECTED", code, ...reference };
}

/** The decision a failure produces. A scan that failed is never reported as accepted. */
export function decisionForFailure(failure: WorkflowFailure): WorkflowScanDecision<WorkflowFailure> {
  switch (failure.kind) {
    case "UNCERTAIN":
      return { outcome: "RECONCILING", reasonCode: "RECONCILIATION_REQUIRED", nextAction: "RECONCILE", result: failure };
    case "SESSION_EXPIRED":
      return { outcome: "BLOCKED", reasonCode: failure.code, nextAction: "REAUTHENTICATE", result: failure };
    case "STALE_STATE":
      return { outcome: "STALE_STATE", reasonCode: failure.code, nextAction: "REFRESH_WORKFLOW", result: failure };
    case "CONFLICT":
      return { outcome: "CONFLICT", reasonCode: failure.code, nextAction: "REFRESH_WORKFLOW", result: failure };
    case "REJECTED":
      return { outcome: "REJECTED", reasonCode: failure.code, nextAction: "RESUME_SAME_PROFILE", result: failure };
  }
}
