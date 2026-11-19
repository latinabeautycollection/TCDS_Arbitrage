import React from "react";
import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PackShipTask } from "../../src/features/packShip/types/packShipTypes";
import type { WorkflowScanDecision } from "../../src/lib/scanning/workflow/contracts/WorkflowScanDecision";

const hookCalls: Array<{ context: any; scanner: any }> = [];
let nextDecision: WorkflowScanDecision | null = null;

vi.mock("../../src/hooks/useWarehouseWorkflowScanner", () => ({
  useWarehouseWorkflowScanner: (options: any) => {
    const scanner = {
      viewportRef: vi.fn(),
      status: {
        phase: "STOPPED",
        permission: "GRANTED",
        provider: "test",
        cameraOn: false,
        captureEnabled: false,
        viewAttached: false,
        torchAvailable: false,
        torchOn: false,
        zoomAvailable: false,
        backgroundSuspended: false,
        lastChangedAt: "2026-11-12T00:00:00Z",
      },
      runtimeStatus: {} as any,
      providerMetadata: null,
      observation: null,
      decision: nextDecision,
      captureState: "IDLE",
      retryAvailable: false,
      begin: vi.fn(async () => undefined),
      retry: vi.fn(async () => undefined),
      start: vi.fn(async () => undefined),
      pause: vi.fn(async () => undefined),
      resume: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
      setTorch: vi.fn(async () => undefined),
      clearObservation: vi.fn(),
    };
    hookCalls.push({ context: options.context, scanner });
    return scanner;
  },
}));

import { PackShipScannerPanel } from "../../src/features/packShip/components/PackShipScannerPanel";

function task(overrides: Partial<PackShipTask> = {}): PackShipTask {
  return {
    taskId: "T1",
    taskNumber: "PACK-1",
    orderId: "O1",
    orderNumber: "ORDER-1",
    shipmentId: "S1",
    facilityCode: "LV2TEST",
    stationCode: "PACK-01",
    employeeName: "Operator",
    claimExpiresAt: "2026-11-12T12:00:00Z",
    rowVersion: 7,
    stage: "CONTENTS",
    sourceBarcode: "PACK-STAGE-1",
    sourceVerified: true,
    items: [{ itemId: "I1", internalBarcode: "TCDS-I1", title: "Item", quantity: 1, verified: false }],
    packageBarcode: "PKG-1",
    itemLabelStatus: "VERIFIED",
    measurement: { source: "MEASURED", stable: true, weightLb: 1, lengthIn: 1, widthIn: 1, heightIn: 1 },
    evidence: { required: 0, accepted: 0, pending: 0, rejected: 0, integrityVerified: true },
    sealed: true,
    address: { status: "VALIDATED" },
    protection: { declaredValue: 100, insuranceRequired: false, deliveryConfirmationRequired: false, signatureRequired: false, restrictedDeliveryRequired: false, routing: "AUTO_APPROVE", reasons: [] },
    rates: [],
    carrierLabel: { status: "PRINTED", trackingNumber: "1Z999", printJobId: "PJ1" },
    readiness: { api: "READY", postgres: "READY", scanner: "READY", scale: "READY", printer: "READY", gateway: "READY", network: "READY" },
    completionGates: [],
    localPendingCount: 0,
    lastUpdatedAt: "2026-11-12T00:00:00Z",
    ...overrides,
  };
}

const authority = { resolveIntentPolicy: vi.fn(async () => ({})) } as any;

beforeEach(() => {
  hookCalls.length = 0;
  nextDecision = null;
  vi.stubEnv("VITE_SCANDIT_WORKFLOW_PACK_SHIP", "true");
});

describe("Pack/Ship scanner keyed profile lifecycle", () => {
  it("unmounts/stops the prior scanner when authoritative state changes capture context", async () => {
    const baseProps = {
      capturePolicyAuthority: authority,
      onTaskUpdate: vi.fn(),
      onRefresh: vi.fn(async () => undefined),
      onError: vi.fn(),
    };

    const { rerender } = render(<PackShipScannerPanel {...baseProps} task={task()} />);
    expect(hookCalls[hookCalls.length - 1]?.context.workflowStep).toBe("PACK_ITEM");
    const itemScanner = hookCalls[hookCalls.length - 1]!.scanner;

    rerender(
      <PackShipScannerPanel
        {...baseProps}
        task={task({ items: [{ itemId: "I1", internalBarcode: "TCDS-I1", title: "Item", quantity: 1, verified: true }] })}
      />,
    );

    await waitFor(() => expect(hookCalls[hookCalls.length - 1]?.context.workflowStep).toBe("PACK_TRACKING_LABEL"));
    expect(itemScanner.stop).toHaveBeenCalled();
    const trackingScanner = hookCalls[hookCalls.length - 1]!.scanner;

    nextDecision = {
      outcome: "ACCEPTED",
      reasonCode: "TRACKING_SCAN_CAPTURED",
      nextAction: "PAUSE_FOR_DOMAIN_STEP",
      result: {
        trackingBarcode: "1Z999",
        labelPairId: "11111111-1111-4111-8111-111111111111",
        observationId: "OBS-T",
        capturedAt: "2026-11-12T00:00:00Z",
        provider: "scandit",
        symbology: "CODE128",
        trackingClientOperationId: "11111111-1111-4111-8111-111111111111",
        trackingCorrelationId: "22222222-2222-4222-8222-222222222222",
      },
    };

    rerender(
      <PackShipScannerPanel
        {...baseProps}
        task={task({ items: [{ itemId: "I1", internalBarcode: "TCDS-I1", title: "Item", quantity: 1, verified: true }] })}
      />,
    );

    await waitFor(() => expect(hookCalls[hookCalls.length - 1]?.context.workflowStep).toBe("PACK_PACKAGE"));
    expect(trackingScanner.stop).toHaveBeenCalled();
    expect(hookCalls[hookCalls.length - 1]?.context.adapterContext.trackingEvidence?.observationId).toBe("OBS-T");
  });
});
