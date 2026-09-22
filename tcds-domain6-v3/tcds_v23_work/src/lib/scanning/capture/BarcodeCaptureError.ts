import {
  sanitizeProviderErrorCause,
  type ScannerProviderErrorCause,
} from "../contracts/ScannerProviderError";

export type BarcodeCaptureErrorCode =
  | "RUNTIME_NOT_READY"
  | "VIEWPORT_REQUIRED"
  | "START_IN_PROGRESS"
  | "CAMERA_PERMISSION_DENIED"
  | "CAMERA_UNAVAILABLE"
  | "CAMERA_NOT_READABLE"
  | "CAMERA_SECURITY_ERROR"
  | "CAMERA_START_FAILED"
  | "CAPTURE_INITIALIZATION_FAILED"
  | "CAPTURE_TIMEOUT"
  | "CAPTURE_PAUSE_FAILED"
  | "CAPTURE_RESUME_FAILED"
  | "CAPTURE_STOP_FAILED"
  | "CAPTURE_CLEANUP_FAILED"
  | "VIEW_ATTACH_FAILED"
  | "VIEW_DETACH_FAILED"
  | "TORCH_UNAVAILABLE"
  | "TORCH_CONTROL_FAILED"
  | "UNSUPPORTED_SYMBOLOGY"
  | "INVALID_STATE_TRANSITION"
  | "UNKNOWN_CAPTURE_ERROR";

export interface CaptureCleanupFailure {
  step:
    | "DISABLE_CAPTURE"
    | "STOP_CAMERA"
    | "REMOVE_CAPTURE_LISTENER"
    | "DETACH_VIEW"
    | "CLEAR_FRAME_SOURCE"
    | "REMOVE_MODE"
    | "REMOVE_CAMERA_LISTENER";
  message: string;
}

export class BarcodeCaptureError extends Error {
  /**
   * Redacted summary only, produced by the 6.2A provider-error sanitizer. The
   * raw SDK or DOM exception is never retained, so provider internals, license
   * data and SDK stack traces cannot cross the capture boundary. The TCDS code,
   * message, retryability and cleanup steps carry the diagnostic meaning.
   */
  declare readonly cause?: ScannerProviderErrorCause;

  constructor(
    public readonly code: BarcodeCaptureErrorCode,
    message: string,
    public readonly retryable: boolean,
    cause?: unknown,
    public readonly cleanupFailures?: readonly CaptureCleanupFailure[],
  ) {
    super(message);
    this.name = "BarcodeCaptureError";

    Object.defineProperty(
      this,
      "cause",
      {
        value:
          sanitizeProviderErrorCause(
            cause,
          ),
        enumerable: true,
        writable: false,
        configurable: false,
      },
    );
  }
}
