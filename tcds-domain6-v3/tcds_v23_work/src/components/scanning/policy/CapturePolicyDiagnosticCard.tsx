import type {
  ResolvedWarehouseCapturePolicy,
} from "../../../lib/scanning/policy/CapturePolicyResolution";

export interface CapturePolicyDiagnosticCardProps {
  readonly result:
    ResolvedWarehouseCapturePolicy;
}

export function CapturePolicyDiagnosticCard({
  result,
}: CapturePolicyDiagnosticCardProps) {
  return (
    <section className="space-y-3 rounded-xl border border-slate-700 bg-slate-900 p-4 text-slate-100">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-sky-300">
          Validated capture policy
        </p>
        <h2 className="mt-1 text-lg font-semibold">
          {result.contextId}
        </h2>
      </div>

      <dl className="grid gap-2 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-slate-400">
            Symbologies
          </dt>
          <dd>
            {result.executionPolicy.symbologies.join(
              " · ",
            )}
          </dd>
        </div>

        <div>
          <dt className="text-slate-400">
            Selection
          </dt>
          <dd>
            {result.executionPolicy.selection}
          </dd>
        </div>

        <div>
          <dt className="text-slate-400">
            Duplicate interval
          </dt>
          <dd>
            {result.executionPolicy.duplicateFilterSeconds}s
          </dd>
        </div>

        <div>
          <dt className="text-slate-400">
            Capture timeout
          </dt>
          <dd>
            {result.captureTimeoutMs} ms
          </dd>
        </div>
      </dl>

      <p className="text-xs text-slate-400">
        This card displays scanner policy only. It does not start the camera, resolve a barcode, validate warehouse state, or write telemetry.
      </p>
    </section>
  );
}
