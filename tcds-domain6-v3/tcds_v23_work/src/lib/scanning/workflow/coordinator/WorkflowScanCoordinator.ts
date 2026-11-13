import type { BarcodeDecodeObservation } from "../../capture/BarcodeDecodeObservation";
import type { BarcodeCaptureExecutionPolicy } from "../../capture/BarcodeCaptureCapability";
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
import type { WarehouseCaptureIntent } from "../contracts/WarehouseCaptureIntent";
import type { WarehouseCaptureSource, WarehouseScanEnvelope, WarehouseWorkflow } from "../contracts/WarehouseScanEnvelope";

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

interface PendingScan {
  operation: WarehouseClientOperation;
  observation: BarcodeDecodeObservation;
  identity: string;
  /** Exact workflow/payload context of the original uncertain submission. */
  context: WorkflowScanCoordinatorContext;
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
    if (this.pending) {
      throw new Error("PENDING_SCAN_UNRESOLVED");
    }
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
      return {
        outcome: "BLOCKED",
        reasonCode: "PENDING_SCAN_UNRESOLVED",
        nextAction: "RECONCILE",
        result: { pendingObservationId: this.pending.observation.observationId },
      };
    }

    return this.submit(observation, snapshotContext(ctx), identity);
  }

  /**
   * Retries the uncertain scan using the exact original workflow context and rowVersion.
   * A later UI refresh must never alter the payload beneath the same idempotency key.
   */
  async retry(_currentContext: WorkflowScanCoordinatorContext): Promise<WorkflowScanDecision> {
    if (!this.pending) {
      return {
        outcome: "BLOCKED",
        reasonCode: "NOTHING_TO_RECONCILE",
        nextAction: "RESUME_SAME_PROFILE",
      };
    }
    if (!this.isOnline()) return offline();

    return this.submit(
      this.pending.observation,
      this.pending.context,
      this.pending.identity,
    );
  }

  /** Abandons the pending scan only after another authoritative path reconciled it. */
  clearOperation(): void {
    this.pending = null;
  }

  private async submit(
    observation: BarcodeDecodeObservation,
    ctx: WorkflowScanCoordinatorContext,
    identity: string,
  ): Promise<WorkflowScanDecision> {
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
      decision = decisionForFailure(classifyWorkflowFailure(error));
    }

    this.pending =
      decision.outcome === "RECONCILING"
        ? {
            operation,
            observation,
            identity,
            context: snapshotContext(ctx),
            resume: resumeFrom(decision),
          }
        : null;

    return decision;
  }
}

function snapshotContext(ctx: WorkflowScanCoordinatorContext): WorkflowScanCoordinatorContext {
  return {
    ...ctx,
    captureIntent: {
      ...ctx.captureIntent,
      allowedSymbologies: [...ctx.captureIntent.allowedSymbologies],
    },
    adapterContext: {
      ...ctx.adapterContext,
      ...(ctx.adapterContext.pickTask
        ? { pickTask: { ...ctx.adapterContext.pickTask } }
        : {}),
      ...(ctx.adapterContext.intakeDraft
        ? { intakeDraft: { ...ctx.adapterContext.intakeDraft } }
        : {}),
      ...(ctx.adapterContext.trackingEvidence
        ? { trackingEvidence: { ...ctx.adapterContext.trackingEvidence } }
        : {}),
    },
  };
}

function offline(): WorkflowScanDecision {
  return {
    outcome: "BLOCKED",
    reasonCode: "OFFLINE_VALIDATION_UNAVAILABLE",
    nextAction: "STOP_SCANNER",
  };
}

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
