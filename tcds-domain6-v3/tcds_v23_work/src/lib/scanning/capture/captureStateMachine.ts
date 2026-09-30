import {
  BarcodeCaptureError,
} from "./BarcodeCaptureError";
import type {
  BarcodeCapturePhase,
} from "./BarcodeCaptureStatus";

const FAILURE_PHASES = [
  "PERMISSION_DENIED",
  "CAMERA_UNAVAILABLE",
  "CAMERA_ERROR",
  "CAPTURE_ERROR",
] as const satisfies readonly BarcodeCapturePhase[];

const operationalFailures =
  FAILURE_PHASES as readonly BarcodeCapturePhase[];

// A capture session can be blocked by the runtime at any moment, for example
// when licensing or runtime authorization is withdrawn. BLOCKED is therefore
// reachable from every live phase, and leaves only through STOPPED, so a new
// session always starts from a released one.
const TRANSITIONS: Readonly<
  Record<BarcodeCapturePhase, readonly BarcodeCapturePhase[]>
> = {
  IDLE: ["CAMERA_REQUESTED", "BLOCKED", "STOPPED"],
  CAMERA_REQUESTED: [
    "PERMISSION_PENDING",
    "CAMERA_STARTING",
    ...operationalFailures,
    "BLOCKED",
    "STOPPED",
  ],
  PERMISSION_PENDING: [
    "CAMERA_STARTING",
    ...operationalFailures,
    "BLOCKED",
    "STOPPED",
  ],
  CAMERA_STARTING: [
    "READY",
    "CAPTURING",
    ...operationalFailures,
    "BLOCKED",
    "STOPPED",
  ],
  READY: [
    "CAPTURING",
    "PAUSED",
    "RECOVERING",
    ...operationalFailures,
    "BLOCKED",
    "STOPPED",
  ],
  CAPTURING: [
    "DECODED",
    "PAUSED",
    "RECOVERING",
    ...operationalFailures,
    "BLOCKED",
    "STOPPED",
  ],
  DECODED: [
    "PAUSED",
    ...operationalFailures,
    "BLOCKED",
    "STOPPED",
  ],
  PAUSED: [
    "READY",
    "CAMERA_STARTING",
    "CAPTURING",
    "RECOVERING",
    ...operationalFailures,
    "BLOCKED",
    "STOPPED",
  ],
  PERMISSION_DENIED: [
    "RECOVERING",
    "CAMERA_REQUESTED",
    "STOPPED",
  ],
  CAMERA_UNAVAILABLE: [
    "RECOVERING",
    "CAMERA_REQUESTED",
    "STOPPED",
  ],
  CAMERA_ERROR: [
    "RECOVERING",
    "CAMERA_REQUESTED",
    "STOPPED",
  ],
  CAPTURE_ERROR: [
    "RECOVERING",
    "CAMERA_REQUESTED",
    "STOPPED",
  ],
  RECOVERING: [
    "CAMERA_REQUESTED",
    "CAMERA_STARTING",
    "READY",
    "CAPTURING",
    ...operationalFailures,
    "BLOCKED",
    "STOPPED",
  ],
  BLOCKED: ["STOPPED"],
  STOPPED: ["CAMERA_REQUESTED", "IDLE"],
};

export function assertCaptureTransition(
  from: BarcodeCapturePhase,
  to: BarcodeCapturePhase,
): void {
  if (from === to) return;

  if (!TRANSITIONS[from].includes(to)) {
    throw new BarcodeCaptureError(
      "INVALID_STATE_TRANSITION",
      `Invalid capture state transition: ${from} -> ${to}`,
      false,
    );
  }
}

export function isCaptureTransitionAllowed(
  from: BarcodeCapturePhase,
  to: BarcodeCapturePhase,
): boolean {
  return from === to || TRANSITIONS[from].includes(to);
}
