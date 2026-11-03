import fs from "node:fs";
import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { BarcodeDecodeObservation } from "../../src/lib/scanning/capture/BarcodeDecodeObservation";
import type {
  WarehouseCaptureIntent,
  WarehouseCaptureIntentType,
} from "../../src/lib/scanning/workflow/contracts/WarehouseCaptureIntent";
import type { WarehouseWorkflow } from "../../src/lib/scanning/workflow/contracts/WarehouseScanEnvelope";
import {
  ProductionWorkflowAdapter,
  type WorkflowAdapterContext,
} from "../../src/lib/scanning/workflow/adapters/ProductionWorkflowAdapter";
import type { WorkflowPortSet } from "../../src/lib/scanning/workflow/adapters/WorkflowPorts";
import { classifyWorkflowFailure } from "../../src/lib/scanning/workflow/adapters/workflowFailure";
import { productionWorkflowPorts } from "../../src/lib/scanning/workflow/adapters/productionApiPorts";
import {
  WorkflowScanCoordinator,
  type WorkflowScanCoordinatorContext,
} from "../../src/lib/scanning/workflow/coordinator/WorkflowScanCoordinator";
import type { IntakeItemDraft } from "../../src/features/receiving/types/receivingTypes";
import type { PickTask } from "../../src/features/picking/types/pickingTypes";

// Only the storage helper is replaced, to observe what the binding passes to it.
const storage = vi.hoisted(() => ({
  scanItem: vi.fn(async () => ({ sessionId: "S1" })),
  scanLocation: vi.fn(async () => ({ sessionId: "S1" })),
}));
vi.mock("../../src/features/storage/services/storageApi", () => storage);

const OP = {
  clientOperationId: "0b4d4a77-2b1e-4a3c-9a1a-6f2f3c1d2e10",
  correlationId: "5f0f1c2a-8e3d-4b7a-9c6e-1a2b3c4d5e6f",
};

const observation = (rawValue: string): BarcodeDecodeObservation =>
  ({
    observationId: `obs-${rawValue}`,
    provider: "test",
    rawValue,
    symbology: "CODE128",
    capturedAt: "2026-10-29T00:00:00.000Z",
  }) as BarcodeDecodeObservation;

const intent = (value: WarehouseCaptureIntentType): WarehouseCaptureIntent => ({
  intent: value,
  mode: "SINGLE",
  allowedSymbologies: ["CODE128"],
  allowManualFallback: false,
});

const envelope = (workflow: WarehouseWorkflow, value: WarehouseCaptureIntentType, raw: string, workflowStep = "STEP") => ({
  observation: observation(raw),
  captureIntent: intent(value),
  clientOperationId: OP.clientOperationId,
  correlationId: OP.correlationId,
  workflow,
  workflowEntityId: "ENTITY-1",
  workflowStep,
  captureSource: "SCANDIT_WEB" as const,
  workflowContractVersion: "6.2D.2" as const,
});

const task = { taskId: "T1", rowVersion: 7, claimToken: "CLAIM", current: { lineId: "L1" } } as unknown as PickTask;

const draftTemplate: IntakeItemDraft = {
  receiptLineId: "RL1",
  expectedTitle: "Widget",
  upc: "",
  manufacturerPartNumber: "",
  serialNumber: "",
  condition: "NEW",
  quantity: 1,
  employeeConfirmed: false,
};

function fakePorts(): WorkflowPortSet {
  return {
    receiving: {
      matchPackage: vi.fn(async () => ({ receiptId: "R1" }) as never),
      createCandidate: vi.fn(async () => ({ intakeCandidateId: "C1", itemIndex: 1, itemTotal: 1, status: "NEW" })),
      validateCandidate: vi.fn(async () => ({ passed: true, errors: [] })),
      verifyCandidate: vi.fn(async () => ({ status: "VERIFIED" as const, confidence: 1, reasons: [] })),
    },
    putaway: {
      scanItem: vi.fn(async () => ({}) as never),
      scanLocation: vi.fn(async () => ({}) as never),
    },
    picking: {
      scanLocation: vi.fn(async () => ({ accepted: true, code: "OK", message: "", task })),
      scanItem: vi.fn(async () => ({ accepted: true, code: "OK", message: "", task })),
      scanDestination: vi.fn(async () => ({ accepted: true, code: "OK", message: "", task })),
    },
    packShip: {
      scanSource: vi.fn(async () => ({}) as never),
      scanItem: vi.fn(async () => ({}) as never),
      verifyLabel: vi.fn(async () => ({}) as never),
      stageOutbound: vi.fn(async () => ({}) as never),
    },
    inventory: { resolveScan: vi.fn(async () => ({}) as never) },
    returns: { resolveScan: vi.fn(async () => ({}) as never) },
  };
}

const timeoutLikeStorage = () =>
  Object.assign(new Error("The request timed out. Your work may already be committed; retry safely."), {
    status: 408,
    code: "REQUEST_TIMEOUT",
  });

beforeEach(() => {
  storage.scanItem.mockClear();
  storage.scanLocation.mockClear();
});

describe("6.2D binding to the existing helpers", () => {
  it("gives storage the stable operation identity as its idempotency key, on every attempt", async () => {
    await productionWorkflowPorts.putaway.scanItem("S1", "LOC-9", 4, OP);
    await productionWorkflowPorts.putaway.scanItem("S1", "LOC-9", 4, OP);

    expect(storage.scanItem).toHaveBeenNthCalledWith(1, "S1", "LOC-9", 4, OP.clientOperationId);
    expect(storage.scanItem).toHaveBeenNthCalledWith(2, "S1", "LOC-9", 4, OP.clientOperationId);
  });

  it("refuses an operation identity that is not a UUID", async () => {
    await expect(
      productionWorkflowPorts.putaway.scanLocation("S1", "LOC-9", 4, { ...OP, clientOperationId: "abc" }),
    ).rejects.toThrow("OPERATION_ID_INVALID");
    expect(storage.scanLocation).not.toHaveBeenCalled();
  });

  it("makes no HTTP request and names no route of its own", () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "src/lib/scanning/workflow/adapters/productionApiPorts.ts"),
      "utf8",
    );
    expect(source).not.toMatch(/\bfetch\s*\(/);
    expect(source).not.toContain("/api/v1/");
  });
});

describe("6.2D adapter follows the real helper shapes", () => {
  it("passes the whole pick task to picking", async () => {
    const ports = fakePorts();
    await new ProductionWorkflowAdapter(ports).submit(envelope("PICKING", "ITEM_ID", "SKU-1"), { pickTask: task });

    expect(ports.picking.scanItem).toHaveBeenCalledWith(task, "SKU-1", OP);
  });

  it("reports a pick scan the server did not accept as rejected, not accepted", async () => {
    const ports = fakePorts();
    vi.mocked(ports.picking.scanItem).mockResolvedValueOnce({ accepted: false, code: "WRONG_ITEM", message: "", task });

    const decision = await new ProductionWorkflowAdapter(ports).submit(envelope("PICKING", "ITEM_ID", "SKU-X"), { pickTask: task });

    expect(decision.outcome).toBe("REJECTED");
    expect(decision.reasonCode).toBe("WRONG_ITEM");
  });

  it("matches a receiving package through the existing helper", async () => {
    const ports = fakePorts();
    await new ProductionWorkflowAdapter(ports).submit(envelope("RECEIVING", "PACKAGE_ID", "TRK-1"), {});

    expect(ports.receiving.matchPackage).toHaveBeenCalledWith("TRK-1", OP);
  });

  it("sends a receiving item scan through create, validate and verify", async () => {
    const ports = fakePorts();
    const context: WorkflowAdapterContext = { receivingSessionId: "RS1", intakeDraft: draftTemplate };

    const decision = await new ProductionWorkflowAdapter(ports).submit(envelope("RECEIVING", "ITEM_ID", "0036000291452"), context);

    expect(ports.receiving.createCandidate).toHaveBeenCalledWith(
      "RS1",
      { ...draftTemplate, upc: "0036000291452", employeeConfirmed: false },
      OP,
    );
    expect(ports.receiving.validateCandidate).toHaveBeenCalledWith("C1", OP);
    expect(ports.receiving.verifyCandidate).toHaveBeenCalledWith("C1", OP);
    expect(decision.outcome).toBe("ACCEPTED");
  });

  it("puts a serial scan in the serial field, never the UPC", async () => {
    const ports = fakePorts();
    await new ProductionWorkflowAdapter(ports).submit(envelope("RECEIVING", "SERIAL", "SN-77"), {
      receivingSessionId: "RS1",
      intakeDraft: draftTemplate,
    });

    expect(ports.receiving.createCandidate).toHaveBeenCalledWith("RS1", { ...draftTemplate, serialNumber: "SN-77" }, OP);
  });

  it("hands a candidate needing review to a supervisor", async () => {
    const ports = fakePorts();
    vi.mocked(ports.receiving.verifyCandidate).mockResolvedValueOnce({ status: "REVIEW_REQUIRED", confidence: 0.4, reasons: [] });

    const decision = await new ProductionWorkflowAdapter(ports).submit(envelope("RECEIVING", "ITEM_ID", "X"), {
      receivingSessionId: "RS1",
      intakeDraft: draftTemplate,
    });

    expect(decision.outcome).toBe("REVIEW_REQUIRED");
    expect(decision.nextAction).toBe("SUPERVISOR_REVIEW");
  });

  it("stops at a failed validation and does not verify", async () => {
    const ports = fakePorts();
    vi.mocked(ports.receiving.validateCandidate).mockResolvedValueOnce({ passed: false, errors: ["UPC_MISMATCH"] });

    const decision = await new ProductionWorkflowAdapter(ports).submit(envelope("RECEIVING", "ITEM_ID", "X"), {
      receivingSessionId: "RS1",
      intakeDraft: draftTemplate,
    });

    expect(decision.outcome).toBe("REJECTED");
    expect(ports.receiving.verifyCandidate).not.toHaveBeenCalled();
  });

  it("never creates a second candidate when a lost response is retried", async () => {
    const ports = fakePorts();
    vi.mocked(ports.receiving.validateCandidate).mockRejectedValueOnce(new DOMException("aborted", "AbortError"));
    const adapter = new ProductionWorkflowAdapter(ports);

    const first = await adapter.submit(envelope("RECEIVING", "ITEM_ID", "X"), { receivingSessionId: "RS1", intakeDraft: draftTemplate });
    expect(first.outcome).toBe("RECONCILING");
    expect(first.result).toMatchObject({ intakeCandidateId: "C1" });

    const retry = await adapter.submit(envelope("RECEIVING", "ITEM_ID", "X"), {
      receivingSessionId: "RS1",
      intakeDraft: draftTemplate,
      intakeCandidateId: "C1",
    });
    expect(retry.outcome).toBe("ACCEPTED");
    expect(ports.receiving.createCandidate).toHaveBeenCalledTimes(1);
  });

  it("blocks a putaway scan without a row version", async () => {
    const decision = await new ProductionWorkflowAdapter(fakePorts()).submit(envelope("PUTAWAY", "ITEM_ID", "X"), {});

    expect(decision).toMatchObject({ outcome: "BLOCKED", reasonCode: "ROW_VERSION_REQUIRED" });
  });
});

describe("6.2D one failure shape for six helpers", () => {
  it.each([
    ["storage timeout, human message", timeoutLikeStorage(), "UNCERTAIN"],
    ["storage network loss", Object.assign(new Error("Unable to reach"), { status: 0, code: "NETWORK_UNAVAILABLE" }), "UNCERTAIN"],
    ["picking or receiving timeout", new DOMException("aborted", "AbortError"), "UNCERTAIN"],
    ["Pack/Ship network error", Object.assign(new Error("NETWORK_ERROR"), { code: "NETWORK_ERROR" }), "UNCERTAIN"],
    ["returns thrown plain object", { code: "RETURN_API_UNAVAILABLE", supportReference: "ref" }, "UNCERTAIN"],
    ["unreachable network", new TypeError("Failed to fetch"), "UNCERTAIN"],
    ["picking stale version", new Error("STALE_VERSION"), "STALE_STATE"],
    ["picking conflict", new Error("CONFLICT"), "CONFLICT"],
    ["expired session", new Error("SESSION_EXPIRED"), "SESSION_EXPIRED"],
    ["inventory 401", Object.assign(new Error("Sign in"), { status: 401 }), "SESSION_EXPIRED"],
    ["business rejection", new Error("WRONG_ITEM"), "REJECTED"],
    ["client defect", new TypeError("x is undefined"), "REJECTED"],
    ["server failure with a status", Object.assign(new Error("Server error"), { status: 500 }), "UNCERTAIN"],
    ["server failure reported as text", new Error("HTTP_500"), "UNCERTAIN"],
    ["picking server failure as text", new Error("PICK_API_503"), "UNCERTAIN"],
    ["client error as text stays a rejection", new Error("HTTP_404"), "REJECTED"],
  ])("%s", (_label, error, kind) => {
    expect(classifyWorkflowFailure(error).kind).toBe(kind);
  });
});

describe("6.2D coordinator keeps the operation only while the outcome is uncertain", () => {
  const scanner = () => ({ pause: vi.fn(async () => {}), resume: vi.fn(async () => {}), start: vi.fn(async () => {}) });
  const policy = { resolveIntentPolicy: vi.fn() };

  const context = (
    workflow: WarehouseWorkflow,
    value: WarehouseCaptureIntentType,
    adapterContext: WorkflowAdapterContext,
  ): WorkflowScanCoordinatorContext => ({
    workflow,
    workflowEntityId: "ENTITY-1",
    workflowStep: "STEP",
    captureIntent: intent(value),
    captureSource: "SCANDIT_WEB",
    adapterContext,
  });

  it("retries a storage timeout with the same operation identity", async () => {
    const ports = fakePorts();
    const seen: string[] = [];
    vi.mocked(ports.putaway.scanItem)
      .mockImplementationOnce(async (_s, _b, _r, op) => { seen.push(op.clientOperationId); throw timeoutLikeStorage(); })
      .mockImplementationOnce(async (_s, _b, _r, op) => { seen.push(op.clientOperationId); return {} as never; });
    const coordinator = new WorkflowScanCoordinator(scanner(), policy, new ProductionWorkflowAdapter(ports), () => true);
    const ctx = context("PUTAWAY", "ITEM_ID", { rowVersion: 3 });

    expect((await coordinator.onObservation(observation("SKU-1"), ctx)).outcome).toBe("RECONCILING");
    expect((await coordinator.retry(ctx)).outcome).toBe("ACCEPTED");
    expect(seen[0]).toBe(seen[1]);
  });

  it("treats a returns network failure as uncertain, not as a crash", async () => {
    const ports = fakePorts();
    vi.mocked(ports.returns.resolveScan).mockRejectedValueOnce({ code: "RETURN_API_UNAVAILABLE" });
    const coordinator = new WorkflowScanCoordinator(scanner(), policy, new ProductionWorkflowAdapter(ports), () => true);

    const decision = await coordinator.onObservation(observation("RMA-1"), context("RETURNS", "PACKAGE_ID", {}));

    expect(decision.outcome).toBe("RECONCILING");
  });

  it("ends the operation on a business rejection, so the next scan is a new one", async () => {
    const ports = fakePorts();
    const seen: string[] = [];
    vi.mocked(ports.picking.scanItem)
      .mockImplementationOnce(async (_t, _b, op) => { seen.push(op.clientOperationId); throw new Error("WRONG_ITEM"); })
      .mockImplementationOnce(async (_t, _b, op) => { seen.push(op.clientOperationId); return { accepted: true, code: "OK", message: "", task }; });
    const coordinator = new WorkflowScanCoordinator(scanner(), policy, new ProductionWorkflowAdapter(ports), () => true);
    const ctx = context("PICKING", "ITEM_ID", { pickTask: task });

    expect((await coordinator.onObservation(observation("SKU-X"), ctx)).outcome).toBe("REJECTED");
    await coordinator.onObservation(observation("SKU-1"), ctx);
    expect(seen[0]).not.toBe(seen[1]);
  });

  it("returns a decision instead of throwing a helper's own error", async () => {
    const ports = fakePorts();
    vi.mocked(ports.picking.scanItem).mockRejectedValueOnce(new Error("CONFLICT"));
    const coordinator = new WorkflowScanCoordinator(scanner(), policy, new ProductionWorkflowAdapter(ports), () => true);

    await expect(
      coordinator.onObservation(observation("SKU-1"), context("PICKING", "ITEM_ID", { pickTask: task })),
    ).resolves.toMatchObject({ outcome: "CONFLICT", nextAction: "REFRESH_WORKFLOW" });
  });
});

describe("6.2D a pending operation belongs to one scan", () => {
  const scanner = () => ({ pause: vi.fn(async () => {}), resume: vi.fn(async () => {}), start: vi.fn(async () => {}) });
  const policy = { resolveIntentPolicy: vi.fn() };
  const pickContext = (): WorkflowScanCoordinatorContext => ({
    workflow: "PICKING",
    workflowEntityId: "T1",
    workflowStep: "SCAN_ITEM",
    captureIntent: intent("ITEM_ID"),
    captureSource: "SCANDIT_WEB",
    adapterContext: { pickTask: task },
  });

  it("retries a real network drop with the same identity", async () => {
    const ports = fakePorts();
    const seen: string[] = [];
    vi.mocked(ports.picking.scanItem)
      .mockImplementationOnce(async (_t, _b, op) => { seen.push(op.clientOperationId); throw new TypeError("Failed to fetch"); })
      .mockImplementationOnce(async (_t, _b, op) => { seen.push(op.clientOperationId); return { accepted: true, code: "OK", message: "", task }; });
    const coordinator = new WorkflowScanCoordinator(scanner(), policy, new ProductionWorkflowAdapter(ports), () => true);

    expect((await coordinator.onObservation(observation("SKU-1"), pickContext())).outcome).toBe("RECONCILING");
    expect((await coordinator.retry(pickContext())).outcome).toBe("ACCEPTED");
    expect(seen[0]).toBe(seen[1]);
  });

  it("retries an HTTP 5xx with the same identity", async () => {
    const ports = fakePorts();
    const seen: string[] = [];
    vi.mocked(ports.picking.scanItem)
      .mockImplementationOnce(async (_t, _b, op) => { seen.push(op.clientOperationId); throw new Error("PICK_API_500"); })
      .mockImplementationOnce(async (_t, _b, op) => { seen.push(op.clientOperationId); return { accepted: true, code: "OK", message: "", task }; });
    const coordinator = new WorkflowScanCoordinator(scanner(), policy, new ProductionWorkflowAdapter(ports), () => true);

    expect((await coordinator.onObservation(observation("SKU-1"), pickContext())).outcome).toBe("RECONCILING");
    await coordinator.retry(pickContext());
    expect(seen[0]).toBe(seen[1]);
  });

  it("never sends a different barcode under the pending identity", async () => {
    const ports = fakePorts();
    vi.mocked(ports.picking.scanItem).mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const coordinator = new WorkflowScanCoordinator(scanner(), policy, new ProductionWorkflowAdapter(ports), () => true);

    await coordinator.onObservation(observation("SKU-1"), pickContext());
    const other = await coordinator.onObservation(observation("SKU-2"), pickContext());

    expect(other).toMatchObject({ outcome: "BLOCKED", reasonCode: "PENDING_SCAN_UNRESOLVED", nextAction: "RECONCILE" });
    expect(ports.picking.scanItem).toHaveBeenCalledTimes(1);
  });

  it("retries the pending barcode, not the last one scanned, then starts fresh", async () => {
    const ports = fakePorts();
    const seen: Array<[string, string]> = [];
    vi.mocked(ports.picking.scanItem).mockImplementation(async (_t, barcode, op) => {
      seen.push([barcode, op.clientOperationId]);
      if (seen.length === 1) throw new TypeError("Failed to fetch");
      return { accepted: true, code: "OK", message: "", task };
    });
    const coordinator = new WorkflowScanCoordinator(scanner(), policy, new ProductionWorkflowAdapter(ports), () => true);

    await coordinator.onObservation(observation("SKU-1"), pickContext());
    await coordinator.onObservation(observation("SKU-2"), pickContext());
    await coordinator.retry(pickContext());
    await coordinator.onObservation(observation("SKU-2"), pickContext());

    expect(seen.map(([barcode]) => barcode)).toEqual(["SKU-1", "SKU-1", "SKU-2"]);
    expect(seen[0][1]).toBe(seen[1][1]);
    expect(seen[2][1]).not.toBe(seen[0][1]);
  });

  it("treats the same barcode scanned again as a true retry", async () => {
    const ports = fakePorts();
    const seen: string[] = [];
    vi.mocked(ports.picking.scanItem)
      .mockImplementationOnce(async (_t, _b, op) => { seen.push(op.clientOperationId); throw new TypeError("Failed to fetch"); })
      .mockImplementationOnce(async (_t, _b, op) => { seen.push(op.clientOperationId); return { accepted: true, code: "OK", message: "", task }; });
    const coordinator = new WorkflowScanCoordinator(scanner(), policy, new ProductionWorkflowAdapter(ports), () => true);

    await coordinator.onObservation(observation("SKU-1"), pickContext());
    await coordinator.onObservation({ ...observation("SKU-1"), observationId: "obs-rescan" }, pickContext());

    expect(seen[0]).toBe(seen[1]);
  });

  it("resumes a receiving scan from its candidate without the screen passing it back", async () => {
    const ports = fakePorts();
    vi.mocked(ports.receiving.validateCandidate).mockRejectedValueOnce(new DOMException("aborted", "AbortError"));
    const coordinator = new WorkflowScanCoordinator(scanner(), policy, new ProductionWorkflowAdapter(ports), () => true);
    const ctx: WorkflowScanCoordinatorContext = {
      workflow: "RECEIVING",
      workflowEntityId: "RS1",
      workflowStep: "RECEIVE_ITEM",
      captureIntent: intent("ITEM_ID"),
      captureSource: "SCANDIT_WEB",
      adapterContext: { receivingSessionId: "RS1", intakeDraft: draftTemplate },
    };

    expect((await coordinator.onObservation(observation("UPC-1"), ctx)).outcome).toBe("RECONCILING");
    expect((await coordinator.retry(ctx)).outcome).toBe("ACCEPTED");
    expect(ports.receiving.createCandidate).toHaveBeenCalledTimes(1);
  });

  it("has nothing to retry when no scan is pending", async () => {
    const coordinator = new WorkflowScanCoordinator(scanner(), policy, new ProductionWorkflowAdapter(fakePorts()), () => true);

    expect(await coordinator.retry(pickContext())).toMatchObject({ outcome: "BLOCKED", reasonCode: "NOTHING_TO_RECONCILE" });
  });

  it.each([
    ["CONFLICT", new Error("CONFLICT"), "CONFLICT", "REFRESH_WORKFLOW"],
    ["STALE_VERSION", new Error("STALE_VERSION"), "STALE_STATE", "REFRESH_WORKFLOW"],
    ["SESSION_EXPIRED", new Error("SESSION_EXPIRED"), "BLOCKED", "REAUTHENTICATE"],
  ])("returns %s as an outcome instead of throwing", async (_label, error, outcome, nextAction) => {
    const ports = fakePorts();
    vi.mocked(ports.picking.scanItem).mockRejectedValueOnce(error);
    const coordinator = new WorkflowScanCoordinator(scanner(), policy, new ProductionWorkflowAdapter(ports), () => true);

    await expect(coordinator.onObservation(observation("SKU-1"), pickContext())).resolves.toMatchObject({ outcome, nextAction });
  });

  it("returns a missing row version as an outcome instead of throwing", async () => {
    const coordinator = new WorkflowScanCoordinator(scanner(), policy, new ProductionWorkflowAdapter(fakePorts()), () => true);
    const ctx: WorkflowScanCoordinatorContext = {
      workflow: "PUTAWAY",
      workflowEntityId: "S1",
      workflowStep: "SCAN_ITEM",
      captureIntent: intent("ITEM_ID"),
      captureSource: "SCANDIT_WEB",
      adapterContext: {},
    };

    await expect(coordinator.onObservation(observation("SKU-1"), ctx)).resolves.toMatchObject({
      outcome: "BLOCKED",
      reasonCode: "ROW_VERSION_REQUIRED",
    });
  });
});
