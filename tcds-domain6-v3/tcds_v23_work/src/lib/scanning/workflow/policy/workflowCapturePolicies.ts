import type { CapturePolicyAuthority } from "./CapturePolicyAuthority";
import { INTERIM_LOOKUP_CAPTURE_POLICY } from "./InterimLookupCapturePolicy";

/**
 * The capture policy each wired workflow uses, one line each. Moving a workflow to the
 * certified 6.2C policy is a change to its line only:
 *
 *   new CertifiedCapturePolicyAuthority(warehouseControlSnapshotSource)
 */
export const INVENTORY_CAPTURE_POLICY: CapturePolicyAuthority = INTERIM_LOOKUP_CAPTURE_POLICY;
