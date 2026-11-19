import { ProductionWorkflowAdapter } from "../adapters/ProductionWorkflowAdapter";
import { productionWorkflowPorts } from "../adapters/productionApiPorts";
import {
  WorkflowScanCoordinator,
  type ScannerControl,
} from "../coordinator/WorkflowScanCoordinator";
import type { CapturePolicyAuthority } from "../policy/CapturePolicyAuthority";

/** Camera Pack/Ship integration is explicitly enabled for a governed pilot/release. */
export function packShipCameraScanEnabled(): boolean {
  return import.meta.env.VITE_SCANDIT_WORKFLOW_PACK_SHIP === "true";
}

/**
 * Constructs the Pack/Ship coordinator using the already-certified 6.2D adapter and
 * a caller-supplied 6.2C policy authority. This binding owns no Warehouse Control
 * fetch, no business rule and no HTTP route.
 */
export function createPackShipCoordinator(
  scanner: ScannerControl,
  capturePolicyAuthority: CapturePolicyAuthority,
): WorkflowScanCoordinator {
  return new WorkflowScanCoordinator(
    scanner,
    capturePolicyAuthority,
    new ProductionWorkflowAdapter(productionWorkflowPorts),
    () => navigator.onLine,
  );
}
