import type { BarcodeDecodeObservation } from "../../capture/BarcodeDecodeObservation";
import type { WarehouseCaptureIntent } from "./WarehouseCaptureIntent";

export type WarehouseWorkflow =
  | "RECEIVING"
  | "PUTAWAY"
  | "PICKING"
  | "PACKING"
  | "INVENTORY"
  | "RETURNS"
  | "OUTBOUND";

export type WarehouseCaptureSource =
  | "SCANDIT_WEB"
  | "SCANDIT_EXPRESS"
  | "HID_SCANNER"
  | "MANUAL_ENTRY";

export interface WarehouseScanEnvelope {
  observation: BarcodeDecodeObservation;
  captureIntent: WarehouseCaptureIntent;
  clientOperationId: string;
  correlationId: string;
  workflow: WarehouseWorkflow;
  workflowEntityId: string;
  workflowStep: string;
  expectedRowVersion?: number;
  captureSource: WarehouseCaptureSource;
  workflowContractVersion: "6.2D.2";
}
