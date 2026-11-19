import {
  CertifiedCapturePolicyAuthority,
  type CapturePolicyAuthority,
} from "../../../lib/scanning/workflow/policy/CapturePolicyAuthority";
import { WarehouseControlHttpCaptureSnapshotSource } from "./warehouseControlCaptureSnapshotSource";

/**
 * Singleton production Pack/Ship policy binding. This does not own scanner policy;
 * it supplies the current server-derived Warehouse Control snapshot to certified 6.2C.
 */
export const packShipCapturePolicyAuthority: CapturePolicyAuthority =
  new CertifiedCapturePolicyAuthority(new WarehouseControlHttpCaptureSnapshotSource());
