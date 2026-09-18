import type {
  BarcodeDecodeListener,
} from "./BarcodeDecodeObservation";
import type {
  BarcodeCaptureStatus,
} from "./BarcodeCaptureStatus";
import type {
  WarehouseSymbology,
} from "./WarehouseSymbology";

export type BarcodeSelectionPolicy =
  | "AUTOMATIC"
  | "EXPLICIT_CONFIRMATION";

export interface BarcodeScanAreaPolicy {
  readonly widthFraction: number;
  readonly heightFraction: number;
}

export interface BarcodeCaptureFeedbackPolicy {
  readonly sound: boolean;
  readonly vibration: boolean;
}

export interface BarcodeCaptureExecutionPolicy {
  /**
   * Capture-level symbologies only. This list never resolves warehouse
   * entities or determines whether a scan is valid for a workflow.
   */
  readonly symbologies:
    readonly WarehouseSymbology[];

  /**
   * Scandit BarcodeCaptureSettings.codeDuplicateFilter is represented in
   * seconds by this 6.2B execution contract. Warehouse Control currently
   * stores duplicate_suppression_ms; 6.2C must convert the authoritative DB
   * value before passing the validated policy to 6.2B.
   *
   * Special Scandit values -2, -1 and 0 are also accepted.
   */
  readonly duplicateFilterSeconds:
    number;

  readonly selection:
    BarcodeSelectionPolicy;

  readonly scanArea:
    BarcodeScanAreaPolicy;

  readonly feedback:
    BarcodeCaptureFeedbackPolicy;

  /**
   * Lineage only. This is diagnostic/certification metadata and carries no
   * authority over the warehouse entity or workflow.
   */
  readonly lineage?: Readonly<{
    policySource:
      | "6.2B_CERTIFICATION_DEFAULT"
      | "6.2C_VALIDATED_POLICY";
    registryVersion?: string;
    profileId?: string;
    profileRevision?: number;
    warehouseConfigurationVersion?: number;
  }>;
}

export const DOMAIN6_2B_CERTIFICATION_POLICY:
  BarcodeCaptureExecutionPolicy =
  Object.freeze({
    symbologies: Object.freeze([
      "CODE128",
      "EAN13_UPCA",
      "QR",
    ]),
    duplicateFilterSeconds: -2,
    selection: "AUTOMATIC",
    scanArea: Object.freeze({
      widthFraction: 0.70,
      heightFraction: 0.35,
    }),
    feedback: Object.freeze({
      sound: false,
      vibration: false,
    }),
    lineage: Object.freeze({
      policySource:
        "6.2B_CERTIFICATION_DEFAULT",
    }),
  });

export interface BarcodeCaptureStartOptions {
  viewportElement: HTMLElement;
  captureTimeoutMs?: number;
  preferredCamera?:
    | "WORLD_FACING"
    | "BEST_AVAILABLE";

  /**
   * Optional validated execution policy. If absent, 6.2B uses its immutable
   * certification policy. 6.2B never loads PostgreSQL/Warehouse Control
   * configuration itself; that is a 6.2C/integration responsibility.
   */
  executionPolicy?:
    BarcodeCaptureExecutionPolicy;
}

export interface BarcodeCaptureCapability {
  start(
    options: BarcodeCaptureStartOptions,
  ): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  stop(): Promise<void>;
  getCaptureStatus():
    BarcodeCaptureStatus;
  subscribeToScans(
    listener: BarcodeDecodeListener,
  ): () => void;
}

export interface BarcodeCaptureStatusSource {
  subscribeToCaptureStatus(
    listener: (
      status: BarcodeCaptureStatus,
    ) => void,
  ): () => void;
}

export interface BarcodeCaptureLifecycleCapability {
  suspendForBackground(): Promise<void>;
  resumeFromBackground(): Promise<void>;
}

export interface BarcodeCaptureDeviceControls {
  setTorch(
    enabled: boolean,
  ): Promise<void>;
}

export function hasBarcodeCaptureCapability(
  value: unknown,
): value is BarcodeCaptureCapability &
  BarcodeCaptureStatusSource &
  BarcodeCaptureLifecycleCapability &
  BarcodeCaptureDeviceControls {
  if (
    !value ||
    typeof value !== "object"
  ) {
    return false;
  }

  const candidate =
    value as Record<
      string,
      unknown
    >;

  return (
    typeof candidate.start ===
      "function" &&
    typeof candidate.pause ===
      "function" &&
    typeof candidate.resume ===
      "function" &&
    typeof candidate.stop ===
      "function" &&
    typeof candidate.getCaptureStatus ===
      "function" &&
    typeof candidate.subscribeToScans ===
      "function" &&
    typeof candidate.subscribeToCaptureStatus ===
      "function" &&
    typeof candidate.suspendForBackground ===
      "function" &&
    typeof candidate.resumeFromBackground ===
      "function" &&
    typeof candidate.setTorch ===
      "function"
  );
}
