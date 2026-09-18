import type {
  BarcodeCaptureStatus,
} from "../../lib/scanning/capture/BarcodeCaptureStatus";

export interface ScannerControlsProps {
  status: BarcodeCaptureStatus;
  onStart: () => void;
  onResume: () => void;
  onStop: () => void;
  onTorch: (enabled: boolean) => void;
}

export function ScannerControls({
  status,
  onStart,
  onResume,
  onStop,
  onTorch,
}: ScannerControlsProps) {
  const canStart =
    status.phase === "IDLE" ||
    status.phase === "STOPPED" ||
    status.phase ===
      "PERMISSION_DENIED" ||
    status.phase ===
      "CAMERA_UNAVAILABLE" ||
    status.phase === "CAMERA_ERROR" ||
    status.phase === "CAPTURE_ERROR";

  const canResume =
    status.phase === "PAUSED" ||
    status.phase === "READY";

  return (
    <div className="flex flex-wrap gap-2">
      {canStart ? (
        <button
          type="button"
          onClick={onStart}
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-300"
        >
          Start Scanner
        </button>
      ) : null}

      {canResume ? (
        <button
          type="button"
          onClick={onResume}
          className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-300"
        >
          Scan Again
        </button>
      ) : null}

      {status.torchAvailable ? (
        <button
          type="button"
          onClick={() =>
            onTorch(!status.torchOn)
          }
          className="rounded-lg border border-slate-600 bg-slate-800 px-4 py-2 text-sm font-semibold text-slate-100 transition hover:bg-slate-700"
        >
          Torch {status.torchOn ? "Off" : "On"}
        </button>
      ) : null}

      {status.phase !== "IDLE" &&
      status.phase !== "STOPPED" ? (
        <button
          type="button"
          onClick={onStop}
          className="rounded-lg border border-rose-500/50 bg-rose-500/10 px-4 py-2 text-sm font-semibold text-rose-100 transition hover:bg-rose-500/20"
        >
          Stop
        </button>
      ) : null}
    </div>
  );
}
