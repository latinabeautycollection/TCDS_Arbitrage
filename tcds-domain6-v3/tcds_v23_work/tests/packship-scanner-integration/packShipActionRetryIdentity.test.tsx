import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The header reads the signed-in session; this test is about the action buttons only.
vi.mock("../../src/components/AppHeader", () => ({ AppHeader: () => null }));

import { packShipApi, type OperationContext } from "../../src/features/packShip/services/packShipApi";
import { PackShipScreen } from "../../src/features/packShip/PackShipScreen";
import { resolvePackShipMessage } from "../../src/features/packShip/messages/packShipMessageCatalog";
import type { PackShipTask } from "../../src/features/packShip/types/packShipTypes";

type Attempt = { url: string; method: string; headers: Record<string, string> };
let attempts: Attempt[] = [];
let respond: (url: string) => Promise<Response>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const operation: OperationContext = {
  clientOperationId: "3c9a7e51-2b4d-4f60-8a1e-9d0c6b5a4f21",
  correlationId: "7e1d2c3b-4a5f-4e6d-9c8b-0a1f2e3d4c5b",
};

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
    selectedQuoteId: "Q1",
    carrierLabel: { status: "LABEL_PURCHASED" },
    readiness: { api: "READY", postgres: "READY", scanner: "READY", scale: "READY", printer: "READY", gateway: "READY", network: "READY" },
    completionGates: [],
    localPendingCount: 0,
    lastUpdatedAt: "2026-11-12T00:00:00Z",
    ...overrides,
  } as PackShipTask;
}

const ok = (body: unknown) =>
  Promise.resolve({ ok: true, status: 200, json: async () => body, headers: { get: () => null } } as unknown as Response);
const timeout = () => Promise.reject(new DOMException("The operation was aborted.", "AbortError"));

beforeEach(() => {
  attempts = [];
  respond = () => ok(task());
  vi.stubGlobal("fetch", vi.fn((url: string, init: RequestInit = {}) => {
    attempts.push({ url, method: init.method ?? "GET", headers: (init.headers ?? {}) as Record<string, string> });
    return respond(url);
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const actionCalls: Array<[string, (op?: OperationContext) => Promise<unknown>]> = [
  ["claim", (op) => packShipApi.claim("T1", op)],
  ["selectPackage", (op) => packShipApi.selectPackage("T1", "BOX-S", undefined, 4, op)],
  ["saveMeasurements", (op) => packShipApi.saveMeasurements("T1", { weightOz: 12 }, 4, op)],
  ["seal", (op) => packShipApi.seal("T1", 4, op)],
  ["purchaseLabel", (op) => packShipApi.purchaseLabel("S1", op)],
  ["printLabel", (op) => packShipApi.printLabel("S1", op)],
];

describe("Pack/Ship helper: action calls keep their operation on retry", () => {
  it.each(actionCalls)("%s keeps the operation id and correlation id on every attempt, with a new request id", async (_name, call) => {
    respond = timeout;
    await expect(call(operation)).rejects.toMatchObject({ code: "REQUEST_TIMEOUT" });
    respond = () => ok(task());
    await call(operation);

    expect(attempts).toHaveLength(2);
    for (const attempt of attempts) {
      expect(attempt.headers["Idempotency-Key"]).toBe(operation.clientOperationId);
      expect(attempt.headers["X-Correlation-ID"]).toBe(operation.correlationId);
    }
    expect(attempts[0].headers["X-Request-ID"]).not.toBe(attempts[1].headers["X-Request-ID"]);
  });
});

function renderScreen() {
  return render(
    <MemoryRouter initialEntries={["/pack-ship?taskId=T1"]}>
      <PackShipScreen />
    </MemoryRouter>,
  );
}

const retryLabel = resolvePackShipMessage("REQUEST_TIMEOUT").primaryActionLabel as string;

describe("Pack/Ship screen: a timed-out label action is retried as the same operation", () => {
  it.each([
    ["Purchase Label", "/label/purchase"],
    ["Print through Device Gateway", "/label/print"],
  ])("%s", async (buttonName, path) => {
    let first = true;
    respond = (url) => {
      if (url.includes(path) && first) {
        first = false;
        return timeout();
      }
      return ok(task());
    };

    renderScreen();
    const button = await screen.findByRole("button", { name: new RegExp(buttonName, "i") });
    await act(async () => { fireEvent.click(button); });

    const retry = await screen.findByRole("button", { name: retryLabel });
    await act(async () => { fireEvent.click(retry); });

    await waitFor(() => expect(attempts.filter((a) => a.url.includes(path))).toHaveLength(2));
    const [firstAttempt, secondAttempt] = attempts.filter((a) => a.url.includes(path));
    expect(firstAttempt.headers["Idempotency-Key"]).toMatch(UUID);
    expect(secondAttempt.headers["Idempotency-Key"]).toBe(firstAttempt.headers["Idempotency-Key"]);
    expect(secondAttempt.headers["X-Correlation-ID"]).toBe(firstAttempt.headers["X-Correlation-ID"]);
    expect(secondAttempt.headers["X-Request-ID"]).not.toBe(firstAttempt.headers["X-Request-ID"]);
  });
});
