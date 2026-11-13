import type { WarehouseScanEnvelope } from "../contracts/WarehouseScanEnvelope";
import type { WarehouseCaptureIntentType } from "../contracts/WarehouseCaptureIntent";
import type { WorkflowScanDecision } from "../contracts/WorkflowScanDecision";
import type { OperationRequestContext } from "../operation/WarehouseClientOperation";
import type { WorkflowPortSet } from "./WorkflowPorts";
import type {
  IntakeItemDraft,
  IntakeVerificationResult,
} from "../../../../features/receiving/types/receivingTypes";
import type { PickTask, ScanResult } from "../../../../features/picking/types/pickingTypes";
import type { ReturnType as ReturnClassification } from "../../../../features/returns/types/returnTypes";
import type { PackShipLabelPairEvidence, PhysicalTrackingEvidence } from "../../../../features/packShip/scanning/packShipLabelEvidence";
import { classifyWorkflowFailure } from "./workflowFailure";

export interface WorkflowAdapterContext {
  /** Putaway and packing carry the server row version explicitly. */
  rowVersion?: number;
  /** Picking passes the whole task: its row version, claim token and current line. */
  pickTask?: PickTask;
  /** Receiving item scans: the open session and the item draft the screen has built. */
  receivingSessionId?: string;
  intakeDraft?: IntakeItemDraft;
  /** Set when resuming a receiving scan whose candidate was already created. */
  intakeCandidateId?: string;
  shipmentId?: string;
  /** First physical half of the final two-scan tracking -> package proof. */
  trackingBarcode?: string;
  trackingEvidence?: PhysicalTrackingEvidence;
  returnType?: ReturnClassification;
}

const SERIAL_INTENTS: readonly WarehouseCaptureIntentType[] = ["SERIAL", "IMEI", "MAC_ADDRESS"];

export class ProductionWorkflowAdapter {
  constructor(private readonly ports: WorkflowPortSet) {}

  async submit(
    envelope: WarehouseScanEnvelope,
    context: WorkflowAdapterContext,
  ): Promise<WorkflowScanDecision> {
    const op: OperationRequestContext = {
      clientOperationId: envelope.clientOperationId,
      correlationId: envelope.correlationId,
    };
    const raw = envelope.observation.rawValue;
    const intent = envelope.captureIntent.intent;

    switch (envelope.workflow) {
      case "RECEIVING":
        if (intent === "PACKAGE_ID") {
          return accepted(await this.ports.receiving.matchPackage(raw, op));
        }
        return this.receiveItem(raw, intent, context, op);

      case "PUTAWAY":
        if (context.rowVersion === undefined) return blocked("ROW_VERSION_REQUIRED");
        if (intent === "ITEM_ID") {
          return accepted(await this.ports.putaway.scanItem(envelope.workflowEntityId, raw, context.rowVersion, op));
        }
        if (intent === "LOCATION_ID") {
          return accepted(await this.ports.putaway.scanLocation(envelope.workflowEntityId, raw, context.rowVersion, op));
        }
        return blocked("INVALID_CAPTURE_INTENT");

      case "PICKING": {
        const task = context.pickTask;
        if (!task) return blocked("PICK_TASK_REQUIRED");
        if (intent === "LOCATION_ID") return fromPickScan(await this.ports.picking.scanLocation(task, raw, op));
        if (intent === "ITEM_ID") return fromPickScan(await this.ports.picking.scanItem(task, raw, op));
        if (intent === "TOTE_ID") return fromPickScan(await this.ports.picking.scanDestination(task, raw, op));
        return blocked("INVALID_CAPTURE_INTENT");
      }

      case "PACKING":
        if (envelope.workflowStep === "PACK_SOURCE") {
          if (context.rowVersion === undefined) return blocked("ROW_VERSION_REQUIRED");
          if (intent !== "SOURCE_ID") return blocked("INVALID_CAPTURE_INTENT");
          return accepted(await this.ports.packShip.scanSource(envelope.workflowEntityId, raw, context.rowVersion, op));
        }

        if (envelope.workflowStep === "PACK_ITEM") {
          if (context.rowVersion === undefined) return blocked("ROW_VERSION_REQUIRED");
          if (intent !== "ITEM_ID") return blocked("INVALID_CAPTURE_INTENT");
          return accepted(await this.ports.packShip.scanItem(envelope.workflowEntityId, raw, context.rowVersion, op));
        }

        // First physical half of label verification. This records no business mutation.
        // The screen holds this transient observation until the physical package barcode
        // is captured under the PACK_PACKAGE context.
        if (envelope.workflowStep === "PACK_TRACKING_LABEL") {
          if (intent !== "TRACKING_NUMBER") return blocked("INVALID_CAPTURE_INTENT");
          if (!context.shipmentId) return blocked("SHIPMENT_REQUIRED");
          return {
            outcome: "ACCEPTED",
            reasonCode: "TRACKING_SCAN_CAPTURED",
            nextAction: "PAUSE_FOR_DOMAIN_STEP",
            result: {
              trackingBarcode: raw,
              labelPairId: envelope.clientOperationId,
              observationId: envelope.observation.observationId,
              capturedAt: envelope.observation.capturedAt,
              provider: envelope.observation.provider,
              symbology: envelope.observation.symbology,
              trackingClientOperationId: envelope.clientOperationId,
              trackingCorrelationId: envelope.correlationId,
            },
          };
        }

        // Second physical half. Only now is the authoritative verifyLabel writer called.
        if (envelope.workflowStep === "PACK_PACKAGE") {
          if (intent !== "PACKAGE_ID") return blocked("INVALID_CAPTURE_INTENT");
          if (!context.shipmentId || !context.trackingBarcode || !context.trackingEvidence) {
            return blocked("LABEL_CONTEXT_REQUIRED");
          }
          const evidence: PackShipLabelPairEvidence = {
            labelPairId: context.trackingEvidence.labelPairId,
            tracking: context.trackingEvidence,
            package: {
              observationId: envelope.observation.observationId,
              capturedAt: envelope.observation.capturedAt,
              provider: envelope.observation.provider,
              symbology: envelope.observation.symbology,
              packageClientOperationId: envelope.clientOperationId,
              packageCorrelationId: envelope.correlationId,
            },
          };
          return accepted(
            await this.ports.packShip.verifyLabel(
              context.shipmentId,
              context.trackingBarcode,
              raw,
              op,
              evidence,
            ),
          );
        }

        return blocked("INVALID_WORKFLOW_STEP");

      case "OUTBOUND":
        if (!context.shipmentId) return blocked("SHIPMENT_REQUIRED");
        if (intent !== "OUTBOUND_LOCATION") return blocked("INVALID_CAPTURE_INTENT");
        return accepted(await this.ports.packShip.stageOutbound(context.shipmentId, raw, op));

      case "INVENTORY":
        return resolved(await this.ports.inventory.resolveScan(raw, op));

      case "RETURNS":
        return resolved(await this.ports.returns.resolveScan(raw, context.returnType, op));

      default:
        return blocked("UNSUPPORTED_WORKFLOW");
    }
  }

  /**
   * Receiving item scans go through the existing candidate steps: create, validate,
   * verify. The scan supplies only the identifier. Every other field of the draft,
   * including the employee's confirmation, comes from the screen, and nothing here
   * completes the session.
   *
   * Once the candidate exists, a lost response must not create a second one. A failure
   * after creation therefore returns the candidate id with a reconciling decision, and a
   * retry carrying `intakeCandidateId` resumes at validation instead of creating again.
   */
  private async receiveItem(
    raw: string,
    intent: WarehouseCaptureIntentType,
    context: WorkflowAdapterContext,
    op: OperationRequestContext,
  ): Promise<WorkflowScanDecision> {
    let candidateId = context.intakeCandidateId;

    if (!candidateId) {
      if (!context.receivingSessionId || !context.intakeDraft) return blocked("RECEIVING_CONTEXT_REQUIRED");

      let draft: IntakeItemDraft;
      if (SERIAL_INTENTS.includes(intent)) draft = { ...context.intakeDraft, serialNumber: raw };
      else if (intent === "ITEM_ID") draft = { ...context.intakeDraft, upc: raw };
      else return blocked("INVALID_CAPTURE_INTENT");

      const candidate = await this.ports.receiving.createCandidate(context.receivingSessionId, draft, op);
      candidateId = candidate.intakeCandidateId;
    }

    try {
      const validation = await this.ports.receiving.validateCandidate(candidateId, op);
      if (!validation.passed) {
        return {
          outcome: "REJECTED",
          reasonCode: "CANDIDATE_VALIDATION_FAILED",
          nextAction: "PAUSE_FOR_DOMAIN_STEP",
          result: { intakeCandidateId: candidateId, errors: validation.errors },
        };
      }
      return fromVerification(candidateId, await this.ports.receiving.verifyCandidate(candidateId, op));
    } catch (error) {
      const failure = classifyWorkflowFailure(error);
      if (failure.kind === "UNCERTAIN") {
        return {
          outcome: "RECONCILING",
          reasonCode: "RECONCILIATION_REQUIRED",
          nextAction: "RECONCILE",
          result: { intakeCandidateId: candidateId, failure },
        };
      }
      throw error;
    }
  }
}

function accepted(result: unknown): WorkflowScanDecision {
  return { outcome: "ACCEPTED", reasonCode: "SCAN_ACCEPTED", nextAction: "PAUSE_FOR_DOMAIN_STEP", result };
}

/** Inventory and returns resolve an identity; they never decide a business outcome. */
function resolved(result: unknown): WorkflowScanDecision {
  return { outcome: "ACCEPTED", reasonCode: "SCAN_RESOLVED", nextAction: "PAUSE_FOR_DOMAIN_STEP", result };
}

/** Picking answers with its own verdict, so a returned scan is not automatically success. */
function fromPickScan(result: ScanResult): WorkflowScanDecision {
  return result.accepted
    ? { outcome: "ACCEPTED", reasonCode: result.code || "SCAN_ACCEPTED", nextAction: "PAUSE_FOR_DOMAIN_STEP", result }
    : { outcome: "REJECTED", reasonCode: result.code || "SCAN_REJECTED", nextAction: "RESUME_SAME_PROFILE", result };
}

function fromVerification(intakeCandidateId: string, verification: IntakeVerificationResult): WorkflowScanDecision {
  const result = { intakeCandidateId, verification };
  switch (verification.status) {
    case "VERIFIED":
      return { outcome: "ACCEPTED", reasonCode: "CANDIDATE_VERIFIED", nextAction: "PAUSE_FOR_DOMAIN_STEP", result };
    case "VERIFIED_WITH_WARNING":
      return { outcome: "ACCEPTED", reasonCode: "CANDIDATE_VERIFIED_WITH_WARNING", nextAction: "PAUSE_FOR_DOMAIN_STEP", result };
    case "REVIEW_REQUIRED":
      return { outcome: "REVIEW_REQUIRED", reasonCode: "CANDIDATE_REVIEW_REQUIRED", nextAction: "SUPERVISOR_REVIEW", result };
    case "REJECTED":
      return { outcome: "REJECTED", reasonCode: "CANDIDATE_REJECTED", nextAction: "PAUSE_FOR_DOMAIN_STEP", result };
    default:
      return { outcome: "REVIEW_REQUIRED", reasonCode: "VERIFICATION_PENDING", nextAction: "PAUSE_FOR_DOMAIN_STEP", result };
  }
}

function blocked(reasonCode: string): WorkflowScanDecision {
  return { outcome: "BLOCKED", reasonCode, nextAction: "STOP_SCANNER" };
}
