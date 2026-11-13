import { describe, expect, it } from "vitest";

import {
  derivePackShipScanPlan,
  packShipLabelPairScopeKey,
  type PendingTrackingProof,
} from "../../src/features/packShip/scanning/packShipScanPlan";
import type { PackShipTask } from "../../src/features/packShip/types/packShipTypes";

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
    sourceVerified: false,
    items: [{ itemId: "I1", internalBarcode: "TCDS-I1", title: "Item", quantity: 1, verified: false }],
    itemLabelStatus: "VERIFIED",
    measurement: { source: "PENDING", stable: false },
    evidence: { required: 0, accepted: 0, pending: 0, rejected: 0, integrityVerified: true },
    sealed: false,
    address: { status: "NOT_STARTED" },
    protection: {
      declaredValue: 100,
      insuranceRequired: false,
      deliveryConfirmationRequired: false,
      signatureRequired: false,
      restrictedDeliveryRequired: false,
      routing: "PENDING",
      reasons: [],
    },
    rates: [],
    carrierLabel: { status: "NOT_PURCHASED" },
    readiness: {
      api: "READY",
      postgres: "READY",
      scanner: "READY",
      scale: "READY",
      printer: "READY",
      gateway: "READY",
      network: "READY",
    },
    completionGates: [],
    localPendingCount: 0,
    lastUpdatedAt: "2026-11-12T00:00:00Z",
    ...overrides,
  };
}

function trackingProof(t: PackShipTask, barcode = "1Z999"): PendingTrackingProof {
  return {
    barcode,
    scopeKey: packShipLabelPairScopeKey(t),
    labelPairId: "11111111-1111-4111-8111-111111111111",
    observationId: "OBS-T",
    capturedAt: "2026-11-12T00:00:00Z",
    provider: "scandit",
    symbology: "CODE128",
    trackingClientOperationId: "11111111-1111-4111-8111-111111111111",
    trackingCorrelationId: "22222222-2222-4222-8222-222222222222",
  };
}

describe("Pack/Ship authoritative scan-plan derivation", () => {
  it("starts at PACK_SOURCE", () => {
    expect(derivePackShipScanPlan(task(), null)?.step).toBe("PACK_SOURCE");
  });

  it("moves to PACK_ITEM only after refreshed task says sourceVerified", () => {
    expect(derivePackShipScanPlan(task({ sourceVerified: true }), null)?.step).toBe("PACK_ITEM");
  });

  it("offers no label scan while the carrier label is not physically ready", () => {
    const readyItems = task({
      sourceVerified: true,
      items: [{ itemId: "I1", internalBarcode: "TCDS-I1", title: "Item", quantity: 1, verified: true }],
      carrierLabel: { status: "LABEL_PURCHASED", trackingNumber: "1Z999" },
    });
    expect(derivePackShipScanPlan(readyItems, null)).toBeNull();
  });

  it("requires a physical tracking scan before physical package scan", () => {
    const ready = task({
      sourceVerified: true,
      packageBarcode: "PKG-1",
      items: [{ itemId: "I1", internalBarcode: "TCDS-I1", title: "Item", quantity: 1, verified: true }],
      carrierLabel: { status: "PRINTED", trackingNumber: "1Z999", printJobId: "PJ1" },
    });
    const tracking = derivePackShipScanPlan(ready, null);
    const pack = derivePackShipScanPlan(ready, trackingProof(ready));
    expect(tracking?.step).toBe("PACK_TRACKING_LABEL");
    expect(pack?.step).toBe("PACK_PACKAGE");
    expect(pack?.sessionKey).not.toBe(tracking?.sessionKey);
  });

  it("invalidates transient tracking when shipment changes", () => {
    const ready = task({
      sourceVerified: true,
      items: [{ itemId: "I1", internalBarcode: "TCDS-I1", title: "Item", quantity: 1, verified: true }],
      carrierLabel: { status: "PRINTED", trackingNumber: "1Z999", printJobId: "PJ1" },
    });
    const pending = trackingProof(ready);
    const changed = { ...ready, shipmentId: "S2" };
    expect(derivePackShipScanPlan(changed, pending)?.step).toBe("PACK_TRACKING_LABEL");
  });

  it("invalidates transient tracking when print job/package identity changes", () => {
    const ready = task({
      sourceVerified: true,
      packageBarcode: "PKG-1",
      items: [{ itemId: "I1", internalBarcode: "TCDS-I1", title: "Item", quantity: 1, verified: true }],
      carrierLabel: { status: "PRINTED", trackingNumber: "1Z999", printJobId: "PJ1" },
    });
    const pending = trackingProof(ready);
    const changed = {
      ...ready,
      packageBarcode: "PKG-2",
      carrierLabel: { ...ready.carrierLabel, printJobId: "PJ2" },
    };
    expect(derivePackShipScanPlan(changed, pending)?.step).toBe("PACK_TRACKING_LABEL");
  });

  it("does not offer outbound until label is scan-verified and all blocking gates pass", () => {
    const base = task({
      sourceVerified: true,
      items: [{ itemId: "I1", internalBarcode: "TCDS-I1", title: "Item", quantity: 1, verified: true }],
      carrierLabel: { status: "SCAN_VERIFIED", trackingNumber: "1Z999" },
      completionGates: [{ code: "LABEL", label: "Label", state: "FAIL", blocking: true }],
    });
    expect(derivePackShipScanPlan(base, null)).toBeNull();
    expect(
      derivePackShipScanPlan(
        { ...base, completionGates: [{ code: "LABEL", label: "Label", state: "PASS", blocking: true }] },
        null,
      )?.step,
    ).toBe("PACK_OUTBOUND_LOCATION");
  });
});
