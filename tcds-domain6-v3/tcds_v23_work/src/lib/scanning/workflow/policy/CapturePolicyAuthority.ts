import type { BarcodeCaptureExecutionPolicy } from "../../capture/BarcodeCaptureCapability";
import type {
  WarehouseCaptureIntent,
  WarehouseCaptureIntentType,
} from "../contracts/WarehouseCaptureIntent";
import type { WarehouseCaptureContextId } from "../../policy/WarehouseCaptureContext";
import type { WarehouseControlCaptureAuthoritySnapshot } from "../../policy/WarehouseControlCaptureSnapshot";
import { resolveWarehouseCapturePolicy } from "../../policy/capturePolicyResolver";

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

/** Supplies the authoritative Warehouse Control scanner profile and symbology rows. */
export interface CaptureAuthoritySnapshotSource {
  load(): Promise<WarehouseControlCaptureAuthoritySnapshot>;
}

const SERIAL_INTENTS: readonly WarehouseCaptureIntentType[] = ["SERIAL", "IMEI", "MAC_ADDRESS"];

/**
 * The certified 6.2C capture context for a workflow scan. Returns null where no context
 * fits, so the authority fails closed rather than guessing a policy.
 */
export function captureContextFor(
  workflow: string,
  workflowStep: string,
  intent: WarehouseCaptureIntentType,
): WarehouseCaptureContextId | null {
  const serial = SERIAL_INTENTS.includes(intent);
  switch (workflow) {
    case "RECEIVING":
      if (intent === "PACKAGE_ID") return "RECEIVING_PACKAGE";
      if (intent === "ITEM_ID") return "RECEIVING_ITEM";
      return serial ? "RECEIVING_SERIAL" : null;
    case "PUTAWAY":
      if (intent === "ITEM_ID") return "PUTAWAY_ITEM";
      return intent === "LOCATION_ID" ? "PUTAWAY_LOCATION" : null;
    case "PICKING":
      if (intent === "LOCATION_ID") return "PICK_LOCATION";
      if (intent === "ITEM_ID") return "PICK_ITEM";
      return intent === "TOTE_ID" ? "PICK_DESTINATION" : null;
    case "PACKING":
      if (workflowStep === "PACK_SOURCE") return intent === "SOURCE_ID" ? "PACK_SOURCE" : null;
      if (workflowStep === "PACK_ITEM") return intent === "ITEM_ID" ? "PACK_ITEM" : null;
      if (workflowStep === "PACK_TRACKING_LABEL") return intent === "TRACKING_NUMBER" ? "TRACKING_LABEL" : null;
      if (workflowStep === "PACK_PACKAGE") return intent === "PACKAGE_ID" ? "PACK_PACKAGE" : null;
      return null;
    case "OUTBOUND":
      return intent === "OUTBOUND_LOCATION" ? "PACK_OUTBOUND_LOCATION" : null;
    case "INVENTORY":
      return "INVENTORY_LOOKUP";
    case "RETURNS":
      if (intent === "PACKAGE_ID") return "RETURN_PACKAGE";
      if (intent === "ITEM_ID") return "RETURN_ITEM";
      return serial ? "RETURN_SERIAL" : null;
    default:
      return null;
  }
}

/**
 * Resolves the capture policy through the certified 6.2C adapter. Any snapshot 6.2C
 * rejects, and any scan without a certified context, fails closed.
 */
export class CertifiedCapturePolicyAuthority implements CapturePolicyAuthority {
  constructor(private readonly snapshots: CaptureAuthoritySnapshotSource) {}

  async resolveIntentPolicy(
    intent: WarehouseCaptureIntent,
    context: WorkflowCaptureContext,
  ): Promise<BarcodeCaptureExecutionPolicy> {
    const contextId = captureContextFor(context.workflow, context.workflowStep, intent.intent);
    if (!contextId) throw new Error("CAPTURE_POLICY_CONTEXT_UNMAPPED");

    return resolveWarehouseCapturePolicy(contextId, await this.snapshots.load()).executionPolicy;
  }
}
