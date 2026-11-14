import type { PackShipTask } from "../types/packShipTypes";
import type { WorkflowScanCoordinatorContext } from "../../../lib/scanning/workflow/coordinator/WorkflowScanCoordinator";
import { DOMAIN6_2D_CERTIFIED_SYMBOLOGIES } from "../../../lib/scanning/workflow/contracts/WarehouseCaptureIntent";
import type { PhysicalTrackingEvidence } from "./packShipLabelEvidence";

export type PackShipCameraStep =
  | "PACK_SOURCE"
  | "PACK_ITEM"
  | "PACK_TRACKING_LABEL"
  | "PACK_PACKAGE"
  | "PACK_OUTBOUND_LOCATION";

export interface PendingTrackingProof extends PhysicalTrackingEvidence {
  readonly scopeKey: string;
}

export interface PackShipScanPlan {
  readonly step: PackShipCameraStep;
  readonly label: string;
  readonly sessionKey: string;
  readonly context: WorkflowScanCoordinatorContext;
}

const LABEL_READY_FOR_PHYSICAL_VERIFY = new Set([
  "PRINTED",
  "APPLIED",
] as const);

function allBlockingGatesPass(task: PackShipTask): boolean {
  return task.completionGates.every((gate) => !gate.blocking || gate.state === "PASS");
}

/**
 * Scopes the first half of the physical tracking->package proof to the current task,
 * shipment and printed label identity. A task/ship/print/package change invalidates the
 * transient tracking half instead of letting it leak into a different physical pair.
 */
export function packShipLabelPairScopeKey(task: PackShipTask): string {
  return JSON.stringify([
    task.taskId,
    task.shipmentId ?? null,
    task.carrierLabel.printJobId ?? null,
    task.carrierLabel.trackingNumber ?? null,
    task.packageBarcode ?? task.carrierLabel.packageBarcode ?? null,
  ]);
}

export function pendingTrackingForTask(
  task: PackShipTask,
  pending: PendingTrackingProof | null,
): string | null {
  if (!pending) return null;
  return pending.scopeKey === packShipLabelPairScopeKey(task) ? pending.barcode : null;
}

/**
 * Derives camera intent only from authoritative task state plus one scope-bound transient
 * tracking observation. It never advances warehouse state locally.
 */
export function derivePackShipScanPlan(
  task: PackShipTask,
  pendingTracking: PendingTrackingProof | null,
): PackShipScanPlan | null {
  const common = {
    workflowEntityId: task.taskId,
    captureSource: "SCANDIT_WEB" as const,
  };

  const trackingBarcode = pendingTrackingForTask(task, pendingTracking);
  const scopeKey = packShipLabelPairScopeKey(task);

  if (!task.sourceVerified) {
    return {
      step: "PACK_SOURCE",
      label: "Scan packing source",
      sessionKey: `${task.taskId}|PACK_SOURCE`,
      context: {
        ...common,
        workflow: "PACKING",
        workflowStep: "PACK_SOURCE",
        captureIntent: {
          intent: "SOURCE_ID",
          mode: "SINGLE",
          allowedSymbologies: DOMAIN6_2D_CERTIFIED_SYMBOLOGIES,
          allowManualFallback: true,
        },
        adapterContext: { rowVersion: task.rowVersion },
      },
    };
  }

  if (task.items.some((item) => !item.verified)) {
    return {
      step: "PACK_ITEM",
      label: "Scan exact TCDS item",
      sessionKey: `${task.taskId}|PACK_ITEM`,
      context: {
        ...common,
        workflow: "PACKING",
        workflowStep: "PACK_ITEM",
        captureIntent: {
          intent: "ITEM_ID",
          mode: "SINGLE",
          allowedSymbologies: DOMAIN6_2D_CERTIFIED_SYMBOLOGIES,
          allowManualFallback: true,
        },
        adapterContext: { rowVersion: task.rowVersion },
      },
    };
  }

  if (
    task.shipmentId &&
    LABEL_READY_FOR_PHYSICAL_VERIFY.has(
      task.carrierLabel.status as "PRINTED" | "APPLIED",
    )
  ) {
    if (!trackingBarcode) {
      return {
        step: "PACK_TRACKING_LABEL",
        label: "Scan carrier tracking label",
        sessionKey: `${scopeKey}|PACK_TRACKING_LABEL`,
        context: {
          ...common,
          workflow: "PACKING",
          workflowStep: "PACK_TRACKING_LABEL",
          captureIntent: {
            intent: "TRACKING_NUMBER",
            mode: "SINGLE",
            allowedSymbologies: DOMAIN6_2D_CERTIFIED_SYMBOLOGIES,
            allowManualFallback: true,
          },
          adapterContext: { shipmentId: task.shipmentId },
        },
      };
    }

    return {
      step: "PACK_PACKAGE",
      label: "Scan physical TCDS package",
      sessionKey: `${scopeKey}|PACK_PACKAGE`,
      context: {
        ...common,
        workflow: "PACKING",
        workflowStep: "PACK_PACKAGE",
        captureIntent: {
          intent: "PACKAGE_ID",
          mode: "SINGLE",
          allowedSymbologies: DOMAIN6_2D_CERTIFIED_SYMBOLOGIES,
          allowManualFallback: true,
        },
        adapterContext: {
          shipmentId: task.shipmentId,
          trackingBarcode,
          trackingEvidence: pendingTracking ?? undefined,
        },
      },
    };
  }

  if (
    task.shipmentId &&
    task.carrierLabel.status === "SCAN_VERIFIED" &&
    allBlockingGatesPass(task)
  ) {
    return {
      step: "PACK_OUTBOUND_LOCATION",
      label: "Scan outbound staging location",
      sessionKey: `${task.taskId}|${task.shipmentId}|PACK_OUTBOUND_LOCATION`,
      context: {
        ...common,
        workflow: "OUTBOUND",
        workflowStep: "PACK_OUTBOUND_LOCATION",
        captureIntent: {
          intent: "OUTBOUND_LOCATION",
          mode: "SINGLE",
          allowedSymbologies: DOMAIN6_2D_CERTIFIED_SYMBOLOGIES,
          allowManualFallback: true,
        },
        adapterContext: { shipmentId: task.shipmentId },
      },
    };
  }

  return null;
}
