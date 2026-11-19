import type { WarehouseSymbology } from "../../../lib/scanning/capture/WarehouseSymbology";

export interface PhysicalTrackingEvidence {
  readonly labelPairId: string;
  readonly barcode: string;
  readonly observationId: string;
  readonly capturedAt: string;
  readonly provider: string;
  readonly symbology: WarehouseSymbology;
  readonly trackingClientOperationId: string;
  readonly trackingCorrelationId: string;
}

export interface PhysicalPackageEvidence {
  readonly observationId: string;
  readonly capturedAt: string;
  readonly provider: string;
  readonly symbology: WarehouseSymbology;
  readonly packageClientOperationId: string;
  readonly packageCorrelationId: string;
}

export interface PackShipLabelPairEvidence {
  readonly labelPairId: string;
  readonly tracking: PhysicalTrackingEvidence;
  readonly package: PhysicalPackageEvidence;
}
