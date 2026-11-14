import { describe, expect, it } from "vitest";

import {
  derivePackShipScanPlan,
  packShipLabelPairScopeKey,
  type PendingTrackingProof,
} from "../../src/features/packShip/scanning/packShipScanPlan";
import {
  CertifiedCapturePolicyAuthority,
  captureContextFor,
} from "../../src/lib/scanning/workflow/policy/CapturePolicyAuthority";
import type { PackShipTask } from "../../src/features/packShip/types/packShipTypes";
import { authorityFixture } from "../scanning-6.2c/fixtures";

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
    items: [{ itemId: "I1", internalBarcode: "TCDS-I1", title: "Item", quantity: 1, verified: true }],
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
  } as PackShipTask;
}

const labelled = task();
const tracking = {
  scopeKey: packShipLabelPairScopeKey(labelled),
  barcode: "1Z999",
  labelPairId: "11111111-1111-4111-8111-111111111111",
  observationId: "OBS-T",
  capturedAt: "2026-11-12T00:00:00Z",
  provider: "scandit",
  symbology: "CODE128",
  trackingClientOperationId: "11111111-1111-4111-8111-111111111111",
  trackingCorrelationId: "22222222-2222-4222-8222-222222222222",
} as unknown as PendingTrackingProof;

// Every step the Pack/Ship scan plan can produce, with the certified 6.2C context it must reach.
const steps: Array<[string, string, PackShipTask, PendingTrackingProof | null]> = [
  ["PACK_SOURCE", "PACK_SOURCE", task({ sourceVerified: false }), null],
  ["PACK_ITEM", "PACK_ITEM", task({ items: [{ itemId: "I1", internalBarcode: "TCDS-I1", title: "Item", quantity: 1, verified: false }] } as Partial<PackShipTask>), null],
  ["PACK_TRACKING_LABEL", "TRACKING_LABEL", labelled, null],
  ["PACK_PACKAGE", "PACK_PACKAGE", labelled, tracking],
  ["PACK_OUTBOUND_LOCATION", "PACK_OUTBOUND_LOCATION", task({ carrierLabel: { status: "SCAN_VERIFIED" } } as Partial<PackShipTask>), null],
];

describe("Pack/Ship scan plan and certified 6.2C contexts", () => {
  it.each(steps)("the %s step maps to %s and resolves through 6.2C", async (step, contextId, current, pending) => {
    const plan = derivePackShipScanPlan(current, pending);
    expect(plan?.step).toBe(step);
    const { workflow, workflowStep, workflowEntityId, captureIntent } = plan!.context;

    expect(captureContextFor(workflow, workflowStep, captureIntent.intent)).toBe(contextId);

    const authority = new CertifiedCapturePolicyAuthority({ load: async () => authorityFixture() });
    const policy = await authority.resolveIntentPolicy(captureIntent, { workflow, workflowEntityId, workflowStep });
    expect(policy.lineage).toMatchObject({ policySource: "6.2C_VALIDATED_POLICY", profileId: contextId });
  });
});
