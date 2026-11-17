// VERBATIM copies from PR #13 head 2e32abc (tcds_v23_work/src), used to prove our response passes the PWA's own
// decoder and validator. Only change: imports replaced by inline types, browser fetch class and import.meta omitted.
export class CapturePolicyError extends Error { constructor(public readonly code: string, message: string, public readonly details?: unknown) { super(message); } }
/**
 * Read-only DTOs representing authoritative Warehouse Control data already
 * loaded by an approved Domain 6 / Warehouse Control integration.
 *
 * 6.2C does not fetch PostgreSQL, execute SQL, own an API endpoint, or bind
 * the current operator/device session. It only validates and translates a
 * supplied authoritative snapshot.
 */

export interface WarehouseControlScannerProfileSnapshot {
  readonly assetId: string;
  readonly scannerMode: string;
  readonly supportedSymbologies: readonly string[];
  readonly autoScanEnabled: boolean;
  readonly continuousScanEnabled: boolean;
  readonly aimMode?: string | null;
  readonly illuminationEnabled?: boolean | null;
  readonly beepEnabled: boolean;
  readonly vibrationEnabled: boolean;
  readonly duplicateSuppressionMs: number;
  readonly configuration?: Readonly<Record<string, unknown>>;
  readonly updatedAt: string;
}

export interface WarehouseControlSymbologySnapshot {
  readonly symbologyCode: string;
  readonly enabled: boolean;
  readonly minLength?: number | null;
  readonly maxLength?: number | null;
  readonly supportsCheckDigit: boolean;
  readonly validationRegex?: string | null;
}

export interface WarehouseControlCaptureAuthoritySnapshot {
  readonly scannerProfile:
    WarehouseControlScannerProfileSnapshot;
  readonly symbologies:
    readonly WarehouseControlSymbologySnapshot[];
}
export class WarehouseControlCaptureSnapshotError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "WarehouseControlCaptureSnapshotError";
  }
}

function object(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new WarehouseControlCaptureSnapshotError("CAPTURE_SNAPSHOT_INVALID", `${name} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function stringField(source: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  throw new WarehouseControlCaptureSnapshotError("CAPTURE_SNAPSHOT_INVALID", `Missing string field: ${keys.join("/")}`);
}

function optionalString(source: Record<string, unknown>, ...keys: string[]): string | null | undefined {
  for (const key of keys) {
    const value = source[key];
    if (value === null) return null;
    if (typeof value === "string") return value;
  }
  return undefined;
}

function boolField(source: Record<string, unknown>, ...keys: string[]): boolean {
  for (const key of keys) {
    if (typeof source[key] === "boolean") return source[key] as boolean;
  }
  throw new WarehouseControlCaptureSnapshotError("CAPTURE_SNAPSHOT_INVALID", `Missing boolean field: ${keys.join("/")}`);
}

function optionalBool(source: Record<string, unknown>, ...keys: string[]): boolean | null | undefined {
  for (const key of keys) {
    const value = source[key];
    if (value === null) return null;
    if (typeof value === "boolean") return value;
  }
  return undefined;
}

function numberField(source: Record<string, unknown>, ...keys: string[]): number {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  throw new WarehouseControlCaptureSnapshotError("CAPTURE_SNAPSHOT_INVALID", `Missing numeric field: ${keys.join("/")}`);
}

function optionalNumber(source: Record<string, unknown>, ...keys: string[]): number | null | undefined {
  for (const key of keys) {
    const value = source[key];
    if (value === null) return null;
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return undefined;
}

function stringArray(source: Record<string, unknown>, ...keys: string[]): readonly string[] {
  for (const key of keys) {
    const value = source[key];
    if (Array.isArray(value) && value.every((entry) => typeof entry === "string" && entry.trim())) {
      return Object.freeze([...value]);
    }
  }
  throw new WarehouseControlCaptureSnapshotError("CAPTURE_SNAPSHOT_INVALID", `Missing string[] field: ${keys.join("/")}`);
}

function profile(value: unknown): WarehouseControlScannerProfileSnapshot {
  const source = object(value, "scannerProfile");
  const duplicateSuppressionMs = numberField(source, "duplicateSuppressionMs", "duplicate_suppression_ms");
  if (duplicateSuppressionMs < 0) {
    throw new WarehouseControlCaptureSnapshotError("CAPTURE_SNAPSHOT_INVALID", "duplicateSuppressionMs must be >= 0.");
  }

  const configuration = source.configuration;
  if (configuration !== undefined && (!configuration || typeof configuration !== "object" || Array.isArray(configuration))) {
    throw new WarehouseControlCaptureSnapshotError("CAPTURE_SNAPSHOT_INVALID", "scannerProfile.configuration must be an object when present.");
  }

  return Object.freeze({
    assetId: stringField(source, "assetId", "asset_id"),
    scannerMode: stringField(source, "scannerMode", "scanner_mode"),
    supportedSymbologies: stringArray(source, "supportedSymbologies", "supported_symbologies"),
    autoScanEnabled: boolField(source, "autoScanEnabled", "auto_scan_enabled"),
    continuousScanEnabled: boolField(source, "continuousScanEnabled", "continuous_scan_enabled"),
    aimMode: optionalString(source, "aimMode", "aim_mode"),
    illuminationEnabled: optionalBool(source, "illuminationEnabled", "illumination_enabled"),
    beepEnabled: boolField(source, "beepEnabled", "beep_enabled"),
    vibrationEnabled: boolField(source, "vibrationEnabled", "vibration_enabled"),
    duplicateSuppressionMs,
    configuration: configuration as Readonly<Record<string, unknown>> | undefined,
    updatedAt: stringField(source, "updatedAt", "updated_at"),
  });
}

function symbology(value: unknown): WarehouseControlSymbologySnapshot {
  const source = object(value, "symbology");
  return Object.freeze({
    symbologyCode: stringField(source, "symbologyCode", "symbology_code"),
    enabled: boolField(source, "enabled"),
    minLength: optionalNumber(source, "minLength", "min_length"),
    maxLength: optionalNumber(source, "maxLength", "max_length"),
    supportsCheckDigit: boolField(source, "supportsCheckDigit", "supports_check_digit"),
    validationRegex: optionalString(source, "validationRegex", "validation_regex"),
  });
}

export function decodeWarehouseControlCaptureSnapshot(input: unknown): WarehouseControlCaptureAuthoritySnapshot {
  const root = object(input, "capture snapshot");
  const profileValue = root.scannerProfile ?? root.scanner_profile;
  const symbologyValue = root.symbologies;
  if (!Array.isArray(symbologyValue)) {
    throw new WarehouseControlCaptureSnapshotError("CAPTURE_SNAPSHOT_INVALID", "symbologies must be an array.");
  }
  return Object.freeze({
    scannerProfile: profile(profileValue),
    symbologies: Object.freeze(symbologyValue.map(symbology)),
  });
}
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
