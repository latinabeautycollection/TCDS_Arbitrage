import { describe, expect, it, vi } from "vitest";
import { WorkflowScanCoordinator, type WorkflowScanCoordinatorContext } from "../../src/lib/scanning/workflow/coordinator/WorkflowScanCoordinator";
import type { BarcodeDecodeObservation } from "../../src/lib/scanning/capture/BarcodeDecodeObservation";
import type { CapturePolicyAuthority } from "../../src/lib/scanning/workflow/policy/CapturePolicyAuthority";

const observation: BarcodeDecodeObservation = {
  observationId: "OBS-1",
  provider: "test",
  rawValue: "ITEM-1",
  symbology: "CODE128",
  capturedAt: "2026-11-12T00:00:00Z",
};

function context(rowVersion: number): WorkflowScanCoordinatorContext {
  return {
    workflow: "PACKING",
    workflowEntityId: "T1",
    workflowStep: "PACK_ITEM",
    captureIntent: {
      intent: "ITEM_ID",
      mode: "SINGLE",
      allowedSymbologies: ["CODE128"],
      allowManualFallback: true,
    },
    captureSource: "SCANDIT_WEB",
    adapterContext: { rowVersion },
  };
}

describe("6.2D uncertain retry payload integrity", () => {
  it("reuses the original rowVersion even if the UI context later refreshes", async () => {
    const calls: number[] = [];
    const adapter = {
      submit: vi.fn(async (_envelope: unknown, ctx: { rowVersion?: number }) => {
        calls.push(ctx.rowVersion ?? -1);
        if (calls.length === 1) throw new TypeError("Failed to fetch");
        return { outcome: "ACCEPTED", reasonCode: "SCAN_ACCEPTED", nextAction: "PAUSE_FOR_DOMAIN_STEP" };
      }),
    };
    const scanner = { pause: vi.fn(async () => undefined), resume: vi.fn(async () => undefined), start: vi.fn(async () => undefined) };
    const policy = { resolveIntentPolicy: vi.fn(async () => ({})) } as unknown as CapturePolicyAuthority;
    const coordinator = new WorkflowScanCoordinator(scanner, policy, adapter as never, () => true);

    expect(await coordinator.onObservation(observation, context(7))).toMatchObject({ outcome: "RECONCILING" });
    expect(await coordinator.retry(context(8))).toMatchObject({ outcome: "ACCEPTED" });
    expect(calls).toEqual([7, 7]);
  });

  it("refuses to start a new capture while an uncertain operation remains", async () => {
    const adapter = { submit: vi.fn(async () => { throw new TypeError("Failed to fetch"); }) };
    const scanner = { pause: vi.fn(async () => undefined), resume: vi.fn(async () => undefined), start: vi.fn(async () => undefined) };
    const policy = { resolveIntentPolicy: vi.fn(async () => ({})) } as unknown as CapturePolicyAuthority;
    const coordinator = new WorkflowScanCoordinator(scanner, policy, adapter as never, () => true);
    await coordinator.onObservation(observation, context(7));
    await expect(coordinator.begin(context(7))).rejects.toThrow("PENDING_SCAN_UNRESOLVED");
  });
});
