export type CapturePolicyErrorCode =
  | "AUTHORITY_SNAPSHOT_REQUIRED"
  | "SCANNER_ASSET_ID_REQUIRED"
  | "SCANNER_PROFILE_TIMESTAMP_INVALID"
  | "SCANNER_MODE_NOT_CAMERA_COMPATIBLE"
  | "CONTINUOUS_SCAN_NOT_SUPPORTED"
  | "DUPLICATE_SUPPRESSION_INVALID"
  | "NO_EFFECTIVE_SYMBOLOGIES"
  | "CONFIGURED_SYMBOLOGY_UNSUPPORTED"
  | "SCAN_AREA_INVALID"
  | "CAPTURE_TIMEOUT_INVALID"
  | "INVALID_CONFIGURATION_EXTENSION";

export class CapturePolicyError
  extends Error {
  constructor(
    public readonly code:
      CapturePolicyErrorCode,
    message: string,
    public readonly details?:
      Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name =
      "CapturePolicyError";
  }
}
