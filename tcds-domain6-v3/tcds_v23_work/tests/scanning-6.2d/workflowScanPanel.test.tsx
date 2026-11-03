import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { BarcodeDecodeObservation } from "../../src/lib/scanning/capture/BarcodeDecodeObservation";
import { WorkflowScanCoordinator, type WorkflowScanCoordinatorContext } from "../../src/lib/scanning/workflow/coordinator/WorkflowScanCoordinator";
import type { WorkflowScanDecision } from "../../src/lib/scanning/workflow/contracts/WorkflowScanDecision";
import type { CapturePolicyAuthority } from "../../src/lib/scanning/workflow/policy/CapturePolicyAuthority";
import type { ProductionWorkflowAdapter } from "../../src/lib/scanning/workflow/adapters/ProductionWorkflowAdapter";

const scannerState = vi.hoisted(() => ({
  observation: null as BarcodeDecodeObservation | null,
  status: { phase: "IDLE", permission: "PROMPT" },
  viewportRef: vi.fn(),
  start: vi.fn(async () => {}),
  pause: vi.fn(async () => {}),
  resume: vi.fn(async () => {}),
  stop: vi.fn(async () => {}),
}));
vi.mock("../../src/hooks/useBarcodeScanner", () => ({ useBarcodeScanner: () => scannerState }));

import { WorkflowScanPanel } from "../../src/components/scanning/workflow/WorkflowScanPanel";

const context = { workflow: "INVENTORY", workflowEntityId: "INVENTORY_LOOKUP", workflowStep: "LOOKUP", captureIntent: { intent: "ITEM_ID", mode: "SINGLE", allowedSymbologies: ["CODE128"], allowManualFallback: true }, captureSource: "SCANDIT_WEB", adapterContext: {} } as unknown as WorkflowScanCoordinatorContext;

const scan = (id: string): BarcodeDecodeObservation =>
  ({ observationId: id, provider: "test", rawValue: id, symbology: "CODE128", capturedAt: "2026-11-01T00:00:00.000Z" }) as BarcodeDecodeObservation;

function coordinatorDeciding(decision: WorkflowScanDecision) {
  return {
    begin: vi.fn(async () => {}),
    onObservation: vi.fn(async () => decision),
    retry: vi.fn(async () => decision),
  } as unknown as WorkflowScanCoordinator & { begin: ReturnType<typeof vi.fn> };
}

beforeEach(() => {
  scannerState.observation = null;
  scannerState.stop.mockClear();
  scannerState.start.mockClear();
});

describe("6.2D workflow scan panel", () => {
  it("shows no camera until asked, then starts it after the viewport is on the page", async () => {
    const coordinator = coordinatorDeciding({ outcome: "ACCEPTED", reasonCode: "SCAN_RESOLVED", nextAction: "PAUSE_FOR_DOMAIN_STEP" });
    render(<WorkflowScanPanel createCoordinator={() => coordinator} context={context} onAccepted={vi.fn()} />);

    expect(coordinator.begin).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Scan with camera" }));

    await waitFor(() => expect(coordinator.begin).toHaveBeenCalledTimes(1));
    expect(scannerState.viewportRef).toHaveBeenCalled();
  });

  it("hands an accepted scan to the screen once and stops the camera", async () => {
    const onAccepted = vi.fn();
    const decision: WorkflowScanDecision = { outcome: "ACCEPTED", reasonCode: "SCAN_RESOLVED", nextAction: "PAUSE_FOR_DOMAIN_STEP", result: { resolutionType: "ITEM", itemId: "I1" } };
    const coordinator = coordinatorDeciding(decision);
    const { rerender } = render(<WorkflowScanPanel createCoordinator={() => coordinator} context={context} onAccepted={onAccepted} />);
    fireEvent.click(screen.getByRole("button", { name: "Scan with camera" }));

    scannerState.observation = scan("SKU-1");
    rerender(<WorkflowScanPanel createCoordinator={() => coordinator} context={context} onAccepted={onAccepted} />);

    await waitFor(() => expect(onAccepted).toHaveBeenCalledTimes(1));
    expect(onAccepted).toHaveBeenCalledWith(decision);
    expect(scannerState.stop).toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole("button", { name: "Scan with camera" })).toBeTruthy());
    rerender(<WorkflowScanPanel createCoordinator={() => coordinator} context={context} onAccepted={onAccepted} />);
    expect(onAccepted).toHaveBeenCalledTimes(1);
  });

  it("offers Retry and explains why when the outcome is unknown", async () => {
    const coordinator = coordinatorDeciding({ outcome: "RECONCILING", reasonCode: "RECONCILIATION_REQUIRED", nextAction: "RECONCILE" });
    const { rerender } = render(<WorkflowScanPanel createCoordinator={() => coordinator} context={context} onAccepted={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Scan with camera" }));

    scannerState.observation = scan("SKU-1");
    rerender(<WorkflowScanPanel createCoordinator={() => coordinator} context={context} onAccepted={vi.fn()} />);

    await waitFor(() => expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy());
    expect(screen.getByRole("status").textContent).toMatch(/connection dropped/i);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Retry" })); });
    expect(coordinator.retry).toHaveBeenCalledWith(context);
  });

  it("explains a refused policy instead of failing silently", async () => {
    const coordinator = coordinatorDeciding({ outcome: "ACCEPTED", reasonCode: "OK", nextAction: "PAUSE_FOR_DOMAIN_STEP" });
    coordinator.begin.mockRejectedValueOnce(new Error("INTERIM_POLICY_NOT_PERMITTED"));
    render(<WorkflowScanPanel createCoordinator={() => coordinator} context={context} onAccepted={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Scan with camera" }));

    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/not enabled for this workflow/i));
  });
});

const policy = { resolveIntentPolicy: vi.fn(async () => ({})) } as unknown as CapturePolicyAuthority;
const timedOut = () => Object.assign(new Error("Request timed out"), { code: "REQUEST_TIMEOUT" });
const accepted: WorkflowScanDecision = { outcome: "ACCEPTED", reasonCode: "SCAN_RESOLVED", nextAction: "PAUSE_FOR_DOMAIN_STEP", result: { resolutionType: "ITEM", itemId: "I1" } };

function panelWithRealCoordinator(submit: ReturnType<typeof vi.fn>, onAccepted: () => void, online = () => true) {
  const adapter = { submit } as unknown as ProductionWorkflowAdapter;
  return (
    <WorkflowScanPanel
      createCoordinator={(scanner) => new WorkflowScanCoordinator(scanner, policy, adapter, online)}
      context={context}
      onAccepted={onAccepted}
    />
  );
}

describe("6.2D workflow scan panel retry", () => {
  it("keeps Retry while the first scan is unresolved, through a camera restart and a second barcode", async () => {
    const submit = vi.fn().mockRejectedValueOnce(timedOut()).mockResolvedValueOnce(accepted);
    const onAccepted = vi.fn();
    const { rerender } = render(panelWithRealCoordinator(submit, onAccepted));

    // Scan A, and the request times out.
    fireEvent.click(screen.getByRole("button", { name: "Scan with camera" }));
    await waitFor(() => expect(scannerState.start).toHaveBeenCalledTimes(1));
    scannerState.observation = scan("SKU-A");
    rerender(panelWithRealCoordinator(submit, onAccepted));
    await waitFor(() => expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy());

    // Stop the camera and start it again: scan A is still unresolved.
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Stop camera" })); });
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Scan with camera" }));
    await waitFor(() => expect(scannerState.start).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();

    // Scan B: it is held back, and the message and the button agree.
    scannerState.observation = scan("SKU-B");
    rerender(panelWithRealCoordinator(submit, onAccepted));
    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/finish the previous scan first\. tap retry/i));
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
    expect(submit).toHaveBeenCalledTimes(1);

    // Retry resolves scan A under its original operation, and the button goes away.
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Retry" })); });
    await waitFor(() => expect(onAccepted).toHaveBeenCalledTimes(1));
    expect(submit).toHaveBeenCalledTimes(2);
    expect(submit.mock.calls[1][0].observation.rawValue).toBe("SKU-A");
    expect(submit.mock.calls[1][0].clientOperationId).toBe(submit.mock.calls[0][0].clientOperationId);
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });

  it("keeps Retry when a retry is attempted offline", async () => {
    let online = true;
    const submit = vi.fn().mockRejectedValueOnce(timedOut()).mockResolvedValueOnce(accepted);
    const onAccepted = vi.fn();
    const { rerender } = render(panelWithRealCoordinator(submit, onAccepted, () => online));

    fireEvent.click(screen.getByRole("button", { name: "Scan with camera" }));
    await waitFor(() => expect(scannerState.start).toHaveBeenCalledTimes(1));
    scannerState.observation = scan("SKU-A");
    rerender(panelWithRealCoordinator(submit, onAccepted, () => online));
    await waitFor(() => expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy());

    online = false;
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Retry" })); });
    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/offline/i));
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();

    online = true;
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Retry" })); });
    await waitFor(() => expect(onAccepted).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });
});
