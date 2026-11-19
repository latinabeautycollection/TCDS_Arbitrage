import { describe, expect, it, vi } from "vitest";
import { ProductionWorkflowAdapter } from "../../src/lib/scanning/workflow/adapters/ProductionWorkflowAdapter";
import type { WorkflowPortSet } from "../../src/lib/scanning/workflow/adapters/WorkflowPorts";
import type { WarehouseScanEnvelope } from "../../src/lib/scanning/workflow/contracts/WarehouseScanEnvelope";
import type { PhysicalTrackingEvidence } from "../../src/features/packShip/scanning/packShipLabelEvidence";

function envelope(step: string, intent: string, rawValue: string, operationId: string, correlationId: string, observationId: string): WarehouseScanEnvelope {
  return {
    observation: {
      observationId,
      provider: "scandit",
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
    clientOperationId: operationId,
    correlationId,
    workflow: "PACKING",
    workflowEntityId: "T1",
    workflowStep: step,
    captureSource: "SCANDIT_WEB",
    workflowContractVersion: "6.2D.2",
  };
}

function ports() {
  const verifyLabel = vi.fn(async () => ({ taskId: "T1", rowVersion: 9, lastUpdatedAt: "2026-11-12T00:00:01Z" }));
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

describe("two-physical-scan deterministic evidence lineage", () => {
  it("binds both physical observations to one labelPairId and forwards both operation/correlation identities", async () => {
    const p = ports();
    const adapter = new ProductionWorkflowAdapter(p.set);
    const trackingEnvelope = envelope(
      "PACK_TRACKING_LABEL",
      "TRACKING_NUMBER",
      "1Z999",
      "11111111-1111-4111-8111-111111111111",
      "22222222-2222-4222-8222-222222222222",
      "OBS-TRACK",
    );
    const trackingDecision = await adapter.submit(trackingEnvelope, { shipmentId: "S1" });
    const result = trackingDecision.result as PhysicalTrackingEvidence & { trackingBarcode: string };

    const trackingEvidence: PhysicalTrackingEvidence = {
      labelPairId: result.labelPairId,
      barcode: result.trackingBarcode,
      observationId: result.observationId,
      capturedAt: result.capturedAt,
      provider: result.provider,
      symbology: result.symbology,
      trackingClientOperationId: result.trackingClientOperationId,
      trackingCorrelationId: result.trackingCorrelationId,
    };

    await adapter.submit(
      envelope(
        "PACK_PACKAGE",
        "PACKAGE_ID",
        "PKG-77",
        "33333333-3333-4333-8333-333333333333",
        "44444444-4444-4444-8444-444444444444",
        "OBS-PACKAGE",
      ),
      { shipmentId: "S1", trackingBarcode: "1Z999", trackingEvidence },
    );

    expect(p.verifyLabel).toHaveBeenCalledTimes(1);
    const evidence = p.verifyLabel.mock.calls[0]?.[4];
    expect(evidence).toMatchObject({
      labelPairId: trackingEnvelope.clientOperationId,
      tracking: {
        observationId: "OBS-TRACK",
        trackingClientOperationId: trackingEnvelope.clientOperationId,
        trackingCorrelationId: trackingEnvelope.correlationId,
      },
      package: {
        observationId: "OBS-PACKAGE",
        packageClientOperationId: "33333333-3333-4333-8333-333333333333",
        packageCorrelationId: "44444444-4444-4444-8444-444444444444",
      },
    });
  });
});
