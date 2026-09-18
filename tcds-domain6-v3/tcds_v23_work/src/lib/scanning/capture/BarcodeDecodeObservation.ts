import type {
  WarehouseSymbology,
} from "./WarehouseSymbology";

export interface BarcodeDecodeObservation {
  observationId: string;
  provider: string;
  rawValue: string;
  symbology: WarehouseSymbology;
  capturedAt: string;
  captureDurationMs?: number;

  /**
   * Provider/browser diagnostics only.
   *
   * NEVER treat these values as:
   * - warehouse.devices.device_id
   * - warehouse.device_sessions.session_id
   * - warehouse_control.assets.asset_id
   *
   * Authoritative device/session identity is supplied later by Domain 6.
   */
  deviceMetadata?: Readonly<{
    providerDeviceId?: string;
    cameraDeviceId?: string;
  }>;

  /**
   * Capture-policy lineage only. No warehouse business result or entity ID is
   * permitted in this object.
   */
  capturePolicyLineage?: Readonly<{
    policySource:
      | "6.2B_CERTIFICATION_DEFAULT"
      | "6.2C_VALIDATED_POLICY";
    registryVersion?: string;
    profileId?: string;
    profileRevision?: number;
    warehouseConfigurationVersion?: number;
  }>;
}

export type BarcodeDecodeListener = (
  observation:
    BarcodeDecodeObservation,
) => void;
