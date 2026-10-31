import type { BarcodeCaptureExecutionPolicy } from "../../capture/BarcodeCaptureCapability";
import type { WarehouseCaptureIntent } from "../contracts/WarehouseCaptureIntent";

export interface WorkflowCaptureContext {
  workflow: string;
  workflowEntityId: string;
  workflowStep: string;
}

export interface CapturePolicyAuthority {
  resolveIntentPolicy(
    intent: WarehouseCaptureIntent,
    context: WorkflowCaptureContext,
  ): Promise<BarcodeCaptureExecutionPolicy>;
}

/**
 * Production binding MUST be supplied by certified Domain 6.2C.
 * 6.2D is intentionally fail-closed until that dependency exists.
 */
export class MissingCapturePolicyAuthority implements CapturePolicyAuthority {
  async resolveIntentPolicy(): Promise<BarcodeCaptureExecutionPolicy> {
    throw new Error("CAPTURE_POLICY_UNAVAILABLE");
  }
}
