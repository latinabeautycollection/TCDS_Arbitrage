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

const TRANSITIONS: Readonly<
  Record<BarcodeCapturePhase, readonly BarcodeCapturePhase[]>
> = {
  IDLE: ["CAMERA_REQUESTED", "BLOCKED", "STOPPED"],
  CAMERA_REQUESTED: [
    "PERMISSION_PENDING",
    "CAMERA_STARTING",
    ...operationalFailures,
    "STOPPED",
  ],
  PERMISSION_PENDING: [
    "CAMERA_STARTING",
    ...operationalFailures,
    "STOPPED",
  ],
  CAMERA_STARTING: [
    "READY",
    "CAPTURING",
    ...operationalFailures,
    "STOPPED",
  ],
  READY: [
    "CAPTURING",
    "PAUSED",
    "RECOVERING",
    ...operationalFailures,
    "STOPPED",
  ],
  CAPTURING: [
    "DECODED",
    "PAUSED",
    "RECOVERING",
    ...operationalFailures,
    "STOPPED",
  ],
  DECODED: [
    "PAUSED",
    ...operationalFailures,
    "STOPPED",
  ],
  PAUSED: [
    "READY",
    "CAMERA_STARTING",
    "CAPTURING",
    "RECOVERING",
    ...operationalFailures,
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
