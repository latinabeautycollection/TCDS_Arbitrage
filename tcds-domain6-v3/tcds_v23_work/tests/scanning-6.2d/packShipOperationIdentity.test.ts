import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { packShipApi, type OperationContext } from "../../src/features/packShip/services/packShipApi";
import { productionWorkflowPorts } from "../../src/lib/scanning/workflow/adapters/productionApiPorts";
import { ProductionWorkflowAdapter } from "../../src/lib/scanning/workflow/adapters/ProductionWorkflowAdapter";
import { WorkflowScanCoordinator, type WorkflowScanCoordinatorContext } from "../../src/lib/scanning/workflow/coordinator/WorkflowScanCoordinator";
import type { CapturePolicyAuthority } from "../../src/lib/scanning/workflow/policy/CapturePolicyAuthority";
import type { BarcodeDecodeObservation } from "../../src/lib/scanning/capture/BarcodeDecodeObservation";

// Every HTTP attempt the helper makes, as the server would see it.
type Attempt = { url: string; headers: Record<string, string> };
let attempts: Attempt[] = [];
let respond: () => Promise<Response>;

const task = { taskId: "T1", rowVersion: 4 };
const ok = () => Promise.resolve({ ok: true, status: 200, json: async () => task, headers: { get: () => null } } as unknown as Response);
const serverError = () => Promise.resolve({ ok: false, status: 503, json: async () => ({}), headers: { get: () => null } } as unknown as Response);
const timeout = () => Promise.reject(new DOMException("The operation was aborted.", "AbortError"));
const networkDrop = () => Promise.reject(new TypeError("Failed to fetch"));

beforeEach(() => {
  attempts = [];
  respond = ok;
  vi.stubGlobal("fetch", vi.fn((url: string, init: RequestInit) => {
    attempts.push({ url, headers: init.headers as Record<string, string> });
    return respond();
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const operation: OperationContext = {
  clientOperationId: "0f8b8f8e-3c1a-4f5e-9a51-6b2f1d0c7a11",
  correlationId: "5d7e2c4b-8a90-4b1f-b3c2-9e8d7f6a5b42",
};

const scannerCalls: Array<[string, string, (op?: OperationContext) => Promise<unknown>]> = [
  ["scanSource", "/api/v1/packing/tasks/T1/scan-source", (op) => packShipApi.scanSource("T1", "TOTE-7", 4, op)],
  ["scanItem", "/api/v1/packing/tasks/T1/scan-item", (op) => packShipApi.scanItem("T1", "TCDS-ITEM-1", 4, op)],
  ["verifyLabel", "/api/v1/shipments/S1/label/verify", (op) => packShipApi.verifyLabel("S1", "1Z999AA10123456784", "PKG-1", op)],
  ["stageOutbound", "/api/v1/shipments/S1/outbound-stage", (op) => packShipApi.stageOutbound("S1", "OUT-A1", op)],
];

describe("Pack/Ship helper: scanner operation identity", () => {
  it.each(scannerCalls)("%s keeps the operation id and correlation id on every attempt, with a new request id", async (_name, path, call) => {
    respond = timeout;
    await expect(call(operation)).rejects.toMatchObject({ code: "REQUEST_TIMEOUT" });
    respond = ok;
    await call(operation);

    expect(attempts).toHaveLength(2);
    for (const attempt of attempts) {
      expect(attempt.url).toContain(path);
      expect(attempt.headers["Idempotency-Key"]).toBe(operation.clientOperationId);
      expect(attempt.headers["X-Correlation-ID"]).toBe(operation.correlationId);
      expect(attempt.headers["X-Request-ID"]).toMatch(UUID);
    }
    expect(attempts[0].headers["X-Request-ID"]).not.toBe(attempts[1].headers["X-Request-ID"]);
    expect(attempts[0].headers["X-Request-ID"]).not.toBe(operation.clientOperationId);
  });

  it.each(scannerCalls)("%s without an operation still gets new ids on each call, as the manual screen does today", async (_name, _path, call) => {
    await call();
    await call();

    expect(attempts).toHaveLength(2);
    expect(attempts[0].headers["Idempotency-Key"]).toMatch(UUID);
    expect(attempts[0].headers["Idempotency-Key"]).not.toBe(attempts[1].headers["Idempotency-Key"]);
    expect(attempts[0].headers["X-Correlation-ID"]).not.toBe(attempts[1].headers["X-Correlation-ID"]);
  });

  it("leaves every other Pack/Ship mutation unchanged in this slice", async () => {
    const others = [
      () => packShipApi.claim("T1"),
      () => packShipApi.selectPackage("T1", "BOX-S", undefined, 4),
      () => packShipApi.saveMeasurements("T1", { weightOz: 12 }, 4),
      () => packShipApi.seal("T1", 4),
      () => packShipApi.validateAddress("S1"),
      () => packShipApi.evaluateRisk("S1"),
      () => packShipApi.getRates("S1"),
      () => packShipApi.selectRate("S1", "Q1"),
      () => packShipApi.purchaseLabel("S1"),
      () => packShipApi.printLabel("S1"),
      () => packShipApi.completionCheck("T1"),
    ];
    for (const call of others) {
      await call();
      await call();
    }

    expect(attempts).toHaveLength(others.length * 2);
    for (let i = 0; i < attempts.length; i += 2) {
      expect(attempts[i].headers["Idempotency-Key"]).toMatch(UUID);
      expect(attempts[i].headers["Idempotency-Key"]).not.toBe(attempts[i + 1].headers["Idempotency-Key"]);
    }
  });
});

describe("6.2D binding: Pack/Ship scans carry the scan's operation", () => {
  it("refuses an operation id that is not a UUID before any request is made", async () => {
    await expect(
      productionWorkflowPorts.packShip.scanItem("T1", "TCDS-ITEM-1", 4, { clientOperationId: "not-a-uuid", correlationId: "c" }),
    ).rejects.toThrow("OPERATION_ID_INVALID");
    expect(attempts).toHaveLength(0);
  });
});

const policy = { resolveIntentPolicy: vi.fn(async () => ({})) } as unknown as CapturePolicyAuthority;
const scanner = { start: vi.fn(async () => {}), pause: vi.fn(async () => {}), resume: vi.fn(async () => {}) };
const scan = (raw: string): BarcodeDecodeObservation =>
  ({ observationId: raw, provider: "test", rawValue: raw, symbology: "CODE128", capturedAt: "2026-11-03T00:00:00.000Z" }) as BarcodeDecodeObservation;

function packShipContext(workflow: string, workflowStep: string, intent: string): WorkflowScanCoordinatorContext {
  return {
    workflow,
    workflowEntityId: "T1",
    workflowStep,
    captureIntent: { intent, mode: "SINGLE", allowedSymbologies: ["CODE128"], allowManualFallback: true },
    captureSource: "SCANDIT_WEB",
    adapterContext: { rowVersion: 4, shipmentId: "S1", packageBarcode: "PKG-1" },
  } as unknown as WorkflowScanCoordinatorContext;
}

const coordinatorSteps: Array<[string, WorkflowScanCoordinatorContext, string, string]> = [
  ["source", packShipContext("PACKING", "PACK_SOURCE", "TOTE_ID"), "TOTE-7", "/scan-source"],
  ["item", packShipContext("PACKING", "PACK_ITEM", "ITEM_ID"), "TCDS-ITEM-1", "/scan-item"],
  ["tracking label", packShipContext("PACKING", "PACK_VERIFY_LABEL", "TRACKING_NUMBER"), "1Z999AA10123456784", "/label/verify"],
  ["outbound location", packShipContext("OUTBOUND", "STAGE", "LOCATION_ID"), "OUT-A1", "/outbound-stage"],
];

describe("Pack/Ship retry through the 6.2D coordinator", () => {
  it.each(coordinatorSteps)("a retried %s scan reaches the server with the same operation id", async (_name, ctx, raw, path) => {
    const coordinator = new WorkflowScanCoordinator(scanner, policy, new ProductionWorkflowAdapter(productionWorkflowPorts), () => true);

    respond = timeout;
    expect(await coordinator.onObservation(scan(raw), ctx)).toMatchObject({ outcome: "RECONCILING", nextAction: "RECONCILE" });
    respond = ok;
    expect(await coordinator.retry(ctx)).toMatchObject({ outcome: "ACCEPTED" });

    expect(attempts).toHaveLength(2);
    const [first, second] = attempts;
    expect(first.url).toContain(path);
    expect(first.headers["Idempotency-Key"]).toMatch(UUID);
    expect(second.headers["Idempotency-Key"]).toBe(first.headers["Idempotency-Key"]);
    expect(second.headers["X-Correlation-ID"]).toBe(first.headers["X-Correlation-ID"]);
    expect(second.headers["X-Request-ID"]).not.toBe(first.headers["X-Request-ID"]);

    // Once the outcome is known, the next scan is a new operation.
    await coordinator.onObservation(scan(`${raw}-NEXT`), ctx);
    expect(attempts[2].headers["Idempotency-Key"]).not.toBe(first.headers["Idempotency-Key"]);
  });

  it.each([
    ["a dropped connection", networkDrop],
    ["a server error", serverError],
  ])("keeps the operation id after %s", async (_name, failure) => {
    const ctx = coordinatorSteps[1][1];
    const coordinator = new WorkflowScanCoordinator(scanner, policy, new ProductionWorkflowAdapter(productionWorkflowPorts), () => true);

    respond = failure;
    expect(await coordinator.onObservation(scan("TCDS-ITEM-1"), ctx)).toMatchObject({ outcome: "RECONCILING" });
    respond = ok;
    expect(await coordinator.retry(ctx)).toMatchObject({ outcome: "ACCEPTED" });

    expect(attempts).toHaveLength(2);
    expect(attempts[1].headers["Idempotency-Key"]).toBe(attempts[0].headers["Idempotency-Key"]);
    expect(attempts[1].headers["X-Correlation-ID"]).toBe(attempts[0].headers["X-Correlation-ID"]);
  });
});
