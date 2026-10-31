import { useCallback, useEffect, useRef, useState } from "react";
import type { BarcodeDecodeObservation } from "../lib/scanning/capture/BarcodeDecodeObservation";
import { useBarcodeScanner } from "./useBarcodeScanner";
import type { WorkflowScanDecision } from "../lib/scanning/workflow/contracts/WorkflowScanDecision";
import type { WorkflowScanCoordinatorContext } from "../lib/scanning/workflow/coordinator/WorkflowScanCoordinator";
import { WorkflowScanCoordinator } from "../lib/scanning/workflow/coordinator/WorkflowScanCoordinator";

export interface UseWarehouseWorkflowScannerOptions {
  coordinator: WorkflowScanCoordinator;
  context: WorkflowScanCoordinatorContext;
}

export function useWarehouseWorkflowScanner(
  options: UseWarehouseWorkflowScannerOptions,
) {
  const scanner = useBarcodeScanner();
  const [decision, setDecision] = useState<WorkflowScanDecision | null>(null);
  const [captureState, setCaptureState] =
    useState<"IDLE" | "CAPTURED" | "VALIDATING" | "WAREHOUSE_ACCEPTED" | "RECONCILING" | "BLOCKED">("IDLE");
  const submittedObservation = useRef<string | null>(null);

  useEffect(() => {
    const observation = scanner.observation;
    if (!observation || submittedObservation.current === observation.observationId) return;

    submittedObservation.current = observation.observationId;
    setCaptureState("CAPTURED");

    void (async () => {
      setCaptureState("VALIDATING");
      const next = await options.coordinator.onObservation(observation, options.context);
      setDecision(next);
      setCaptureState(
        next.outcome === "ACCEPTED"
          ? "WAREHOUSE_ACCEPTED"
          : next.outcome === "RECONCILING"
          ? "RECONCILING"
          : "BLOCKED",
      );
    })();
  }, [scanner.observation, options]);

  const retry = useCallback(async () => {
    const observation: BarcodeDecodeObservation | null = scanner.observation;
    if (!observation) return;
    setCaptureState("RECONCILING");
    const next = await options.coordinator.retry(observation, options.context);
    setDecision(next);
    setCaptureState(next.outcome === "ACCEPTED" ? "WAREHOUSE_ACCEPTED" : next.outcome === "RECONCILING" ? "RECONCILING" : "BLOCKED");
  }, [scanner.observation, options]);

  return { ...scanner, decision, captureState, retry };
}
