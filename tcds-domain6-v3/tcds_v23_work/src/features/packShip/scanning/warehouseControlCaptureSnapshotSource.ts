import type {
  WarehouseControlCaptureAuthoritySnapshot,
  WarehouseControlScannerProfileSnapshot,
  WarehouseControlSymbologySnapshot,
} from "../../../lib/scanning/policy/WarehouseControlCaptureSnapshot";
import type { CaptureAuthoritySnapshotSource } from "../../../lib/scanning/workflow/policy/CapturePolicyAuthority";

const API_BASE = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "");
const DEFAULT_ENDPOINT = "/api/v1/warehouse-control/scanner/capture-snapshot";

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

/**
 * Feature-integration adapter only. The server derives the current authenticated
 * device/station/facility and returns the already-authoritative Warehouse Control snapshot.
 * No client-selected device, station, employee or facility identifier is sent.
 */
export class WarehouseControlHttpCaptureSnapshotSource implements CaptureAuthoritySnapshotSource {
  constructor(private readonly endpoint = DEFAULT_ENDPOINT) {}

  async load(): Promise<WarehouseControlCaptureAuthoritySnapshot> {
    const response = await fetch(`${API_BASE}${this.endpoint}`, {
      method: "GET",
      credentials: "include",
      cache: "no-store",
      headers: { Accept: "application/json" },
    });

    if (!response.ok) {
      throw new WarehouseControlCaptureSnapshotError(
        response.status === 401 ? "SESSION_EXPIRED" : "CAPTURE_POLICY_SNAPSHOT_UNAVAILABLE",
        `Warehouse Control capture snapshot request failed with HTTP ${response.status}.`,
        response.status,
      );
    }

    return decodeWarehouseControlCaptureSnapshot(await response.json());
  }
}
