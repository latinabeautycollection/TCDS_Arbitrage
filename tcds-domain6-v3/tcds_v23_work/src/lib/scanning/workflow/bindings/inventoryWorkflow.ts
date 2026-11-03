import { ProductionWorkflowAdapter } from "../adapters/ProductionWorkflowAdapter";
import { productionWorkflowPorts } from "../adapters/productionApiPorts";
import { DOMAIN6_2D_CERTIFIED_SYMBOLOGIES } from "../contracts/WarehouseCaptureIntent";
import {
  WorkflowScanCoordinator,
  type ScannerControl,
  type WorkflowScanCoordinatorContext,
} from "../coordinator/WorkflowScanCoordinator";
import { INVENTORY_CAPTURE_POLICY } from "../policy/workflowCapturePolicies";

/** Camera scanning on the Inventory screen. Off unless the flag is exactly "true". */
export function inventoryCameraScanEnabled(): boolean {
  return import.meta.env.VITE_SCANDIT_WORKFLOW_INVENTORY === "true";
}

/**
 * An inventory scan resolves an item or a location and changes nothing. The intent is
 * ITEM_ID for symbology purposes; the inventory service decides what the value is.
 */
export const INVENTORY_SCAN_CONTEXT: WorkflowScanCoordinatorContext = {
  workflow: "INVENTORY",
  workflowEntityId: "INVENTORY_LOOKUP",
  workflowStep: "LOOKUP",
  captureIntent: {
    intent: "ITEM_ID",
    mode: "SINGLE",
    allowedSymbologies: DOMAIN6_2D_CERTIFIED_SYMBOLOGIES,
    allowManualFallback: true,
  },
  captureSource: "SCANDIT_WEB",
  adapterContext: {},
};

export function createInventoryCoordinator(scanner: ScannerControl): WorkflowScanCoordinator {
  return new WorkflowScanCoordinator(
    scanner,
    INVENTORY_CAPTURE_POLICY,
    new ProductionWorkflowAdapter(productionWorkflowPorts),
    () => navigator.onLine,
  );
}
