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
