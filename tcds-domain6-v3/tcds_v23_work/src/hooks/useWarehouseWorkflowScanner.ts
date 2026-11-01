import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useBarcodeScanner } from "./useBarcodeScanner";
import type { WorkflowScanDecision } from "../lib/scanning/workflow/contracts/WorkflowScanDecision";
import type {
  ScannerControl,
  WorkflowScanCoordinator,
  WorkflowScanCoordinatorContext,
} from "../lib/scanning/workflow/coordinator/WorkflowScanCoordinator";
import { classifyWorkflowFailure } from "../lib/scanning/workflow/adapters/workflowFailure";

export interface UseWarehouseWorkflowScannerOptions {
  /**
   * Builds the coordinator around this hook's own scanner. The capture session belongs
   * to the hook that started it, so the coordinator must drive that same session.
   */
  createCoordinator: (scanner: ScannerControl) => WorkflowScanCoordinator;
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

function blockedBy(error: unknown): WorkflowScanDecision {
  const failure = classifyWorkflowFailure(error);
  return { outcome: "BLOCKED", reasonCode: failure.code, nextAction: "STOP_SCANNER", result: failure };
}

export function useWarehouseWorkflowScanner(
  options: UseWarehouseWorkflowScannerOptions,
) {
  const scanner = useBarcodeScanner();
  const scannerRef = useRef(scanner);
  scannerRef.current = scanner;

  const contextRef = useRef(options.context);
  contextRef.current = options.context;

  const control = useMemo<ScannerControl>(() => ({
    pause: () => scannerRef.current.pause(),
    resume: () => scannerRef.current.resume(),
    start: (startOptions) => scannerRef.current.start(startOptions),
  }), []);

  const coordinatorRef = useRef<WorkflowScanCoordinator | null>(null);
  if (!coordinatorRef.current) coordinatorRef.current = options.createCoordinator(control);
  const coordinator = coordinatorRef.current;

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
      next = blockedBy(error);
    }
    setDecision(next);
    setCaptureState(captureStateFor(next));
    if (next.nextAction === "RESUME_SAME_PROFILE") {
      await scannerRef.current.resume().catch(() => undefined);
    }
  }, []);

  /** Resolves the capture policy and starts the camera. A refused policy is a decision. */
  const begin = useCallback(async () => {
    setDecision(null);
    setCaptureState("IDLE");
    try {
      await coordinator.begin(contextRef.current);
    } catch (error) {
      const next = blockedBy(error);
      setDecision(next);
      setCaptureState("BLOCKED");
    }
  }, [coordinator]);

  useEffect(() => {
    const observation = scanner.observation;
    if (!observation || submittedObservation.current === observation.observationId) return;

    submittedObservation.current = observation.observationId;
    setCaptureState("VALIDATING");
    void settle(() => coordinator.onObservation(observation, contextRef.current));
  }, [scanner.observation, coordinator, settle]);

  // A retry always targets the scan whose outcome is unknown, not whatever was scanned last.
  const retry = useCallback(async () => {
    setCaptureState("RECONCILING");
    await settle(() => coordinator.retry(contextRef.current));
  }, [coordinator, settle]);

  return { ...scanner, decision, captureState, begin, retry };
}
