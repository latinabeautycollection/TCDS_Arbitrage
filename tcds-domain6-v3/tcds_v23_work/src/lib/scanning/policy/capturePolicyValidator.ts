import type {
  CapturePolicyEnvelope,
} from "./CapturePolicyEnvelope";
import type {
  WarehouseControlCaptureAuthoritySnapshot,
} from "./WarehouseControlCaptureSnapshot";
import type {
  BarcodeScanAreaPolicy,
  BarcodeSelectionPolicy,
} from "../capture/BarcodeCaptureCapability";
import {
  CapturePolicyError,
} from "./CapturePolicyError";

const CAMERA_SCANNER_MODES =
  new Set([
    "SCANDIT_WEB",
    "PWA_CAMERA",
    "CAMERA",
  ]);

export function validateAuthoritySnapshot(
  authority:
    WarehouseControlCaptureAuthoritySnapshot |
    null |
    undefined,
): asserts authority is WarehouseControlCaptureAuthoritySnapshot {
  if (!authority) {
    throw new CapturePolicyError(
      "AUTHORITY_SNAPSHOT_REQUIRED",
      "Authoritative Warehouse Control scanner configuration is required.",
    );
  }

  const profile =
    authority.scannerProfile;

  if (!profile.assetId?.trim()) {
    throw new CapturePolicyError(
      "SCANNER_ASSET_ID_REQUIRED",
      "Authoritative scanner profile must be bound to a Warehouse Control asset.",
    );
  }

  if (
    Number.isNaN(
      Date.parse(
        profile.updatedAt,
      ),
    )
  ) {
    throw new CapturePolicyError(
      "SCANNER_PROFILE_TIMESTAMP_INVALID",
      "Authoritative scanner profile updatedAt is invalid.",
    );
  }

  const scannerMode =
    profile.scannerMode
      .trim()
      .toUpperCase();

  if (
    !CAMERA_SCANNER_MODES.has(
      scannerMode,
    )
  ) {
    throw new CapturePolicyError(
      "SCANNER_MODE_NOT_CAMERA_COMPATIBLE",
      `Warehouse Control scanner_mode "${profile.scannerMode}" is not approved for the Scandit Web camera path.`,
      {
        scannerMode:
          profile.scannerMode,
      },
    );
  }

  if (
    profile.continuousScanEnabled
  ) {
    throw new CapturePolicyError(
      "CONTINUOUS_SCAN_NOT_SUPPORTED",
      "6.2B intentionally pauses Barcode Capture after every decode; continuous_scan_enabled must be false for this camera asset.",
    );
  }

  if (
    !Number.isInteger(
      profile.duplicateSuppressionMs,
    ) ||
    profile.duplicateSuppressionMs <
      0 ||
    profile.duplicateSuppressionMs >
      60_000
  ) {
    throw new CapturePolicyError(
      "DUPLICATE_SUPPRESSION_INVALID",
      "duplicate_suppression_ms must be an integer between 0 and 60000.",
    );
  }
}

export function validateScanArea(
  area: BarcodeScanAreaPolicy,
  envelope: CapturePolicyEnvelope,
): void {
  const bounds =
    envelope.scanAreaBounds;

  if (
    !Number.isFinite(
      area.widthFraction,
    ) ||
    !Number.isFinite(
      area.heightFraction,
    ) ||
    area.widthFraction <
      bounds.minWidthFraction ||
    area.widthFraction >
      bounds.maxWidthFraction ||
    area.heightFraction <
      bounds.minHeightFraction ||
    area.heightFraction >
      bounds.maxHeightFraction
  ) {
    throw new CapturePolicyError(
      "SCAN_AREA_INVALID",
      "Configured Scandit Web scan area exceeds the certified context envelope.",
    );
  }
}

export function validateCaptureTimeout(
  timeoutMs: number,
  envelope: CapturePolicyEnvelope,
): void {
  const bounds =
    envelope.captureTimeoutBounds;

  if (
    !Number.isInteger(
      timeoutMs,
    ) ||
    timeoutMs < bounds.minimumMs ||
    timeoutMs > bounds.maximumMs
  ) {
    throw new CapturePolicyError(
      "CAPTURE_TIMEOUT_INVALID",
      "Configured capture timeout exceeds the certified context envelope.",
    );
  }
}

export function resolveSelection(
  requested:
    BarcodeSelectionPolicy |
    undefined,
  autoScanEnabled: boolean,
  envelope: CapturePolicyEnvelope,
): BarcodeSelectionPolicy {
  if (
    !autoScanEnabled
  ) {
    return "EXPLICIT_CONFIRMATION";
  }

  const candidate =
    requested ??
    envelope.defaultSelection;

  if (
    candidate === "AUTOMATIC" &&
    !envelope.allowAutomaticSelection
  ) {
    return "EXPLICIT_CONFIRMATION";
  }

  return candidate;
}
