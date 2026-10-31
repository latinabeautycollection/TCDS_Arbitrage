import type { WarehouseCaptureIntent } from "./WarehouseCaptureIntent";

export type WorkflowScanOutcome =
  | "ACCEPTED"
  | "REJECTED"
  | "BLOCKED"
  | "CONFLICT"
  | "STALE_STATE"
  | "REVIEW_REQUIRED"
  | "RECONCILING";

export type WorkflowNextAction =
  | "RESUME_SAME_PROFILE"
  | "SWITCH_PROFILE"
  | "PAUSE_FOR_DOMAIN_STEP"
  | "REFRESH_WORKFLOW"
  | "SUPERVISOR_REVIEW"
  | "REAUTHENTICATE"
  | "STOP_SCANNER"
  | "RECONCILE";

export interface WorkflowScanDecision<T = unknown> {
  outcome: WorkflowScanOutcome;
  reasonCode: string;
  nextAction: WorkflowNextAction;
  nextCaptureIntent?: WarehouseCaptureIntent;
  result?: T;
}
