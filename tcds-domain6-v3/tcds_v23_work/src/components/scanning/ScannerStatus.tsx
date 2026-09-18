import type {
  BarcodeCaptureStatus,
} from "../../lib/scanning/capture/BarcodeCaptureStatus";

export function ScannerStatus({
  status,
}: {
  status: BarcodeCaptureStatus;
}) {
  const tone =
    status.phase === "CAPTURING" ||
    status.phase === "READY"
      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-100"
      : status.phase.includes("ERROR") ||
          status.phase === "BLOCKED" ||
          status.phase === "PERMISSION_DENIED"
        ? "border-rose-500/30 bg-rose-500/10 text-rose-100"
        : "border-slate-700 bg-slate-800/70 text-slate-200";

  return (
    <section
      className={`rounded-xl border px-4 py-3 ${tone}`}
      aria-live="polite"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold">
            Scanner {status.phase}
          </p>
          <p className="mt-1 text-xs opacity-80">
            Camera permission: {status.permission}
          </p>
        </div>

        <div className="text-right text-xs opacity-80">
          <p>
            Camera: {status.cameraOn ? "On" : "Off"}
          </p>
          <p>
            Capture:{" "}
            {status.captureEnabled
              ? "Enabled"
              : "Paused"}
          </p>
        </div>
      </div>

      {status.message ? (
        <p className="mt-2 text-xs">
          {status.message}
        </p>
      ) : null}
    </section>
  );
}
