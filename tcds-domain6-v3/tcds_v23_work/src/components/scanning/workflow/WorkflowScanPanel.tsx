import { useEffect, useRef, useState } from "react";
import { ScannerPermissionGate } from "../ScannerPermissionGate";
import { ScannerViewport } from "../ScannerViewport";
import { useWarehouseWorkflowScanner } from "../../../hooks/useWarehouseWorkflowScanner";
import type { WorkflowScanDecision } from "../../../lib/scanning/workflow/contracts/WorkflowScanDecision";
import type {
  ScannerControl,
  WorkflowScanCoordinator,
  WorkflowScanCoordinatorContext,
} from "../../../lib/scanning/workflow/coordinator/WorkflowScanCoordinator";

export interface WorkflowScanPanelProps {
  createCoordinator: (scanner: ScannerControl) => WorkflowScanCoordinator;
  context: WorkflowScanCoordinatorContext;
  /** Receives each accepted decision once. The screen keeps all business handling. */
  onAccepted: (decision: WorkflowScanDecision) => void;
}

const MESSAGES: Record<string, string> = {
  RECONCILIATION_REQUIRED: "The connection dropped before the result came back. Tap Retry.",
  PENDING_SCAN_UNRESOLVED: "Finish the previous scan first. Tap Retry.",
  OFFLINE_VALIDATION_UNAVAILABLE: "You are offline. Camera scanning is unavailable.",
  SESSION_EXPIRED: "Your session expired. Sign in again.",
  INVALID_CAPTURE_INTENT: "That barcode type is not accepted here.",
  INTERIM_POLICY_NOT_PERMITTED: "Camera scanning is not enabled for this workflow.",
  CAPTURE_POLICY_CONTEXT_UNMAPPED: "Camera scanning is not configured for this step.",
};

function messageFor(decision: WorkflowScanDecision | null): string | null {
  if (!decision || decision.outcome === "ACCEPTED") return null;
  return MESSAGES[decision.reasonCode] ?? decision.reasonCode.replaceAll("_", " ").toLowerCase();
}

/**
 * Camera scan entry for a workflow screen. It replaces barcode entry only: the accepted
 * decision is handed to the screen, which keeps every business decision it made before.
 */
export function WorkflowScanPanel({ createCoordinator, context, onAccepted }: WorkflowScanPanelProps) {
  const scanner = useWarehouseWorkflowScanner({ createCoordinator, context });
  const [active, setActive] = useState(false);

  // Latest callbacks, read inside effects that should re-run only on their own triggers.
  const latest = useRef({ onAccepted, begin: scanner.begin, stop: scanner.stop });
  latest.current = { onAccepted, begin: scanner.begin, stop: scanner.stop };

  // The viewport must be on the page before the camera starts, so begin after it mounts.
  useEffect(() => {
    if (active) void latest.current.begin();
  }, [active]);

  // Runs once per decision: every scan produces a new decision object.
  useEffect(() => {
    const decision = scanner.decision;
    if (!decision || decision.outcome !== "ACCEPTED") return;
    latest.current.onAccepted(decision);
    void latest.current.stop();
    setActive(false);
  }, [scanner.decision]);

  const stopCamera = async () => {
    await scanner.stop();
    setActive(false);
  };

  const message = messageFor(scanner.decision);

  return (
    <div className="mt-3 space-y-3">
      {active ? (
        <button type="button" onClick={() => void stopCamera()} className="min-h-12 w-full rounded-2xl border border-tcds-line bg-white px-4 font-black">
          Stop camera
        </button>
      ) : (
        <button type="button" onClick={() => setActive(true)} className="min-h-12 w-full rounded-2xl bg-tcds-black px-4 font-black text-white">
          Scan with camera
        </button>
      )}

      {active && (
        <>
          <ScannerPermissionGate permission={scanner.status.permission} />
          <ScannerViewport viewportRef={scanner.viewportRef} phase={scanner.status.phase} />
        </>
      )}

      {scanner.captureState === "RECONCILING" && (
        <button type="button" onClick={() => void scanner.retry()} className="min-h-12 w-full rounded-2xl border border-tcds-gold bg-tcds-gold/10 px-4 font-black">
          Retry
        </button>
      )}

      {message && <p role="status" className="rounded-xl bg-tcds-surface p-3 text-sm font-bold">{message}</p>}
    </div>
  );
}
