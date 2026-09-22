import type {
  CameraPermissionState,
} from "../../lib/scanning/capture/BarcodeCaptureStatus";

export function ScannerPermissionGate({
  permission,
}: {
  permission: CameraPermissionState;
}) {
  if (
    permission === "NOT_REQUESTED" ||
    permission === "GRANTED"
  ) {
    return null;
  }

  const messages: Record<
    Exclude<
      CameraPermissionState,
      "NOT_REQUESTED" | "GRANTED"
    >,
    string
  > = {
    REQUESTING:
      "Waiting for browser camera permission.",
    DENIED:
      "Camera permission is denied. Update Safari/Chrome site permissions before trying again.",
    UNAVAILABLE:
      "No compatible camera is available on this device.",
    ERROR:
      "The browser could not establish camera access.",
  };

  return (
    <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
      {messages[permission]}
    </div>
  );
}
