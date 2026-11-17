import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { productionWorkflowPorts } from "../../src/lib/scanning/workflow/adapters/productionApiPorts";
import { ProductionWorkflowAdapter } from "../../src/lib/scanning/workflow/adapters/ProductionWorkflowAdapter";
import { WorkflowScanCoordinator, type WorkflowScanCoordinatorContext } from "../../src/lib/scanning/workflow/coordinator/WorkflowScanCoordinator";
import type { CapturePolicyAuthority } from "../../src/lib/scanning/workflow/policy/CapturePolicyAuthority";
import type { BarcodeDecodeObservation } from "../../src/lib/scanning/capture/BarcodeDecodeObservation";

type Sent = { url: string; headers: Record<string, string>; body: Record<string, unknown> };
let sent: Sent[] = [];
let respond: () => Promise<Response>;

const ok = () => Promise.resolve({ ok: true, status: 200, json: async () => ({ taskId: "T1", rowVersion: 5 }), headers: { get: () => null } } as unknown as Response);
const timeout = () => Promise.reject(new DOMException("The operation was aborted.", "AbortError"));

beforeEach(() => {
  sent = [];
  respond = ok;
  vi.stubGlobal("fetch", vi.fn((url: string, init: RequestInit = {}) => {
    sent.push({ url, headers: (init.headers ?? {}) as Record<string, string>, body: JSON.parse(String(init.body ?? "{}")) });
    return respond();
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const policy = { resolveIntentPolicy: vi.fn(async () => ({})) } as unknown as CapturePolicyAuthority;
const scanner = { start: vi.fn(async () => {}), pause: vi.fn(async () => {}), resume: vi.fn(async () => {}) };
const observation = (raw: string, symbology = "CODE128"): BarcodeDecodeObservation =>
  ({ observationId: `OBS-${raw}`, provider: "scandit", rawValue: raw, symbology, capturedAt: "2026-11-17T10:00:00.000Z" }) as BarcodeDecodeObservation;

function step(workflow: string, workflowStep: string, intent: string, captureSource = "SCANDIT_WEB"): WorkflowScanCoordinatorContext {
  return {
    workflow,
    workflowEntityId: "T1",
    workflowStep,
    captureIntent: { intent, mode: "SINGLE", allowedSymbologies: ["CODE128", "EAN13_UPCA"], allowManualFallback: true },
    captureSource,
    adapterContext: { rowVersion: 4, shipmentId: "S1" },
  } as unknown as WorkflowScanCoordinatorContext;
}

const coordinator = () => new WorkflowScanCoordinator(scanner, policy, new ProductionWorkflowAdapter(productionWorkflowPorts), () => true);

describe("a camera scan carries its own capture evidence to the Pack/Ship route", () => {
  it.each([
    ["source", step("PACKING", "PACK_SOURCE", "SOURCE_ID"), "/scan-source", "CODE128"],
    ["item", step("PACKING", "PACK_ITEM", "ITEM_ID"), "/scan-item", "EAN13_UPCA"],
    ["outbound location", step("OUTBOUND", "PACK_OUTBOUND_LOCATION", "OUTBOUND_LOCATION"), "/outbound-stage", "CODE128"],
  ])("%s", async (_name, ctx, path, symbology) => {
    await coordinator().onObservation(observation("RAW-1", symbology), ctx);

    expect(sent[0].url).toContain(path);
    expect(sent[0].body.capture).toEqual({
      source: "CAMERA",
      observationId: "OBS-RAW-1",
      capturedAt: "2026-11-17T10:00:00.000Z",
      provider: "scandit",
      canonicalSymbology: symbology,
    });
  });

  it("a retry sends the same capture evidence under the same operation", async () => {
    const c = coordinator();
    const ctx = step("PACKING", "PACK_ITEM", "ITEM_ID");
    respond = timeout;
    expect(await c.onObservation(observation("ITEM-1"), ctx)).toMatchObject({ outcome: "RECONCILING" });
    respond = ok;
    await c.retry(ctx);

    expect(sent).toHaveLength(2);
    expect(sent[1].body).toEqual(sent[0].body);
    expect(sent[1].headers["Idempotency-Key"]).toBe(sent[0].headers["Idempotency-Key"]);
  });

  it("a scan that did not come from the camera claims no camera evidence", async () => {
    await coordinator().onObservation(observation("ITEM-2"), step("PACKING", "PACK_ITEM", "ITEM_ID", "HID_KEYBOARD"));

    expect(sent[0].body).not.toHaveProperty("capture");
  });
});
