import { receivingApi } from "../../../../features/receiving/services/receivingApi";
import {
  scanItem as storageScanItem,
  scanLocation as storageScanLocation,
} from "../../../../features/storage/services/storageApi";
import { pickingApi } from "../../../../features/picking/services/pickingApi";
import { packShipApi } from "../../../../features/packShip/services/packShipApi";
import { resolveInventoryScan } from "../../../../features/inventory/services/inventoryApi";
import { returnsApi } from "../../../../features/returns/services/returnsApi";
import type { WorkflowPortSet } from "./WorkflowPorts";
import type { OperationRequestContext } from "../operation/WarehouseClientOperation";

type Uuid = ReturnType<Crypto["randomUUID"]>;

const UUID_FORMAT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The storage helper types its idempotency key as a UUID. The operation identity is
 * created with crypto.randomUUID(), so it is one; this checks rather than assumes it.
 */
function operationKey(op: OperationRequestContext): Uuid {
  if (!UUID_FORMAT.test(op.clientOperationId)) throw new Error("OPERATION_ID_INVALID");
  return op.clientOperationId as Uuid;
}

/**
 * Binds the 6.2D ports to the six existing authoritative API helpers. This module makes
 * no HTTP call of its own: there is one HTTP path, one error contract per helper, and one
 * retry model, all of them the helpers'.
 *
 * Operation context. Every port receives the operation. The storage scan calls already
 * accept an idempotency key, so they receive the stable operation identity now. The other
 * helpers still generate their own identity per call until they are extended to accept
 * the operation; the parameter is in place so that change is a one-line edit here.
 */
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
    scanSource: (taskId, barcode, rowVersion) => packShipApi.scanSource(taskId, barcode, rowVersion),
    scanItem: (taskId, barcode, rowVersion) => packShipApi.scanItem(taskId, barcode, rowVersion),
    verifyLabel: (shipmentId, trackingBarcode, packageBarcode) =>
      packShipApi.verifyLabel(shipmentId, trackingBarcode, packageBarcode),
    stageOutbound: (shipmentId, locationBarcode) => packShipApi.stageOutbound(shipmentId, locationBarcode),
  },

  inventory: {
    resolveScan: (value) => resolveInventoryScan(value),
  },

  returns: {
    resolveScan: (value, returnType) => returnsApi.resolveScan(value, returnType),
  },
};
