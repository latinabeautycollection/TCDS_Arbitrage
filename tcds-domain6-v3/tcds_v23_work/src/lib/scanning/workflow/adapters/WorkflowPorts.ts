import type { OperationRequestContext } from "../operation/WarehouseClientOperation";
import type {
  IntakeCandidate,
  IntakeItemDraft,
  IntakeVerificationResult,
  ReceiptMatch,
} from "../../../../features/receiving/types/receivingTypes";
import type { PutAwaySession } from "../../../../features/storage/types/storageTypes";
import type { PickTask, ScanResult } from "../../../../features/picking/types/pickingTypes";
import type { PackShipTask } from "../../../../features/packShip/types/packShipTypes";
import type { PackShipLabelPairEvidence } from "../../../../features/packShip/scanning/packShipLabelEvidence";
import type { ScanResolution } from "../../../../features/inventory/types/inventoryTypes";
import type {
  ReturnSession,
  ReturnType as ReturnClassification,
} from "../../../../features/returns/types/returnTypes";

export interface ReceivingWorkflowPort {
  matchPackage(identifier: string, op: OperationRequestContext): Promise<ReceiptMatch>;
  createCandidate(sessionId: string, draft: IntakeItemDraft, op: OperationRequestContext): Promise<IntakeCandidate>;
  validateCandidate(candidateId: string, op: OperationRequestContext): Promise<{ passed: boolean; errors: string[] }>;
  verifyCandidate(candidateId: string, op: OperationRequestContext): Promise<IntakeVerificationResult>;
}

export interface PutawayWorkflowPort {
  scanItem(sessionId: string, barcode: string, rowVersion: number, op: OperationRequestContext): Promise<PutAwaySession>;
  scanLocation(sessionId: string, barcode: string, rowVersion: number, op: OperationRequestContext): Promise<PutAwaySession>;
}

export interface PickingWorkflowPort {
  scanLocation(task: PickTask, barcode: string, op: OperationRequestContext): Promise<ScanResult>;
  scanItem(task: PickTask, barcode: string, op: OperationRequestContext): Promise<ScanResult>;
  scanDestination(task: PickTask, barcode: string, op: OperationRequestContext): Promise<ScanResult>;
}

export interface PackShipWorkflowPort {
  scanSource(taskId: string, barcode: string, rowVersion: number, op: OperationRequestContext): Promise<PackShipTask>;
  scanItem(taskId: string, barcode: string, rowVersion: number, op: OperationRequestContext): Promise<PackShipTask>;
  verifyLabel(
    shipmentId: string,
    trackingBarcode: string,
    packageBarcode: string,
    op: OperationRequestContext,
    evidence: PackShipLabelPairEvidence,
  ): Promise<PackShipTask>;
  stageOutbound(shipmentId: string, locationBarcode: string, op: OperationRequestContext): Promise<PackShipTask>;
}

export interface InventoryWorkflowPort {
  resolveScan(value: string, op: OperationRequestContext): Promise<ScanResolution>;
}

export interface ReturnsWorkflowPort {
  resolveScan(value: string, returnType: ReturnClassification | undefined, op: OperationRequestContext): Promise<ReturnSession>;
}

export interface WorkflowPortSet {
  receiving: ReceivingWorkflowPort;
  putaway: PutawayWorkflowPort;
  picking: PickingWorkflowPort;
  packShip: PackShipWorkflowPort;
  inventory: InventoryWorkflowPort;
  returns: ReturnsWorkflowPort;
}
