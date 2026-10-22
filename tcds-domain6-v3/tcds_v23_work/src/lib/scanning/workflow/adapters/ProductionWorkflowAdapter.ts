import type { WarehouseScanEnvelope } from "../contracts/WarehouseScanEnvelope";
import type { WorkflowScanDecision } from "../contracts/WorkflowScanDecision";
import type {
  ReceivingWorkflowPort,
  PutawayWorkflowPort,
  PickingWorkflowPort,
  PackShipWorkflowPort,
  InventoryWorkflowPort,
  ReturnsWorkflowPort,
} from "./WorkflowPorts";

export interface WorkflowAdapterContext {
  rowVersion?: number;
  claimToken?: string;
  lineId?: string;
  shipmentId?: string;
  packageBarcode?: string;
}

export class ProductionWorkflowAdapter {
  constructor(
    private readonly ports: {
      receiving: ReceivingWorkflowPort;
      putaway: PutawayWorkflowPort;
      picking: PickingWorkflowPort;
      packShip: PackShipWorkflowPort;
      inventory: InventoryWorkflowPort;
      returns: ReturnsWorkflowPort;
    },
  ) {}

  async submit(
    envelope: WarehouseScanEnvelope,
    context: WorkflowAdapterContext,
  ): Promise<WorkflowScanDecision> {
    const op = {
      clientOperationId: envelope.clientOperationId,
      correlationId: envelope.correlationId,
    };
    const raw = envelope.observation.rawValue;

    switch (envelope.workflow) {
      case "RECEIVING":
        if (envelope.captureIntent.intent === "PACKAGE_ID") {
          return accepted(await this.ports.receiving.matchPackage(raw, op));
        }
        return accepted(await this.ports.receiving.submitItemScan(raw, op));

      case "PUTAWAY":
        requireRowVersion(context.rowVersion);
        if (envelope.captureIntent.intent === "ITEM_ID") {
          return accepted(await this.ports.putaway.scanItem(
            envelope.workflowEntityId, raw, context.rowVersion!, op,
          ));
        }
        if (envelope.captureIntent.intent === "LOCATION_ID") {
          return accepted(await this.ports.putaway.scanLocation(
            envelope.workflowEntityId, raw, context.rowVersion!, op,
          ));
        }
        return blocked("INVALID_CAPTURE_INTENT");

      case "PICKING":
        requireRowVersion(context.rowVersion);
        if (!context.claimToken) return blocked("TASK_CLAIM_REQUIRED");
        if (envelope.captureIntent.intent === "LOCATION_ID") {
          return accepted(await this.ports.picking.scanLocation(
            envelope.workflowEntityId, raw, context.rowVersion!, context.claimToken, op,
          ));
        }
        if (envelope.captureIntent.intent === "ITEM_ID") {
          if (!context.lineId) return blocked("PICK_LINE_REQUIRED");
          return accepted(await this.ports.picking.scanItem(
            envelope.workflowEntityId, context.lineId, raw,
            context.rowVersion!, context.claimToken, op,
          ));
        }
        if (envelope.captureIntent.intent === "TOTE_ID") {
          return accepted(await this.ports.picking.scanDestination(
            envelope.workflowEntityId, raw, context.rowVersion!, context.claimToken, op,
          ));
        }
        return blocked("INVALID_CAPTURE_INTENT");

      case "PACKING":
        requireRowVersion(context.rowVersion);
        if (envelope.workflowStep === "PACK_SOURCE") {
          return accepted(await this.ports.packShip.scanSource(
            envelope.workflowEntityId, raw, context.rowVersion!, op,
          ));
        }
        if (envelope.workflowStep === "PACK_ITEM") {
          return accepted(await this.ports.packShip.scanItem(
            envelope.workflowEntityId, raw, context.rowVersion!, op,
          ));
        }
        if (envelope.workflowStep === "PACK_VERIFY_LABEL") {
          if (!context.shipmentId || !context.packageBarcode) {
            return blocked("LABEL_CONTEXT_REQUIRED");
          }
          return accepted(await this.ports.packShip.verifyLabel(
            context.shipmentId, raw, context.packageBarcode, op,
          ));
        }
        return blocked("INVALID_WORKFLOW_STEP");

      case "OUTBOUND":
        if (!context.shipmentId) return blocked("SHIPMENT_REQUIRED");
        return accepted(await this.ports.packShip.stageOutbound(
          context.shipmentId, raw, op,
        ));

      case "INVENTORY":
        return accepted(await this.ports.inventory.resolveScan(raw, op));

      case "RETURNS":
        return accepted(await this.ports.returns.resolveScan(raw, op));

      default:
        return blocked("UNSUPPORTED_WORKFLOW");
    }
  }
}

function requireRowVersion(value: number | undefined): asserts value is number {
  if (value === undefined) throw new Error("ROW_VERSION_REQUIRED");
}

function accepted(result: unknown): WorkflowScanDecision {
  return {
    outcome: "ACCEPTED",
    reasonCode: "SCAN_ACCEPTED",
    nextAction: "PAUSE_FOR_DOMAIN_STEP",
    result,
  };
}

function blocked(reasonCode: string): WorkflowScanDecision {
  return { outcome: "BLOCKED", reasonCode, nextAction: "STOP_SCANNER" };
}
