import {
  ScannerControls,
} from "./ScannerControls";
import {
  ScannerPermissionGate,
} from "./ScannerPermissionGate";
import {
  ScannerRuntimeDiagnostics,
} from "./ScannerRuntimeDiagnostics";
import {
  ScannerStatus,
} from "./ScannerStatus";
import {
  ScannerViewport,
} from "./ScannerViewport";
import {
  useBarcodeScanner,
} from "../../hooks/useBarcodeScanner";

// Lifecycle failures are already reported through the capture status surface, so
// the rejection is absorbed here. Nothing raw reaches an unhandled rejection.
function absorb(
  operation: Promise<void>,
): void {
  void operation.catch(
    () => undefined,
  );
}

export function BarcodeScanner() {
  const scanner =
    useBarcodeScanner();

  const start = () => {
    absorb(
      scanner.start({
        preferredCamera:
          "WORLD_FACING",
        captureTimeoutMs: 60_000,
      }),
    );
  };

  const resume = () => {
    scanner.clearObservation();
    absorb(scanner.resume());
  };

  return (
    <div className="space-y-4">
      <ScannerPermissionGate
        permission={
          scanner.status.permission
        }
      />

      <ScannerViewport
        viewportRef={
          scanner.viewportRef
        }
        phase={scanner.status.phase}
      />

      <ScannerStatus
        status={scanner.status}
      />

      {scanner.observation ? (
        <section className="rounded-xl border border-sky-500/30 bg-sky-500/10 p-4 text-sky-50">
          <p className="text-xs font-semibold uppercase tracking-wider text-sky-200">
            Scan detected — not warehouse validated
          </p>

          <dl className="mt-3 grid gap-3 sm:grid-cols-2">
            <div>
              <dt className="text-xs text-sky-200">
                Value
              </dt>
              <dd className="break-all font-mono text-sm">
                {scanner.observation.rawValue}
              </dd>
            </div>

            <div>
              <dt className="text-xs text-sky-200">
                Symbology
              </dt>
              <dd className="text-sm font-semibold">
                {scanner.observation.symbology}
              </dd>
            </div>
          </dl>

          <p className="mt-3 text-xs text-sky-200">
            Capture is paused. This observation has not been sent to Receiving, Picking, Packing, Returns, Inventory, or PostgreSQL.
          </p>
        </section>
      ) : null}

      <ScannerControls
        status={scanner.status}
        onStart={start}
        onResume={resume}
        onStop={() => {
          absorb(scanner.stop());
        }}
        onTorch={(enabled) => {
          absorb(
            scanner.setTorch(enabled),
          );
        }}
      />

      <ScannerRuntimeDiagnostics
        capture={scanner.status}
        runtime={
          scanner.runtimeStatus
        }
        metadata={
          scanner.providerMetadata
        }
      />

      <p className="text-xs text-slate-400">
        Certification symbologies: Code 128, EAN-13/UPC-A, QR.
        {scanner.status.zoomAvailable
          ? " Camera zoom gestures are available on this device."
          : ""}
      </p>
    </div>
  );
}
