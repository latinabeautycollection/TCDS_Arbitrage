import type { OperationRequestContext } from "../operation/WarehouseClientOperation";

export interface ReceivingWorkflowPort {
  matchPackage(identifier: string, op: OperationRequestContext): Promise<unknown>;
  submitItemScan(value: string, op: OperationRequestContext): Promise<unknown>;
}

export interface PutawayWorkflowPort {
  scanItem(sessionId: string, barcode: string, rowVersion: number, op: OperationRequestContext): Promise<unknown>;
  scanLocation(sessionId: string, barcode: string, rowVersion: number, op: OperationRequestContext): Promise<unknown>;
}

export interface PickingWorkflowPort {
  scanLocation(taskId: string, barcode: string, rowVersion: number, claimToken: string, op: OperationRequestContext): Promise<unknown>;
  scanItem(taskId: string, lineId: string, barcode: string, rowVersion: number, claimToken: string, op: OperationRequestContext): Promise<unknown>;
  scanDestination(taskId: string, barcode: string, rowVersion: number, claimToken: string, op: OperationRequestContext): Promise<unknown>;
}

export interface PackShipWorkflowPort {
  scanSource(taskId: string, barcode: string, rowVersion: number, op: OperationRequestContext): Promise<unknown>;
  scanItem(taskId: string, barcode: string, rowVersion: number, op: OperationRequestContext): Promise<unknown>;
  verifyLabel(shipmentId: string, trackingBarcode: string, packageBarcode: string, op: OperationRequestContext): Promise<unknown>;
  stageOutbound(shipmentId: string, locationBarcode: string, op: OperationRequestContext): Promise<unknown>;
}

export interface InventoryWorkflowPort {
  resolveScan(value: string, op: OperationRequestContext): Promise<unknown>;
}

export interface ReturnsWorkflowPort {
  resolveScan(value: string, op: OperationRequestContext): Promise<unknown>;
}
