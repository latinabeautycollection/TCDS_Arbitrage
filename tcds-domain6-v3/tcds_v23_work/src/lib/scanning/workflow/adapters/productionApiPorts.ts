import { receivingApi } from "../../../../features/receiving/services/receivingApi";
import {
  scanItem as storageScanItem,
  scanLocation as storageScanLocation,
} from "../../../../features/storage/services/storageApi";
import { pickingApi } from "../../../../features/picking/services/pickingApi";
import { packShipApi, type OperationContext } from "../../../../features/packShip/services/packShipApi";
import { resolveInventoryScan } from "../../../../features/inventory/services/inventoryApi";
import { returnsApi } from "../../../../features/returns/services/returnsApi";
import type { WorkflowPortSet } from "./WorkflowPorts";
import type { OperationRequestContext } from "../operation/WarehouseClientOperation";

type Uuid = ReturnType<Crypto["randomUUID"]>;
const UUID_FORMAT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function operationKey(op: OperationRequestContext): Uuid {
  if (!UUID_FORMAT.test(op.clientOperationId)) throw new Error("OPERATION_ID_INVALID");
  return op.clientOperationId as Uuid;
}

function operationContext(op: OperationRequestContext): OperationContext {
  return { clientOperationId: operationKey(op), correlationId: op.correlationId };
}

export const productionWorkflowPorts: WorkflowPortSet = {
  receiving: {
    matchPackage: (identifier) => receivingApi.matchPackage(identifier),
    createCandidate: (sessionId, draft) => receivingApi.createCandidate(sessionId, draft),
    validateCandidate: (candidateId) => receivingApi.validateCandidate(candidateId),
    verifyCandidate: (candidateId) => receivingApi.verifyCandidate(candidateId),
  },
  putaway: {
    scanItem: async (sessionId, barcode, rowVersion, op) =>
      storageScanItem(sessionId, barcode, rowVersion, operationKey(op)),
    scanLocation: async (sessionId, barcode, rowVersion, op) =>
      storageScanLocation(sessionId, barcode, rowVersion, operationKey(op)),
  },
  picking: {
    scanLocation: (task, barcode) => pickingApi.scanLocation(task, barcode),
    scanItem: (task, barcode) => pickingApi.scanItem(task, barcode),
    scanDestination: (task, barcode) => pickingApi.scanDestination(task, barcode),
  },
  packShip: {
    scanSource: async (taskId, barcode, rowVersion, op) =>
      packShipApi.scanSource(taskId, barcode, rowVersion, operationContext(op)),
    scanItem: async (taskId, barcode, rowVersion, op) =>
      packShipApi.scanItem(taskId, barcode, rowVersion, operationContext(op)),
    verifyLabel: async (shipmentId, trackingBarcode, packageBarcode, op, evidence) =>
      packShipApi.verifyLabel(
        shipmentId,
        trackingBarcode,
        packageBarcode,
        operationContext(op),
        evidence,
      ),
    stageOutbound: async (shipmentId, locationBarcode, op) =>
      packShipApi.stageOutbound(shipmentId, locationBarcode, operationContext(op)),
  },
  inventory: {
    resolveScan: (value) => resolveInventoryScan(value),
  },
  returns: {
    resolveScan: (value, returnType) => returnsApi.resolveScan(value, returnType),
  },
};
