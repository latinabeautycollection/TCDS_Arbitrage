import type { BarcodeDecodeObservation } from "../../capture/BarcodeDecodeObservation";
import type { BarcodeCaptureExecutionPolicy } from "../../capture/BarcodeCaptureCapability";
import type { WarehouseCaptureIntent } from "../contracts/WarehouseCaptureIntent";
import type { WarehouseScanEnvelope, WarehouseWorkflow, WarehouseCaptureSource } from "../contracts/WarehouseScanEnvelope";
import type { WorkflowScanDecision } from "../contracts/WorkflowScanDecision";
import type { CapturePolicyAuthority } from "../policy/CapturePolicyAuthority";
import {
  createWarehouseClientOperation,
  type WarehouseClientOperation,
} from "../operation/WarehouseClientOperation";
import type {
  ProductionWorkflowAdapter,
  WorkflowAdapterContext,
} from "../adapters/ProductionWorkflowAdapter";
import {
  classifyWorkflowFailure,
  decisionForFailure,
} from "../adapters/workflowFailure";

export interface ScannerControl {
  pause(): Promise<void>;
  resume(): Promise<void>;
  start(options: { executionPolicy: BarcodeCaptureExecutionPolicy }): Promise<void>;
}

export interface WorkflowScanCoordinatorContext {
  workflow: WarehouseWorkflow;
  workflowEntityId: string;
  workflowStep: string;
  captureIntent: WarehouseCaptureIntent;
  captureSource: WarehouseCaptureSource;
  adapterContext: WorkflowAdapterContext;
}

/**
 * A scan whose outcome is unknown. Its operation identity is reused only by a true retry
 * of the same scan, never by a different barcode.
 */
interface PendingScan {
  operation: WarehouseClientOperation;
  observation: BarcodeDecodeObservation;
  identity: string;
  /** What a retry needs in order to resume rather than repeat, such as a created candidate. */
  resume: Partial<WorkflowAdapterContext>;
}

export class WorkflowScanCoordinator {
  private pending: PendingScan | null = null;

  constructor(
    private readonly scanner: ScannerControl,
    private readonly policyAuthority: CapturePolicyAuthority,
    private readonly workflowAdapter: ProductionWorkflowAdapter,
    private readonly isOnline: () => boolean,
  ) {}

  async begin(ctx: WorkflowScanCoordinatorContext): Promise<void> {
    const policy = await this.policyAuthority.resolveIntentPolicy(
      ctx.captureIntent,
      {
        workflow: ctx.workflow,
        workflowEntityId: ctx.workflowEntityId,
        workflowStep: ctx.workflowStep,
      },
    );
    await this.scanner.start({ executionPolicy: policy });
  }

  /** The scan whose outcome is still unknown, if there is one. */
  get pendingObservation(): BarcodeDecodeObservation | null {
    return this.pending?.observation ?? null;
  }

  async onObservation(
    observation: BarcodeDecodeObservation,
    ctx: WorkflowScanCoordinatorContext,
  ): Promise<WorkflowScanDecision> {
    await this.scanner.pause();

    if (!this.isOnline()) return offline();

    if (!ctx.captureIntent.allowedSymbologies.includes(observation.symbology)) {
      return {
        outcome: "BLOCKED",
        reasonCode: "INVALID_CAPTURE_INTENT",
        nextAction: "STOP_SCANNER",
      };
    }

    const identity = scanIdentity(observation, ctx);

    if (this.pending && this.pending.identity !== identity) {
      // A different barcode while an earlier scan's outcome is unknown. Sending it under
      // the pending identity would give two payloads one idempotency key; sending it under
      // a new one would abandon a scan the server may already have committed. The earlier
      // scan is reconciled first.
      return {
        outcome: "BLOCKED",
        reasonCode: "PENDING_SCAN_UNRESOLVED",
        nextAction: "RECONCILE",
        result: { pendingObservationId: this.pending.observation.observationId },
      };
    }

    return this.submit(observation, ctx, identity);
  }

  /** Retries the scan whose outcome is unknown, under its original identity. */
  async retry(ctx: WorkflowScanCoordinatorContext): Promise<WorkflowScanDecision> {
    if (!this.pending) {
      return {
        outcome: "BLOCKED",
        reasonCode: "NOTHING_TO_RECONCILE",
        nextAction: "RESUME_SAME_PROFILE",
      };
    }
    if (!this.isOnline()) return offline();

    return this.submit(this.pending.observation, ctx, this.pending.identity);
  }

  /** Abandons the pending scan. Only for a screen that has reconciled it some other way. */
  clearOperation(): void {
    this.pending = null;
  }

  private async submit(
    observation: BarcodeDecodeObservation,
    ctx: WorkflowScanCoordinatorContext,
    identity: string,
  ): Promise<WorkflowScanDecision> {
    // By construction a pending scan here has the same identity, so this is a true retry.
    const operation = this.pending?.operation ?? createWarehouseClientOperation();
    const adapterContext: WorkflowAdapterContext = {
      ...ctx.adapterContext,
      ...(this.pending?.resume ?? {}),
    };

    const expectedRowVersion =
      adapterContext.rowVersion ?? adapterContext.pickTask?.rowVersion;

    const envelope: WarehouseScanEnvelope = {
      observation,
      captureIntent: ctx.captureIntent,
      clientOperationId: operation.clientOperationId,
      correlationId: operation.correlationId,
      workflow: ctx.workflow,
      workflowEntityId: ctx.workflowEntityId,
      workflowStep: ctx.workflowStep,
      captureSource: ctx.captureSource,
      workflowContractVersion: "6.2D.2",
      ...(expectedRowVersion !== undefined ? { expectedRowVersion } : {}),
    };

    let decision: WorkflowScanDecision;
    try {
      decision = await this.workflowAdapter.submit(envelope, adapterContext);
    } catch (error) {
      // One failure shape at the boundary: a helper's own error never leaves 6.2D.
      decision = decisionForFailure(classifyWorkflowFailure(error));
    }

    // Only an unknown outcome keeps the operation; every conclusive result ends it.
    this.pending =
      decision.outcome === "RECONCILING"
        ? { operation, observation, identity, resume: resumeFrom(decision) }
        : null;

    return decision;
  }
}

function offline(): WorkflowScanDecision {
  return {
    outcome: "BLOCKED",
    reasonCode: "OFFLINE_VALIDATION_UNAVAILABLE",
    nextAction: "STOP_SCANNER",
  };
}

/** The same barcode, in the same workflow step, is the same scan. */
function scanIdentity(
  observation: BarcodeDecodeObservation,
  ctx: WorkflowScanCoordinatorContext,
): string {
  return JSON.stringify([
    ctx.workflow,
    ctx.workflowEntityId,
    ctx.workflowStep,
    ctx.captureIntent.intent,
    observation.symbology,
    observation.rawValue,
  ]);
}

function resumeFrom(decision: WorkflowScanDecision): Partial<WorkflowAdapterContext> {
  const result = decision.result;
  const candidateId =
    result && typeof result === "object" && "intakeCandidateId" in result
      ? (result as { intakeCandidateId?: unknown }).intakeCandidateId
      : undefined;
  return typeof candidateId === "string" ? { intakeCandidateId: candidateId } : {};
}
