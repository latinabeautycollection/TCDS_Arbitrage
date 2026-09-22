import {
  DOMAIN6_2B_CERTIFICATION_POLICY,
} from "../../lib/scanning/capture/BarcodeCaptureCapability";
import type {
  BarcodeCaptureStatus,
} from "../../lib/scanning/capture/BarcodeCaptureStatus";
import type {
  ScannerProviderMetadata,
} from "../../lib/scanning/contracts/ScannerProviderMetadata";
import type {
  ScannerRuntimeStatus,
} from "../../lib/scanning/contracts/ScannerRuntimeStatus";

const NOT_AVAILABLE = "—";

function value(
  text: string | undefined,
): string {
  const trimmed = text?.trim();
  return trimmed
    ? trimmed
    : NOT_AVAILABLE;
}

function Row({
  label,
  detail,
}: {
  label: string;
  detail: string;
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-800 py-1.5 last:border-b-0">
      <dt className="text-xs uppercase tracking-wide text-slate-400">
        {label}
      </dt>
      <dd className="text-right font-mono text-xs text-slate-100">
        {detail}
      </dd>
    </div>
  );
}

/**
 * Read-only certification surface. It reports states and TCDS status codes only.
 * The license key, raw SDK errors, stack traces, configuration values and raw
 * SDK objects are never rendered here.
 */
export function ScannerRuntimeDiagnostics({
  capture,
  runtime,
  metadata,
}: {
  capture: BarcodeCaptureStatus;
  runtime?: ScannerRuntimeStatus;
  metadata?: ScannerProviderMetadata | null;
}) {
  const runtimeState = runtime
    ? `${runtime.phase}${
        runtime.blocked
          ? " (blocked)"
          : runtime.degraded
            ? " (degraded)"
            : runtime.ready
              ? " (ready)"
              : ""
      }`
    : NOT_AVAILABLE;

  const providerStatus = runtime
    ? `${
        runtime.providerStatusCode ??
        NOT_AVAILABLE
      } / ${value(
        runtime.providerStatusCategory,
      )}`
    : NOT_AVAILABLE;

  const profile =
    DOMAIN6_2B_CERTIFICATION_POLICY
      .lineage?.policySource;

  return (
    <section
      className="rounded-xl border border-slate-700 bg-slate-900/70 px-4 py-3"
      aria-label="Scanner diagnostic status"
      data-testid="scanner-runtime-diagnostics"
    >
      <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-300">
        Diagnostic status
      </h2>

      <dl className="mt-2">
        <Row
          label="Runtime state"
          detail={runtimeState}
        />
        <Row
          label="Runtime blocking reason"
          detail={value(
            runtime?.blockingReason,
          )}
        />
        <Row
          label="Runtime status code / category"
          detail={providerStatus}
        />
        <Row
          label="Runtime message"
          detail={value(
            runtime?.message,
          )}
        />
        <Row
          label="Camera state"
          detail={`${
            capture.permission
          } / ${
            capture.cameraOn
              ? "ON"
              : "OFF"
          }${
            capture.backgroundSuspended
              ? " / BACKGROUND"
              : ""
          }`}
        />
        <Row
          label="Capture state"
          detail={`${capture.phase} / ${
            capture.captureEnabled
              ? "ENABLED"
              : "DISABLED"
          }`}
        />
        <Row
          label="Capture status code"
          detail={value(
            capture.lastErrorCode,
          )}
        />
        <Row
          label="Capture message"
          detail={value(
            capture.message,
          )}
        />
        <Row
          label="SDK version"
          detail={value(
            metadata?.providerVersion,
          )}
        />
        <Row
          label="Runtime asset version"
          detail={value(
            metadata?.runtimeAssetVersion,
          )}
        />
        <Row
          label="Implementation version"
          detail={value(
            metadata?.implementationVersion,
          )}
        />
        <Row
          label="Active capture profile"
          detail={value(profile)}
        />
      </dl>

      <p className="mt-2 text-[11px] text-slate-500">
        Status codes only. No license key, raw SDK error, stack trace or
        configuration value is shown on this surface.
      </p>
    </section>
  );
}
