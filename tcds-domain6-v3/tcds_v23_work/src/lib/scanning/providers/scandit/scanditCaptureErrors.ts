import {
  BarcodeCaptureError,
} from "../../capture/BarcodeCaptureError";

function errorName(error: unknown): string {
  if (error instanceof DOMException) return error.name;
  if (
    error &&
    typeof error === "object" &&
    "name" in error &&
    typeof (error as { name?: unknown }).name === "string"
  ) {
    return (error as { name: string }).name;
  }
  return "";
}

export function mapScanditCaptureError(
  error: unknown,
): BarcodeCaptureError {
  if (error instanceof BarcodeCaptureError) return error;

  const name = errorName(error);
  const message =
    error instanceof Error ? error.message : String(error ?? "");

  switch (name) {
    case "NotAllowedError":
      return new BarcodeCaptureError(
        "CAMERA_PERMISSION_DENIED",
        "Camera permission was denied.",
        false,
        error,
      );
    case "NotFoundError":
      return new BarcodeCaptureError(
        "CAMERA_UNAVAILABLE",
        "No compatible camera is available.",
        true,
        error,
      );
    case "NotReadableError":
    case "AbortError":
      return new BarcodeCaptureError(
        "CAMERA_NOT_READABLE",
        "The camera could not be opened or became unavailable.",
        true,
        error,
      );
    case "SecurityError":
      return new BarcodeCaptureError(
        "CAMERA_SECURITY_ERROR",
        "Browser security policy blocked camera access.",
        false,
        error,
      );
    default:
      break;
  }

  const normalized = message.toLowerCase();

  if (
    normalized.includes("camera") &&
    normalized.includes("permission")
  ) {
    return new BarcodeCaptureError(
      "CAMERA_PERMISSION_DENIED",
      "Camera permission was denied.",
      false,
      error,
    );
  }

  return new BarcodeCaptureError(
    "UNKNOWN_CAPTURE_ERROR",
    "Scanner capture operation failed.",
    true,
    error,
  );
}
