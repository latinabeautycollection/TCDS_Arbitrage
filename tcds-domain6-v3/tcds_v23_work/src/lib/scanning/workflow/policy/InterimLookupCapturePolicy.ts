import {
  DOMAIN6_2B_CERTIFICATION_POLICY,
  type BarcodeCaptureExecutionPolicy,
} from "../../capture/BarcodeCaptureCapability";
import type { WarehouseCaptureIntent } from "../contracts/WarehouseCaptureIntent";
import type { CapturePolicyAuthority, WorkflowCaptureContext } from "./CapturePolicyAuthority";

/**
 * INTERIM capture policy: the 6.2B certification profile, for lookup-only workflows,
 * until the Warehouse Control scanner-profile snapshot exists and 6.2C can resolve the
 * real policy.
 *
 * This is not a fallback. It is never chosen because 6.2C is unavailable; a workflow is
 * bound to it explicitly in workflowCapturePolicies.ts, and it refuses every workflow
 * that is not on the lookup-only list below. Returns is not on the list until its scan
 * is confirmed not to change data.
 */
export const INTERIM_LOOKUP_WORKFLOWS: ReadonlySet<string> = new Set(["INVENTORY"]);

export class InterimLookupCapturePolicyAuthority implements CapturePolicyAuthority {
  async resolveIntentPolicy(
    _intent: WarehouseCaptureIntent,
    context: WorkflowCaptureContext,
  ): Promise<BarcodeCaptureExecutionPolicy> {
    if (!INTERIM_LOOKUP_WORKFLOWS.has(context.workflow)) {
      throw new Error("INTERIM_POLICY_NOT_PERMITTED");
    }
    return DOMAIN6_2B_CERTIFICATION_POLICY;
  }
}

export const INTERIM_LOOKUP_CAPTURE_POLICY = new InterimLookupCapturePolicyAuthority();
