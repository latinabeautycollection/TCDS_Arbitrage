import { describe, expect, it, vi } from "vitest";

import { ProductionWorkflowAdapter } from "../../src/lib/scanning/workflow/adapters/ProductionWorkflowAdapter";
import type { WorkflowPortSet } from "../../src/lib/scanning/workflow/adapters/WorkflowPorts";
import type { WarehouseScanEnvelope } from "../../src/lib/scanning/workflow/contracts/WarehouseScanEnvelope";
import { captureContextFor } from "../../src/lib/scanning/workflow/policy/CapturePolicyAuthority";

function envelope(step: string, intent: string, rawValue: string): WarehouseScanEnvelope {
  return {
    observation: {
      observationId: crypto.randomUUID(),
      provider: "test",
      rawValue,
      symbology: "CODE128",
      capturedAt: "2026-11-12T00:00:00Z",
    },
    captureIntent: {
      intent: intent as never,
      mode: "SINGLE",
      allowedSymbologies: ["CODE128"],
      allowManualFallback: true,
    },
    clientOperationId: crypto.randomUUID(),
    correlationId: crypto.randomUUID(),
    workflow: "PACKING",
    workflowEntityId: "T1",
    workflowStep: step,
    captureSource: "SCANDIT_WEB",
    workflowContractVersion: "6.2D.2",
  };
}

function ports() {
  const verifyLabel = vi.fn(async () => ({ taskId: "T1", rowVersion: 9, lastUpdatedAt: "2026-11-12T00:00:00Z" }));
  const noop = vi.fn(async () => ({}));
  return {
    verifyLabel,
    set: {
      receiving: { matchPackage: noop, createCandidate: noop, validateCandidate: noop, verifyCandidate: noop },
      putaway: { scanItem: noop, scanLocation: noop },
      picking: { scanLocation: noop, scanItem: noop, scanDestination: noop },
      packShip: { scanSource: noop, scanItem: noop, verifyLabel, stageOutbound: noop },
      inventory: { resolveScan: noop },
      returns: { resolveScan: noop },
    } as unknown as WorkflowPortSet,
  };
}

describe("final Pack/Ship physical label proof", () => {
  it("maps the two physical steps to distinct certified 6.2C contexts", () => {
    expect(captureContextFor("PACKING", "PACK_TRACKING_LABEL", "TRACKING_NUMBER")).toBe("TRACKING_LABEL");
    expect(captureContextFor("PACKING", "PACK_PACKAGE", "PACKAGE_ID")).toBe("PACK_PACKAGE");
  });

  it("removes the legacy one-step PACK_VERIFY_LABEL mapping", () => {
    expect(captureContextFor("PACKING", "PACK_VERIFY_LABEL", "TRACKING_NUMBER")).toBeNull();
  });

  it("captures tracking without any business mutation", async () => {
    const p = ports();
    const adapter = new ProductionWorkflowAdapter(p.set);
    const result = await adapter.submit(
      envelope("PACK_TRACKING_LABEL", "TRACKING_NUMBER", "1Z999"),
      { shipmentId: "S1" },
    );

    expect(result).toMatchObject({
      outcome: "ACCEPTED",
      reasonCode: "TRACKING_SCAN_CAPTURED",
      result: { trackingBarcode: "1Z999" },
    });
    expect(p.verifyLabel).not.toHaveBeenCalled();
  });

  it("calls authoritative verifyLabel only after the physical package scan", async () => {
    const p = ports();
    const adapter = new ProductionWorkflowAdapter(p.set);
    const first = await adapter.submit(
      envelope("PACK_TRACKING_LABEL", "TRACKING_NUMBER", "1Z999"),
      { shipmentId: "S1" },
    );
    const r = first.result as any;
    await adapter.submit(
      envelope("PACK_PACKAGE", "PACKAGE_ID", "PKG-77"),
      {
        shipmentId: "S1",
        trackingBarcode: "1Z999",
        trackingEvidence: {
          labelPairId: r.labelPairId,
          barcode: r.trackingBarcode,
          observationId: r.observationId,
          capturedAt: r.capturedAt,
          provider: r.provider,
          symbology: r.symbology,
          trackingClientOperationId: r.trackingClientOperationId,
          trackingCorrelationId: r.trackingCorrelationId,
        },
      },
    );

    expect(p.verifyLabel).toHaveBeenCalledTimes(1);
    expect(p.verifyLabel.mock.calls[0]?.slice(0, 3)).toEqual(["S1", "1Z999", "PKG-77"]);
    expect(p.verifyLabel.mock.calls[0]?.[4]).toMatchObject({
      labelPairId: r.labelPairId,
      tracking: { observationId: r.observationId },
    });
  });

  it("fails closed if package scan is attempted without the physical tracking half", async () => {
    const p = ports();
    const adapter = new ProductionWorkflowAdapter(p.set);
    const result = await adapter.submit(
      envelope("PACK_PACKAGE", "PACKAGE_ID", "PKG-77"),
      { shipmentId: "S1" },
    );

    expect(result).toMatchObject({ outcome: "BLOCKED", reasonCode: "LABEL_CONTEXT_REQUIRED" });
    expect(p.verifyLabel).not.toHaveBeenCalled();
  });

  it("fails closed on the removed legacy one-step route", async () => {
    const p = ports();
    const adapter = new ProductionWorkflowAdapter(p.set);
    const result = await adapter.submit(
      envelope("PACK_VERIFY_LABEL", "TRACKING_NUMBER", "1Z999"),
      { shipmentId: "S1" },
    );
    expect(result).toMatchObject({ outcome: "BLOCKED", reasonCode: "INVALID_WORKFLOW_STEP" });
    expect(p.verifyLabel).not.toHaveBeenCalled();
  });
});
