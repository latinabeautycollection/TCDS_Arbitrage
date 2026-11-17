import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resolvePackShipMessage } from "../../src/features/packShip/messages/packShipMessageCatalog";
import { productionWorkflowPorts } from "../../src/lib/scanning/workflow/adapters/productionApiPorts";
import { ProductionWorkflowAdapter } from "../../src/lib/scanning/workflow/adapters/ProductionWorkflowAdapter";
import { WorkflowScanCoordinator, type WorkflowScanCoordinatorContext } from "../../src/lib/scanning/workflow/coordinator/WorkflowScanCoordinator";
import type { CapturePolicyAuthority } from "../../src/lib/scanning/workflow/policy/CapturePolicyAuthority";
import type { BarcodeDecodeObservation } from "../../src/lib/scanning/capture/BarcodeDecodeObservation";

const WRONG_SCAN_CODES = [
  ["PACK_WRONG_SOURCE", "scan"],
  ["SHIP_PACKAGE_LABEL_MISMATCH", "package"],
  ["PACK_WRONG_OUTBOUND_LOCATION", "outbound"],
  ["PACK_WRONG_SERIALIZED_ITEM", "scan"],
  ["PACK_DUPLICATE_SCAN", "scan"],
  ["SHIP_TRACKING_MISMATCH", "tracking"],
] as const;

describe("Pack/Ship wrong-scan codes have their own messages", () => {
  const unknown = resolvePackShipMessage("UNKNOWN_ERROR");

  it.each(WRONG_SCAN_CODES)("%s is in the catalog, on the %s field", (code, field) => {
    const message = resolvePackShipMessage(code);
    expect(message.title).not.toBe(unknown.title);
    expect(message.field).toBe(field);
  });
});

let respond: () => Promise<Response>;
let calls = 0;

beforeEach(() => {
  calls = 0;
  vi.stubGlobal("fetch", vi.fn(() => { calls += 1; return respond(); }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const policy = { resolveIntentPolicy: vi.fn(async () => ({})) } as unknown as CapturePolicyAuthority;
const scanner = { start: vi.fn(async () => {}), pause: vi.fn(async () => {}), resume: vi.fn(async () => {}) };
const scan = (raw: string): BarcodeDecodeObservation =>
  ({ observationId: `OBS-${raw}`, provider: "scandit", rawValue: raw, symbology: "CODE128", capturedAt: "2026-11-17T00:00:00.000Z" }) as BarcodeDecodeObservation;

const sourceStep = {
  workflow: "PACKING",
  workflowEntityId: "T1",
  workflowStep: "PACK_SOURCE",
  captureIntent: { intent: "SOURCE_ID", mode: "SINGLE", allowedSymbologies: ["CODE128"], allowManualFallback: true },
  captureSource: "SCANDIT_WEB",
  adapterContext: { rowVersion: 4 },
} as unknown as WorkflowScanCoordinatorContext;

describe("a 422 wrong scan is a rejection, not an unknown outcome", () => {
  it.each(WRONG_SCAN_CODES.map(([code]) => code))("%s asks for a new scan and keeps no pending operation", async (code) => {
    respond = () => Promise.resolve({ ok: false, status: 422, json: async () => ({ code }), headers: { get: () => null } } as unknown as Response);
    const coordinator = new WorkflowScanCoordinator(scanner, policy, new ProductionWorkflowAdapter(productionWorkflowPorts), () => true);

    const decision = await coordinator.onObservation(scan("SRC-WRONG"), sourceStep);

    expect(decision).toMatchObject({ outcome: "REJECTED", reasonCode: code, nextAction: "RESUME_SAME_PROFILE" });
    expect(coordinator.pendingObservation).toBeNull();
    expect(calls).toBe(1);
  });
});
