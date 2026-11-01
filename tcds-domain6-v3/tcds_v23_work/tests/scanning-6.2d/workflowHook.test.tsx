import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { BarcodeDecodeObservation } from "../../src/lib/scanning/capture/BarcodeDecodeObservation";
import type { WorkflowScanCoordinator, WorkflowScanCoordinatorContext } from "../../src/lib/scanning/workflow/coordinator/WorkflowScanCoordinator";
import type { WorkflowScanDecision } from "../../src/lib/scanning/workflow/contracts/WorkflowScanDecision";

const scannerState = vi.hoisted(() => ({
  observation: null as BarcodeDecodeObservation | null,
  status: {},
  start: vi.fn(async () => {}),
  pause: vi.fn(async () => {}),
  resume: vi.fn(async () => {}),
  stop: vi.fn(async () => {}),
}));
vi.mock("../../src/hooks/useBarcodeScanner", () => ({ useBarcodeScanner: () => scannerState }));

import { useWarehouseWorkflowScanner } from "../../src/hooks/useWarehouseWorkflowScanner";

const context = {
  workflow: "PICKING",
  workflowEntityId: "T1",
  workflowStep: "SCAN_ITEM",
  captureIntent: { intent: "ITEM_ID", mode: "SINGLE", allowedSymbologies: ["CODE128"], allowManualFallback: false },
  captureSource: "SCANDIT_WEB",
  adapterContext: {},
} as unknown as WorkflowScanCoordinatorContext;

const scan = (id: string): BarcodeDecodeObservation =>
  ({ observationId: id, provider: "test", rawValue: id, symbology: "CODE128", capturedAt: "2026-10-31T00:00:00.000Z" }) as BarcodeDecodeObservation;

function coordinatorReturning(result: Promise<WorkflowScanDecision>) {
  return {
    begin: vi.fn(async () => {}),
    onObservation: vi.fn(() => result),
    retry: vi.fn(async (): Promise<WorkflowScanDecision> => ({ outcome: "ACCEPTED", reasonCode: "OK", nextAction: "PAUSE_FOR_DOMAIN_STEP" })),
  } as unknown as WorkflowScanCoordinator & { onObservation: ReturnType<typeof vi.fn>; retry: ReturnType<typeof vi.fn> };
}

beforeEach(() => {
  scannerState.observation = null;
  scannerState.resume.mockClear();
  scannerState.pause.mockClear();
  scannerState.start.mockClear();
});

describe("6.2D workflow hook", () => {
  it("never stays on VALIDATING when the coordinator throws", async () => {
    const coordinator = coordinatorReturning(Promise.reject(new Error("UNEXPECTED")));
    const options = { createCoordinator: () => coordinator, context };
    const { result, rerender } = renderHook(() => useWarehouseWorkflowScanner(options));

    scannerState.observation = scan("SKU-1");
    rerender();

    await waitFor(() => expect(result.current.captureState).toBe("BLOCKED"));
    expect(result.current.decision).toMatchObject({ outcome: "BLOCKED", reasonCode: "UNEXPECTED" });
  });

  it("resumes the scanner when the decision says to scan again", async () => {
    const coordinator = coordinatorReturning(
      Promise.resolve({ outcome: "REJECTED", reasonCode: "WRONG_ITEM", nextAction: "RESUME_SAME_PROFILE" }),
    );
    const options = { createCoordinator: () => coordinator, context };
    const { result, rerender } = renderHook(() => useWarehouseWorkflowScanner(options));

    scannerState.observation = scan("SKU-X");
    rerender();

    await waitFor(() => expect(result.current.decision?.reasonCode).toBe("WRONG_ITEM"));
    expect(scannerState.resume).toHaveBeenCalledTimes(1);
  });

  it("reports an accepted scan and leaves the scanner paused for the next domain step", async () => {
    const coordinator = coordinatorReturning(
      Promise.resolve({ outcome: "ACCEPTED", reasonCode: "SCAN_ACCEPTED", nextAction: "PAUSE_FOR_DOMAIN_STEP" }),
    );
    const options = { createCoordinator: () => coordinator, context };
    const { result, rerender } = renderHook(() => useWarehouseWorkflowScanner(options));

    scannerState.observation = scan("SKU-1");
    rerender();

    await waitFor(() => expect(result.current.captureState).toBe("WAREHOUSE_ACCEPTED"));
    expect(scannerState.resume).not.toHaveBeenCalled();
  });

  it("submits each observation once", async () => {
    const coordinator = coordinatorReturning(
      Promise.resolve({ outcome: "ACCEPTED", reasonCode: "SCAN_ACCEPTED", nextAction: "PAUSE_FOR_DOMAIN_STEP" }),
    );
    const options = { createCoordinator: () => coordinator, context };
    const { rerender } = renderHook(() => useWarehouseWorkflowScanner(options));

    scannerState.observation = scan("SKU-1");
    rerender();
    rerender();

    await waitFor(() => expect(coordinator.onObservation).toHaveBeenCalledTimes(1));
  });

  it("retries through the coordinator's pending scan", async () => {
    const coordinator = coordinatorReturning(Promise.resolve({ outcome: "RECONCILING", reasonCode: "R", nextAction: "RECONCILE" }));
    const options = { createCoordinator: () => coordinator, context };
    const { result } = renderHook(() => useWarehouseWorkflowScanner(options));

    await act(async () => { await result.current.retry(); });

    expect(coordinator.retry).toHaveBeenCalledWith(context);
    expect(result.current.captureState).toBe("WAREHOUSE_ACCEPTED");
  });
});

describe("6.2D workflow hook owns the scanner session", () => {
  it("builds the coordinator around the hook's own scanner", async () => {
    let control: { pause(): Promise<void>; start(o: never): Promise<void> } | undefined;
    const coordinator = coordinatorReturning(Promise.resolve({ outcome: "ACCEPTED", reasonCode: "OK", nextAction: "PAUSE_FOR_DOMAIN_STEP" }));
    renderHook(() => useWarehouseWorkflowScanner({
      createCoordinator: (scanner) => { control = scanner as never; return coordinator; },
      context,
    }));

    await control!.pause();
    await control!.start({ executionPolicy: {} } as never);

    expect(scannerState.pause).toHaveBeenCalledTimes(1);
    expect(scannerState.start).toHaveBeenCalledWith({ executionPolicy: {} });
  });

  it("builds the coordinator once, not on every render", () => {
    const create = vi.fn(() => coordinatorReturning(Promise.resolve({ outcome: "ACCEPTED", reasonCode: "OK", nextAction: "PAUSE_FOR_DOMAIN_STEP" })));
    const { rerender } = renderHook(() => useWarehouseWorkflowScanner({ createCoordinator: create, context }));
    rerender();
    rerender();

    expect(create).toHaveBeenCalledTimes(1);
  });

  it("reports a refused capture policy as a blocked decision instead of throwing", async () => {
    const coordinator = coordinatorReturning(Promise.resolve({ outcome: "ACCEPTED", reasonCode: "OK", nextAction: "PAUSE_FOR_DOMAIN_STEP" }));
    (coordinator as unknown as { begin: ReturnType<typeof vi.fn> }).begin.mockRejectedValueOnce(new Error("INTERIM_POLICY_NOT_PERMITTED"));
    const { result } = renderHook(() => useWarehouseWorkflowScanner({ createCoordinator: () => coordinator, context }));

    await act(async () => { await result.current.begin(); });

    expect(result.current.captureState).toBe("BLOCKED");
    expect(result.current.decision).toMatchObject({ reasonCode: "INTERIM_POLICY_NOT_PERMITTED" });
  });
});
