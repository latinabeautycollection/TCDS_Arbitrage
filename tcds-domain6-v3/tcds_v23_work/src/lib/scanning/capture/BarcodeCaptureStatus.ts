export type BarcodeCapturePhase =
  | "IDLE"
  | "CAMERA_REQUESTED"
  | "PERMISSION_PENDING"
  | "CAMERA_STARTING"
  | "READY"
  | "CAPTURING"
  | "DECODED"
  | "PAUSED"
  | "PERMISSION_DENIED"
  | "CAMERA_UNAVAILABLE"
  | "CAMERA_ERROR"
  | "CAPTURE_ERROR"
  | "RECOVERING"
  | "BLOCKED"
  | "STOPPED";

export type CameraPermissionState =
  | "NOT_REQUESTED"
  | "REQUESTING"
  | "GRANTED"
  | "DENIED"
  | "UNAVAILABLE"
  | "ERROR";

export interface BarcodeCaptureStatus {
  phase: BarcodeCapturePhase;
  provider: string;
  permission: CameraPermissionState;
  cameraOn: boolean;
  captureEnabled: boolean;
  viewAttached: boolean;
  torchAvailable: boolean;
  torchOn: boolean;
  zoomAvailable: boolean;
  backgroundSuspended: boolean;
  startedAt?: string;
  lastDecodedAt?: string;
  lastErrorCode?: string;
  message?: string;
  lastChangedAt: string;
}

export type BarcodeCaptureStatusListener = (
  status: BarcodeCaptureStatus,
) => void;
