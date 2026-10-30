import { useCallback, useEffect, useRef, useState } from "react";
import { useBarcodeScanner } from "./useBarcodeScanner";
import type { WorkflowScanDecision } from "../lib/scanning/workflow/contracts/WorkflowScanDecision";
import type { WorkflowScanCoordinatorContext } from "../lib/scanning/workflow/coordinator/WorkflowScanCoordinator";
import { WorkflowScanCoordinator } from "../lib/scanning/workflow/coordinator/WorkflowScanCoordinator";
import { classifyWorkflowFailure } from "../lib/scanning/workflow/adapters/workflowFailure";

export interface UseWarehouseWorkflowScannerOptions {
  coordinator: WorkflowScanCoordinator;
  context: WorkflowScanCoordinatorContext;
}

export type WorkflowCaptureState =
  | "IDLE"
  | "CAPTURED"
  | "VALIDATING"
  | "WAREHOUSE_ACCEPTED"
  | "RECONCILING"
  | "BLOCKED";

function captureStateFor(decision: WorkflowScanDecision): WorkflowCaptureState {
  if (decision.outcome === "ACCEPTED") return "WAREHOUSE_ACCEPTED";
  if (decision.outcome === "RECONCILING") return "RECONCILING";
  return "BLOCKED";
}

export function useWarehouseWorkflowScanner(
  options: UseWarehouseWorkflowScannerOptions,
) {
  const scanner = useBarcodeScanner();
  const scannerRef = useRef(scanner);
  scannerRef.current = scanner;

  const [decision, setDecision] = useState<WorkflowScanDecision | null>(null);
  const [captureState, setCaptureState] = useState<WorkflowCaptureState>("IDLE");
  const submittedObservation = useRef<string | null>(null);

  // Every path settles into a decision. Whatever the coordinator throws, the screen is
  // never left on VALIDATING with the scanner paused.
  const settle = useCallback(async (run: () => Promise<WorkflowScanDecision>) => {
    let next: WorkflowScanDecision;
    try {
      next = await run();
    } catch (error) {
      const failure = classifyWorkflowFailure(error);
      next = { outcome: "BLOCKED", reasonCode: failure.code, nextAction: "STOP_SCANNER", result: failure };
    }
    setDecision(next);
    setCaptureState(captureStateFor(next));
    if (next.nextAction === "RESUME_SAME_PROFILE") {
      await scannerRef.current.resume().catch(() => undefined);
    }
  }, []);

  useEffect(() => {
    const observation = scanner.observation;
    if (!observation || submittedObservation.current === observation.observationId) return;

    submittedObservation.current = observation.observationId;
    setCaptureState("CAPTURED");
    setCaptureState("VALIDATING");
    void settle(() => options.coordinator.onObservation(observation, options.context));
  }, [scanner.observation, options, settle]);

  // A retry always targets the scan whose outcome is unknown, not whatever was scanned last.
  const retry = useCallback(async () => {
    setCaptureState("RECONCILING");
    await settle(() => options.coordinator.retry(options.context));
  }, [options, settle]);

  return { ...scanner, decision, captureState, retry };
}
