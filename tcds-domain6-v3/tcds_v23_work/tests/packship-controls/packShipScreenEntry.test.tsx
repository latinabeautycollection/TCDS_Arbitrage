import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The header reads the signed-in session; these tests are about the scan entry and messages.
vi.mock("../../src/components/AppHeader", () => ({ AppHeader: () => null }));

import { PackShipApiError, packShipApi } from "../../src/features/packShip/services/packShipApi";
import { PackShipScreen } from "../../src/features/packShip/PackShipScreen";
import type { PackShipTask } from "../../src/features/packShip/types/packShipTypes";

type Call = { url: string; method: string; headers: Record<string, string>; body: Record<string, unknown> };
let calls: Call[] = [];
let current: PackShipTask;
let refuse: ((c: Call) => { status: number; code: string } | undefined) | undefined;

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

const respond = (status: number, body: unknown) =>
  Promise.resolve({ ok: status < 400, status, json: async () => body, headers: { get: () => null } } as unknown as Response);

beforeEach(() => {
  calls = [];
  refuse = undefined;
  current = task();
  vi.stubGlobal("fetch", vi.fn((url: string, init: RequestInit = {}) => {
    const c: Call = { url, method: init.method ?? "GET", headers: (init.headers ?? {}) as Record<string, string>, body: init.body ? JSON.parse(String(init.body)) : {} };
    calls.push(c);
    const refusal = refuse?.(c);
    return refusal ? respond(refusal.status, { code: refusal.code }) : respond(200, current);
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function renderScreen(t: PackShipTask) {
  current = t;
  render(
    <MemoryRouter initialEntries={["/pack-ship?taskId=T1"]}>
      <PackShipScreen />
    </MemoryRouter>,
  );
  await screen.findByLabelText("Scan tote or item barcode");
}

const posts = (path: string) => calls.filter((c) => c.method === "POST" && c.url.includes(path));

describe("Pack/Ship scan entry submits from the keyboard", () => {
  it("the source field has a Go key, and submitting its form posts one source scan", async () => {
    await renderScreen(task());
    const input = screen.getByLabelText("Scan tote or item barcode") as HTMLInputElement;
    expect(input.getAttribute("enterkeyhint")).toBe("go");

    fireEvent.change(input, { target: { value: "PSTEST-SRC" } });
    await act(async () => { fireEvent.submit(input.closest("form")!); });

    await waitFor(() => expect(posts("/scan-source")).toHaveLength(1));
    expect(posts("/scan-source")[0].body).toMatchObject({ barcode: "PSTEST-SRC", rowVersion: 7 });
  });

  it("an empty field submits nothing", async () => {
    await renderScreen(task());
    const input = screen.getByLabelText("Scan tote or item barcode");
    await act(async () => { fireEvent.submit(input.closest("form")!); });

    expect(posts("/scan-")).toHaveLength(0);
  });

  it("the submit button says Submit, not a scan icon", async () => {
    await renderScreen(task());
    const button = screen.getByRole("button", { name: "Submit scan" });
    expect(button.textContent).toBe("Submit");
    expect(button.getAttribute("type")).toBe("submit");
  });

  it("Enter in the tracking field moves to the package field; Go on the package posts the pair once", async () => {
    await renderScreen(task({ sourceVerified: true, items: [{ itemId: "I1", internalBarcode: "TCDS-I1", title: "Item", quantity: 1, verified: true }] } as Partial<PackShipTask>));
    const tracking = screen.getByLabelText("Carrier tracking barcode") as HTMLInputElement;
    const pkg = screen.getByLabelText("TCDS package barcode") as HTMLInputElement;
    expect(tracking.getAttribute("enterkeyhint")).toBe("next");
    expect(pkg.getAttribute("enterkeyhint")).toBe("go");

    fireEvent.change(tracking, { target: { value: "1Z999" } });
    fireEvent.keyDown(tracking, { key: "Enter" });
    expect(document.activeElement).toBe(pkg);
    expect(posts("/label/verify")).toHaveLength(0);

    fireEvent.change(pkg, { target: { value: "PKG-1" } });
    await act(async () => { fireEvent.submit(pkg.closest("form")!); });

    await waitFor(() => expect(posts("/label/verify")).toHaveLength(1));
    expect(posts("/label/verify")[0].body).toMatchObject({ trackingBarcode: "1Z999", packageBarcode: "PKG-1" });
  });

  it("the outbound field posts on Go only when staging is allowed", async () => {
    const ready = task({ sourceVerified: true, items: [{ itemId: "I1", internalBarcode: "TCDS-I1", title: "Item", quantity: 1, verified: true }], carrierLabel: { status: "SCAN_VERIFIED" } } as Partial<PackShipTask>);
    await renderScreen(ready);
    const outbound = screen.getByLabelText("Outbound staging location") as HTMLInputElement;
    expect(outbound.getAttribute("enterkeyhint")).toBe("go");

    fireEvent.change(outbound, { target: { value: "PSTEST-STG" } });
    await act(async () => { fireEvent.submit(outbound.closest("form")!); });

    await waitFor(() => expect(posts("/outbound-stage")).toHaveLength(1));
  });

  it("the outbound field posts nothing while staging is not allowed", async () => {
    await renderScreen(task());
    const outbound = screen.getByLabelText("Outbound staging location");
    fireEvent.change(outbound, { target: { value: "PSTEST-STG" } });
    await act(async () => { fireEvent.submit(outbound.closest("form")!); });

    expect(posts("/outbound-stage")).toHaveLength(0);
  });
});

describe("Pack/Ship refusals are seen and can be traced", () => {
  it("a refused scan brings its banner into view", async () => {
    const scroll = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: scroll });
    refuse = (c) => (c.url.includes("/scan-source") ? { status: 422, code: "PACK_WRONG_SOURCE" } : undefined);
    await renderScreen(task());

    fireEvent.change(screen.getByLabelText("Scan tote or item barcode"), { target: { value: "WRONG" } });
    await act(async () => { fireEvent.submit(screen.getByLabelText("Scan tote or item barcode").closest("form")!); });

    await screen.findByText("This is not the source for this task");
    expect(scroll).toHaveBeenCalled();
    delete (HTMLElement.prototype as unknown as Record<string, unknown>).scrollIntoView;
  });

  it("Why is this blocked? shows the error code and the request id of the refused attempt", async () => {
    refuse = (c) => (c.url.includes("/scan-source") ? { status: 409, code: "PACKSHIP_ROW_VERSION_CONFLICT" } : undefined);
    await renderScreen(task());

    fireEvent.change(screen.getByLabelText("Scan tote or item barcode"), { target: { value: "SRC" } });
    await act(async () => { fireEvent.submit(screen.getByLabelText("Scan tote or item barcode").closest("form")!); });
    await act(async () => { fireEvent.click(await screen.findByRole("button", { name: "Why is this blocked?" })); });

    const requestId = posts("/scan-source")[0].headers["X-Request-ID"];
    const sheet = screen.getByRole("dialog");
    expect(sheet.textContent).toContain("Code: PACKSHIP_ROW_VERSION_CONFLICT");
    expect(sheet.textContent).toContain(`Request ID: ${requestId}`);
  });

  it("the helper keeps the request id of the failed attempt, also on a timeout", async () => {
    refuse = () => ({ status: 409, code: "PACKSHIP_ROW_VERSION_CONFLICT" });
    const refused = await packShipApi.seal("T1", 4, "P1", 2).catch((e: unknown) => e);
    expect(refused).toBeInstanceOf(PackShipApiError);
    expect((refused as PackShipApiError).requestId).toBe(calls[0].headers["X-Request-ID"]);

    vi.stubGlobal("fetch", vi.fn((_url: string, init: RequestInit = {}) => {
      calls.push({ url: _url, method: init.method ?? "GET", headers: (init.headers ?? {}) as Record<string, string>, body: {} });
      return Promise.reject(new DOMException("The operation was aborted.", "AbortError"));
    }));
    const timedOut = await packShipApi.scanItem("T1", "ITEM", 4).catch((e: unknown) => e);
    expect(timedOut).toMatchObject({ code: "REQUEST_TIMEOUT", requestId: calls[1].headers["X-Request-ID"] });
  });
});

describe("Pack/Ship packaging placeholder", () => {
  it("is shown while contents are being verified", async () => {
    await renderScreen(task());
    expect(screen.queryByText("Recommendation will load after contents are verified.")).not.toBeNull();
  });

  it("is gone once the source and every item are verified", async () => {
    await renderScreen(task({ sourceVerified: true, items: [{ itemId: "I1", internalBarcode: "TCDS-I1", title: "Item", quantity: 1, verified: true }] } as Partial<PackShipTask>));
    expect(screen.queryByText("Recommendation will load after contents are verified.")).toBeNull();
  });
});
