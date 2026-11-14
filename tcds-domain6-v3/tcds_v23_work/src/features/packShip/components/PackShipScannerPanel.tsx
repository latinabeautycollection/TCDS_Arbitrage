import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ScannerPermissionGate } from "../../../components/scanning/ScannerPermissionGate";
import { ScannerStatus } from "../../../components/scanning/ScannerStatus";
import { useWarehouseWorkflowScanner } from "../../../hooks/useWarehouseWorkflowScanner";
import type { CapturePolicyAuthority } from "../../../lib/scanning/workflow/policy/CapturePolicyAuthority";
import {
  createPackShipCoordinator,
  packShipCameraScanEnabled,
} from "../../../lib/scanning/workflow/bindings/packShipWorkflow";
import type { WorkflowScanDecision } from "../../../lib/scanning/workflow/contracts/WorkflowScanDecision";
import type { WarehouseSymbology } from "../../../lib/scanning/capture/WarehouseSymbology";
import { PackShipApiError } from "../services/packShipApi";
import type { PackShipTask } from "../types/packShipTypes";
import {
  derivePackShipScanPlan,
  packShipLabelPairScopeKey,
  type PackShipScanPlan,
  type PendingTrackingProof,
} from "../scanning/packShipScanPlan";

export interface PackShipScannerPanelProps {
  task: PackShipTask;
  capturePolicyAuthority?: CapturePolicyAuthority;
  disabled?: boolean;
  onTaskUpdate: (task: PackShipTask) => void;
  onRefresh: () => Promise<void>;
  onError: (error: unknown) => void;
  onReconciliationChange?: (active: boolean) => void;
}

function isPackShipTask(value: unknown): value is PackShipTask {
  return Boolean(
    value &&
      typeof value === "object" &&
      "taskId" in value &&
      "rowVersion" in value &&
      "carrierLabel" in value &&
      "lastUpdatedAt" in value,
  );
}

function trackingProofFrom(decision: WorkflowScanDecision): Omit<PendingTrackingProof, "scopeKey"> | null {
  const result = decision.result;
  if (!result || typeof result !== "object") return null;
  const value = result as Record<string, unknown>;
  const barcode = value.trackingBarcode;
  const labelPairId = value.labelPairId;
  const observationId = value.observationId;
  const capturedAt = value.capturedAt;
  const provider = value.provider;
  const symbology = value.symbology;
  const trackingClientOperationId = value.trackingClientOperationId;
  const trackingCorrelationId = value.trackingCorrelationId;

  if (
    typeof barcode !== "string" || !barcode.trim() ||
    typeof labelPairId !== "string" || !labelPairId ||
    typeof observationId !== "string" || !observationId ||
    typeof capturedAt !== "string" || !capturedAt ||
    typeof provider !== "string" || !provider ||
    typeof symbology !== "string" || !symbology ||
    typeof trackingClientOperationId !== "string" || !trackingClientOperationId ||
    typeof trackingCorrelationId !== "string" || !trackingCorrelationId
  ) return null;

  return {
    barcode,
    labelPairId,
    observationId,
    capturedAt,
    provider,
    symbology: symbology as WarehouseSymbology,
    trackingClientOperationId,
    trackingCorrelationId,
  };
}

function errorForDecision(decision: WorkflowScanDecision): PackShipApiError {
  return new PackShipApiError(
    decision.nextAction === "REAUTHENTICATE" ? "SESSION_EXPIRED" : decision.reasonCode,
  );
}

export function PackShipScannerPanel(props: PackShipScannerPanelProps) {
  const [pendingTracking, setPendingTracking] = useState<PendingTrackingProof | null>(null);
  const scopeKey = packShipLabelPairScopeKey(props.task);

  // A tracking half can never cross task/shipment/label/package identity boundaries.
  useEffect(() => {
    setPendingTracking((current) =>
      current && current.scopeKey === scopeKey ? current : null,
    );
  }, [scopeKey]);

  useEffect(() => {
    if (props.task.carrierLabel.status === "SCAN_VERIFIED") setPendingTracking(null);
  }, [props.task.carrierLabel.status]);

  const plan = useMemo(
    () => derivePackShipScanPlan(props.task, pendingTracking),
    [props.task, pendingTracking],
  );

  useEffect(
    () => () => props.onReconciliationChange?.(false),
    [props.onReconciliationChange],
  );

  if (!packShipCameraScanEnabled()) {
    return (
      <CameraUnavailable
        title="Camera scanning is not enabled for this release"
        detail="Manual/HID Pack & Ship entry remains available and uses the same authoritative backend writers."
      />
    );
  }

  if (!props.capturePolicyAuthority) {
    return (
      <CameraUnavailable
        title="Scanner policy authority is not connected"
        detail="Camera scanning fails closed until the approved Warehouse Control snapshot source is injected. Manual/HID fallback remains available."
      />
    );
  }

  if (!plan) {
    return (
      <CameraUnavailable
        title="No camera action is currently authorized"
        detail="The next Pack & Ship step is controlled by the refreshed server task state. Complete the required non-scan stage or refresh the task."
      />
    );
  }

  return (
    <ActivePackShipScannerPanel
      key={plan.sessionKey}
      {...props}
      capturePolicyAuthority={props.capturePolicyAuthority}
      plan={plan}
      pendingTracking={pendingTracking}
      setPendingTracking={setPendingTracking}
    />
  );
}

interface ActiveProps extends PackShipScannerPanelProps {
  capturePolicyAuthority: CapturePolicyAuthority;
  plan: PackShipScanPlan;
  pendingTracking: PendingTrackingProof | null;
  setPendingTracking: (value: PendingTrackingProof | null) => void;
}

function ActivePackShipScannerPanel({
  task,
  capturePolicyAuthority,
  plan,
  pendingTracking,
  setPendingTracking,
  disabled,
  onTaskUpdate,
  onRefresh,
  onError,
  onReconciliationChange,
}: ActiveProps) {
  const createCoordinator = useCallback(
    (scanner: Parameters<typeof createPackShipCoordinator>[0]) =>
      createPackShipCoordinator(scanner, capturePolicyAuthority),
    [capturePolicyAuthority],
  );

  const scanner = useWarehouseWorkflowScanner({
    createCoordinator,
    context: plan.context,
  });

  const processedDecision = useRef<WorkflowScanDecision | null>(null);

  useEffect(() => {
    onReconciliationChange?.(scanner.retryAvailable);
  }, [onReconciliationChange, scanner.retryAvailable]);

  useEffect(() => {
    if (!disabled) return;
    void scanner.stop().catch(() => undefined);
  }, [disabled, scanner.stop]);

  // Explicit cleanup complements useBarcodeScanner ownership cleanup and makes profile
  // transitions testable: a keyed Pack/Ship context transition must release the old camera.
  useEffect(() => () => {
    void scanner.stop().catch(() => undefined);
    onReconciliationChange?.(false);
  }, [onReconciliationChange, scanner.stop]);

  useEffect(() => {
    const decision = scanner.decision;
    if (!decision || processedDecision.current === decision) return;
    processedDecision.current = decision;

    if (decision.outcome === "ACCEPTED" && decision.reasonCode === "TRACKING_SCAN_CAPTURED") {
      const tracking = trackingProofFrom(decision);
      if (!tracking) {
        onError(new PackShipApiError("TRACKING_SCAN_RESULT_MISSING"));
        return;
      }
      setPendingTracking({
        ...tracking,
        scopeKey: packShipLabelPairScopeKey(task),
      });
      scanner.clearObservation();
      return;
    }

    if (decision.outcome === "ACCEPTED" && isPackShipTask(decision.result)) {
      if (decision.result.taskId !== task.taskId) {
        void scanner.stop().catch(() => undefined);
        onError(new PackShipApiError("CROSS_TASK_RESPONSE_BLOCKED"));
        return;
      }
      onTaskUpdate(decision.result);
      if (plan.step === "PACK_PACKAGE") setPendingTracking(null);
      scanner.clearObservation();
      return;
    }

    if (decision.outcome === "RECONCILING") {
      return;
    }

    if (decision.nextAction === "REFRESH_WORKFLOW") {
      void onRefresh().catch(onError);
    }

    if (decision.nextAction === "STOP_SCANNER" || decision.nextAction === "REAUTHENTICATE") {
      void scanner.stop().catch(() => undefined);
    }

    // A conclusive label-pair failure requires both physical identities to be captured
    // again. RECONCILING intentionally retains the tracking half for same-operation retry.
    if (plan.step === "PACK_PACKAGE") {
      setPendingTracking(null);
    }

    onError(errorForDecision(decision));
  }, [
    onError,
    onRefresh,
    onTaskUpdate,
    plan.step,
    scanner,
    setPendingTracking,
    task,
  ]);

  const begin = async () => {
    try {
      await scanner.stop().catch(() => undefined);
      scanner.clearObservation();
      await scanner.begin();
    } catch (error) {
      onError(error);
    }
  };

  const retry = async () => {
    try {
      await scanner.retry();
    } catch (error) {
      onError(error);
    }
  };

  return (
    <section className="rounded-2xl border border-tcds-line bg-white p-4" aria-label="Pack and Ship camera scanner">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[.16em] text-tcds-gold">Scandit Camera</p>
          <h3 className="font-display text-lg font-black text-tcds-ink">{plan.label}</h3>
          <p className="mt-1 text-xs text-tcds-muted">{plan.step}</p>
        </div>
        {pendingTracking ? (
          <span className="rounded-full bg-tcds-surface px-3 py-1 text-[10px] font-black uppercase tracking-[.12em]">
            Tracking captured
          </span>
        ) : null}
      </div>

      <div className="mt-3 space-y-3">
        <ScannerPermissionGate permission={scanner.status.permission} />
        <PolicyNeutralViewport viewportRef={scanner.viewportRef} phase={scanner.status.phase} />
        <ScannerStatus status={scanner.status} />
      </div>

      {scanner.decision ? (
        <div className="mt-3 rounded-xl bg-tcds-surface p-3 text-xs" aria-live="polite">
          <p className="font-black">{scanner.decision.outcome}</p>
          <p className="mt-1 text-tcds-muted">{scanner.decision.reasonCode}</p>
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-2">
        {scanner.retryAvailable ? (
          <button
            type="button"
            disabled={disabled}
            onClick={() => void retry()}
            className="min-h-12 rounded-xl bg-tcds-black px-4 text-sm font-black text-white disabled:opacity-50"
          >
            Reconcile Same Scan
          </button>
        ) : (
          <button
            type="button"
            disabled={disabled}
            onClick={() => void begin()}
            className="min-h-12 rounded-xl bg-tcds-black px-4 text-sm font-black text-white disabled:opacity-50"
          >
            Start / Continue Camera Scan
          </button>
        )}

        {scanner.status.phase !== "IDLE" && scanner.status.phase !== "STOPPED" ? (
          <button
            type="button"
            onClick={() => void scanner.stop().catch(() => undefined)}
            className="min-h-12 rounded-xl border border-tcds-line bg-white px-4 text-sm font-black"
          >
            Stop Camera
          </button>
        ) : null}
      </div>

      <p className="mt-3 text-xs text-tcds-muted">
        Camera capture does not decide warehouse truth. The scan is accepted only after the authoritative Pack/Ship backend writer returns the refreshed task state.
      </p>
    </section>
  );
}

function PolicyNeutralViewport({
  viewportRef,
  phase,
}: {
  viewportRef: (node: HTMLDivElement | null) => void;
  phase: string;
}) {
  return (
    <div
      className="relative min-h-[22rem] overflow-hidden rounded-2xl border border-slate-700 bg-black shadow-inner"
      aria-label="Barcode scanner camera viewport"
    >
      <div ref={viewportRef} className="absolute inset-0" />
      <div className="pointer-events-none absolute left-3 top-3 rounded-full bg-black/70 px-3 py-1 text-xs font-medium text-white">
        {phase}
      </div>
      <div className="pointer-events-none absolute bottom-3 left-3 right-3 rounded-xl bg-black/70 px-3 py-2 text-xs text-white/90">
        Scan-area guidance follows the governed Warehouse Control / 6.2C capture profile.
      </div>
    </div>
  );
}

function CameraUnavailable({ title, detail }: { title: string; detail: string }) {
  return (
    <section className="rounded-2xl border border-tcds-line bg-tcds-surface p-4">
      <p className="text-xs font-black uppercase tracking-[.14em] text-tcds-muted">Scandit Camera</p>
      <p className="mt-1 font-black text-tcds-ink">{title}</p>
      <p className="mt-1 text-xs text-tcds-muted">{detail}</p>
    </section>
  );
}
