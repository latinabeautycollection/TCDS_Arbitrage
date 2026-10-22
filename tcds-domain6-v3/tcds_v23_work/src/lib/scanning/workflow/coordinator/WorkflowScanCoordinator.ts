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

export class WorkflowScanCoordinator {
  private operation: WarehouseClientOperation | null = null;

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

  async onObservation(
    observation: BarcodeDecodeObservation,
    ctx: WorkflowScanCoordinatorContext,
  ): Promise<WorkflowScanDecision> {
    await this.scanner.pause();

    if (!this.isOnline()) {
      return {
        outcome: "BLOCKED",
        reasonCode: "OFFLINE_VALIDATION_UNAVAILABLE",
        nextAction: "STOP_SCANNER",
      };
    }

    if (!ctx.captureIntent.allowedSymbologies.includes(observation.symbology)) {
      return {
        outcome: "BLOCKED",
        reasonCode: "INVALID_CAPTURE_INTENT",
        nextAction: "STOP_SCANNER",
      };
    }

    // Operation is created ONCE and retained through timeout/reconciliation retry.
    this.operation ??= createWarehouseClientOperation();

    const envelope: WarehouseScanEnvelope = {
      observation,
      captureIntent: ctx.captureIntent,
      clientOperationId: this.operation.clientOperationId,
      correlationId: this.operation.correlationId,
      workflow: ctx.workflow,
      workflowEntityId: ctx.workflowEntityId,
      workflowStep: ctx.workflowStep,
      captureSource: ctx.captureSource,
      workflowContractVersion: "6.2D.2",
      ...(ctx.adapterContext.rowVersion !== undefined
        ? { expectedRowVersion: ctx.adapterContext.rowVersion }
        : {}),
    };

    try {
      const decision = await this.workflowAdapter.submit(envelope, ctx.adapterContext);
      if (decision.outcome !== "RECONCILING") this.operation = null;
      return decision;
    } catch (error) {
      if (isUncertainTransportFailure(error)) {
        return {
          outcome: "RECONCILING",
          reasonCode: "RECONCILIATION_REQUIRED",
          nextAction: "RECONCILE",
        };
      }
      this.operation = null;
      throw error;
    }
  }

  async retry(
    observation: BarcodeDecodeObservation,
    ctx: WorkflowScanCoordinatorContext,
  ): Promise<WorkflowScanDecision> {
    // Retains the same operation identity until the server gives a conclusive result.
    return this.onObservation(observation, ctx);
  }

  clearOperation(): void {
    this.operation = null;
  }
}

function isUncertainTransportFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return [
    "REQUEST_TIMEOUT",
    "NETWORK_ERROR",
    "NETWORK_UNAVAILABLE",
    "RETURN_API_UNAVAILABLE",
  ].includes(error.message);
}
