import type {
  BarcodeCaptureFeedbackPolicy,
  BarcodeScanAreaPolicy,
  BarcodeSelectionPolicy,
} from "../capture/BarcodeCaptureCapability";
import type {
  WarehouseSymbology,
} from "../capture/WarehouseSymbology";
import type {
  WarehouseCaptureContextId,
} from "./WarehouseCaptureContext";

export interface CapturePolicyEnvelope {
  readonly contextId:
    WarehouseCaptureContextId;

  /**
   * This allowlist is a safety ceiling only.
   * It is not the production configuration authority.
   */
  readonly allowedSymbologies:
    readonly WarehouseSymbology[];

  readonly defaultSelection:
    BarcodeSelectionPolicy;

  readonly allowAutomaticSelection:
    boolean;

  readonly scanAreaBounds: Readonly<{
    minWidthFraction: number;
    maxWidthFraction: number;
    minHeightFraction: number;
    maxHeightFraction: number;
    defaultArea:
      BarcodeScanAreaPolicy;
  }>;

  readonly feedbackCeiling: Readonly<{
    soundAllowed: boolean;
    vibrationAllowed: boolean;
  }>;

  readonly captureTimeoutBounds: Readonly<{
    minimumMs: number;
    maximumMs: number;
    defaultMs: number;
  }>;

  readonly preferredCamera:
    "WORLD_FACING";

  /**
   * Capture-only operator guidance. Must never assert a warehouse result.
   */
  readonly operatorHint: string;
}
