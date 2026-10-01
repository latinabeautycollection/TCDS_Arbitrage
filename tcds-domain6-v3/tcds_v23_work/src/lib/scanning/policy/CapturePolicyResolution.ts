import type {
  BarcodeCaptureExecutionPolicy,
} from "../capture/BarcodeCaptureCapability";
import type {
  WarehouseCaptureContextId,
} from "./WarehouseCaptureContext";

export type CapturePolicyWarningCode =
  | "CONFIGURED_SYMBOLOGY_NOT_SUPPORTED_BY_6_2B"
  | "CONFIGURED_SYMBOLOGY_DISABLED_IN_WAREHOUSE_CONTROL"
  | "AUTOMATIC_CAPTURE_RESTRICTED_BY_CONTEXT"
  | "SOUND_RESTRICTED_BY_ENVELOPE"
  | "VIBRATION_RESTRICTED_BY_ENVELOPE";

export interface CapturePolicyWarning {
  readonly code:
    CapturePolicyWarningCode;
  readonly detail: string;
}

export interface ResolvedWarehouseCapturePolicy {
  readonly contextId:
    WarehouseCaptureContextId;

  readonly executionPolicy:
    BarcodeCaptureExecutionPolicy;

  readonly captureTimeoutMs:
    number;

  readonly preferredCamera:
    "WORLD_FACING";

  /**
   * Evidence about the authoritative configuration that was reconciled.
   * This metadata is not passed to Scandit as device identity.
   */
  readonly authorityEvidence:
    Readonly<{
      scannerAssetId: string;
      scannerProfileUpdatedAt: string;
    }>;

  readonly warnings:
    readonly CapturePolicyWarning[];
}
