// LV2TEST wrong-scan retest (2026-11-21): after a scan was answered its text stayed in the field and Submit stayed
// active; fields for steps that could not be done yet (or were done) were open; the label card said "Next: Scan the
// approved outbound staging location" before a label was bought; Save Measurements kept the saved values and stayed
// active.
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../../src/components/AppHeader", () => ({ AppHeader: () => null }));
import { PackShipScreen } from "../../src/features/packShip/PackShipScreen";
import { contentsStepGuidance, labelStepGuidance, PAIRABLE_LABEL_STATUSES } from "../../src/features/packShip/controls/packShipStepGuidance";
import type { PackShipTask } from "../../src/features/packShip/types/packShipTypes";

type Call = { url: string; method: string; headers: Record<string, string>; body: Record<string, unknown> };
type Answer = { status: number; code: string } | "timeout" | undefined;
let calls: Call[] = [];
let current: PackShipTask;
let answer: ((c: Call) => Answer) | undefined;

const ITEM = (verified: boolean) => ({ itemId: "I1", internalBarcode: "TCDS-I1", title: "Item", quantity: 1, verified });
const HELD = { heldBySession: true, expired: false, expiresAt: "2026-11-21T23:00:00Z" };
function task(o: Partial<PackShipTask> = {}): PackShipTask {
  return {
    taskId: "T1", taskNumber: "PACK-1", orderId: "O1", orderNumber: "ORDER-1", shipmentId: "S1", facilityCode: "LV2TEST",
    stationCode: "PACK-01", employeeName: "Operator", claimExpiresAt: "", rowVersion: 7, stage: "CONTENTS",
    sourceBarcode: "", sourceVerified: false, items: [ITEM(false)], packageBarcode: "PKG-1", itemLabelStatus: "VERIFIED",
    measurement: { source: "PENDING", stable: false }, evidence: { required: 0, accepted: 0, pending: 0, rejected: 0, integrityVerified: true },
    sealed: false, address: { status: "VALIDATED" },
    protection: { declaredValue: 0, insuranceRequired: false, deliveryConfirmationRequired: false, signatureRequired: false, restrictedDeliveryRequired: false, routing: "AUTO_APPROVE", reasons: [] },
    rates: [], carrierLabel: { status: "NOT_PURCHASED" },
    readiness: { api: "READY", postgres: "READY", scanner: "UNKNOWN", scale: "UNKNOWN", printer: "UNKNOWN", gateway: "UNKNOWN", network: "READY" },
    completionGates: [], localPendingCount: 0, lastUpdatedAt: "2026-11-21T00:00:00Z", ...o,
  } as PackShipTask;
}
const contentsDone = (o: Partial<PackShipTask> = {}) => task({ sourceVerified: true, items: [ITEM(true)], ...o });
const respond = (status: number, body: unknown) =>
  Promise.resolve({ ok: status < 400, status, json: async () => body, headers: { get: () => null } } as unknown as Response);

beforeEach(() => {
  calls = []; answer = undefined; current = task();
  vi.stubGlobal("fetch", vi.fn((url: string, init: RequestInit = {}) => {
    const c: Call = { url, method: init.method ?? "GET", headers: (init.headers ?? {}) as Record<string, string>, body: init.body ? JSON.parse(String(init.body)) : {} };
    calls.push(c);
    const a = answer?.(c);
    if (a === "timeout") return Promise.reject(new DOMException("The operation was aborted.", "AbortError"));
    return a ? respond(a.status, { code: a.code }) : respond(200, current);
  }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

async function renderScreen(t: PackShipTask) {
  current = t;
  render(<MemoryRouter initialEntries={["/pack-ship?taskId=T1"]}><PackShipScreen /></MemoryRouter>);
  await screen.findByLabelText("Scan tote or item barcode");
}
const posts = (path: string) => calls.filter((c) => c.method === "POST" && c.url.includes(path));
const input = (label: string) => screen.getByLabelText(label) as HTMLInputElement;
const button = (name: string) => screen.getByRole("button", { name }) as HTMLButtonElement;
const type = (label: string, value: string) => fireEvent.change(input(label), { target: { value } });
const submit = async (label: string) => { await act(async () => { fireEvent.submit(input(label).closest("form")!); }); };
const SCAN = "Scan tote or item barcode";

describe("scan field after the server answers", () => {
  it("accepted: the field is emptied and Submit is inactive again", async () => {
    await renderScreen(task());
    type(SCAN, "PSTEST-SRC");
    expect(button("Submit scan").disabled).toBe(false);
    current = task({ sourceVerified: true, rowVersion: 8 });
    await submit(SCAN);
    await waitFor(() => expect(input(SCAN).value).toBe(""));
    expect(button("Submit scan").disabled).toBe(true);
    expect(posts("/scan-source")).toHaveLength(1);
  });

  it("refused: the field is emptied, the refused entry is shown under it, and typing again removes that note", async () => {
    answer = (c) => (c.url.includes("/scan-item") ? { status: 422, code: "PACK_WRONG_SERIALIZED_ITEM" } : undefined);
    await renderScreen(task({ sourceVerified: true }));
    type(SCAN, "WRONG-ITEM-01");
    await submit(SCAN);
    await screen.findByText("This is not the reserved item");
    expect(input(SCAN).value).toBe("");
    expect(button("Submit scan").disabled).toBe(true);
    expect(screen.getByText("WRONG-ITEM-01").closest("p")!.textContent).toBe("Not accepted: WRONG-ITEM-01");
    type(SCAN, "T");
    expect(screen.queryByText("WRONG-ITEM-01")).toBeNull();
  });

  it("timed out (outcome unknown): the field keeps the entry for the retry", async () => {
    answer = (c) => (c.url.includes("/scan-source") ? "timeout" : undefined);
    await renderScreen(task());
    type(SCAN, "PSTEST-SRC");
    await submit(SCAN);
    await waitFor(() => expect(posts("/scan-source")).toHaveLength(1));
    await waitFor(() => expect(button("Submit scan").disabled).toBe(false));
    expect(input(SCAN).value).toBe("PSTEST-SRC");
  });

  it("spaces only: Submit stays inactive and nothing is sent; spaces around a barcode are not sent", async () => {
    await renderScreen(task());
    type(SCAN, "   ");
    expect(button("Submit scan").disabled).toBe(true);
    await submit(SCAN);
    expect(posts("/scan-")).toHaveLength(0);
    type(SCAN, "  PSTEST-SRC ");
    await submit(SCAN);
    await waitFor(() => expect(posts("/scan-source")).toHaveLength(1));
    expect(posts("/scan-source")[0].body).toMatchObject({ barcode: "PSTEST-SRC" });
  });

  it("closes once the source and every item are verified", async () => {
    await renderScreen(contentsDone());
    expect(input(SCAN).disabled).toBe(true);
    expect(input(SCAN).placeholder).toBe("All contents verified");
    expect(button("Submit scan").disabled).toBe(true);
  });
});

describe("label pair", () => {
  const TRACK = "Carrier tracking barcode", PKG = "TCDS package barcode", VERIFY = "Verify Package ↔ Tracking Link";
  it("before a label is bought, both fields and Verify are inactive", async () => {
    await renderScreen(contentsDone({ carrierLabel: { status: "NOT_PURCHASED" } }));
    expect(input(TRACK).disabled).toBe(true);
    expect(input(PKG).disabled).toBe(true);
    expect(button(VERIFY).disabled).toBe(true);
  });

  it("refused: both fields are emptied and the refused pair is shown", async () => {
    answer = (c) => (c.url.includes("/label/verify") ? { status: 422, code: "SHIP_PACKAGE_LABEL_MISMATCH" } : undefined);
    await renderScreen(contentsDone({ carrierLabel: { status: "LABEL_PURCHASED", trackingNumber: "1Z9" } }));
    type(TRACK, "1ZWRONG"); type(PKG, "PKG-1");
    expect(button(VERIFY).disabled).toBe(false);
    await submit(PKG);
    await waitFor(() => expect(input(TRACK).value).toBe(""));
    expect(input(PKG).value).toBe("");
    expect(button(VERIFY).disabled).toBe(true);
    expect(screen.getByText("1ZWRONG + PKG-1")).toBeTruthy();
  });

  it("accepted: both fields are emptied and stay closed once the pair is verified", async () => {
    await renderScreen(contentsDone({ carrierLabel: { status: "PRINTED", trackingNumber: "1Z9" } }));
    type(TRACK, "1Z9"); type(PKG, "PKG-1");
    current = contentsDone({ carrierLabel: { status: "SCAN_VERIFIED", trackingNumber: "1Z9" }, rowVersion: 9 });
    await submit(PKG);
    await waitFor(() => expect(input(TRACK).disabled).toBe(true));
    expect(input(TRACK).value).toBe("");
    expect(input(PKG).value).toBe("");
  });
});

describe("outbound location", () => {
  const OUT = "Outbound staging location", STAGE = "Stage Package for Carrier Handoff";
  const ready = (o: Partial<PackShipTask> = {}) => contentsDone({ carrierLabel: { status: "SCAN_VERIFIED", trackingNumber: "1Z9" }, ...o });
  it("closed until staging is allowed", async () => {
    await renderScreen(contentsDone({ carrierLabel: { status: "PRINTED" } }));
    expect(input(OUT).disabled).toBe(true);
    expect(button(STAGE).disabled).toBe(true);
  });
  it("refused: emptied, refused location shown; accepted: emptied and closed once staged", async () => {
    answer = (c) => (c.url.includes("/outbound-stage") && c.body.locationBarcode === "WRONG-LOC-01" ? { status: 422, code: "PACK_WRONG_OUTBOUND_LOCATION" } : undefined);
    await renderScreen(ready());
    type(OUT, "WRONG-LOC-01");
    await submit(OUT);
    await screen.findByText("This is not an outbound staging location");
    expect(input(OUT).value).toBe("");
    expect(screen.getByText("WRONG-LOC-01")).toBeTruthy();

    type(OUT, "PSTEST-STG");
    current = ready({ taskStatus: "OUTBOUND_STAGED", rowVersion: 10 });
    await submit(OUT);
    await waitFor(() => expect(input(OUT).disabled).toBe(true));
    expect(input(OUT).value).toBe("");
    expect(input(OUT).placeholder).toBe("Package staged");
  });
});

describe("step guidance follows the task", () => {
  it("the label card does not send the packer to outbound before the pair is verified", () => {
    for (const s of ["NOT_PURCHASED", "PURCHASE_PENDING", "UNCERTAIN", "VOIDED", "LABEL_PURCHASED", "PRINT_QUEUED", "PRINTING", "PRINTED", "APPLIED"] as const) {
      expect(labelStepGuidance(s).next).not.toMatch(/outbound/i);
    }
    expect(labelStepGuidance("SCAN_VERIFIED").next).toBe("Scan the approved outbound staging location.");
    expect(labelStepGuidance("NOT_PURCHASED").next).toMatch(/Purchase the label/);
  });
  it("the pair can be scanned only for a purchased label that is not yet linked", () => {
    expect([...PAIRABLE_LABEL_STATUSES].sort()).toEqual(["APPLIED", "LABEL_PURCHASED", "PRINTED", "PRINTING", "PRINT_QUEUED"]);
  });
  it("on screen: before purchase the label card's next step is the purchase", async () => {
    await renderScreen(contentsDone());
    expect(screen.queryByText(/Scan the approved outbound staging location/)).toBeNull();
    expect(screen.getByText(/Purchase the label under Shipping Authorization/)).toBeTruthy();
  });
  it("contents card: once everything is verified it points to the box", () => {
    expect(contentsStepGuidance(true, true).next).toBe("Choose the box below.");
    expect(contentsStepGuidance(false, false).what).toMatch(/tote/);
  });
});

describe("measurements", () => {
  const APPROVAL = { overrideDecisionId: "4e5f6a7b-8c9d-4e0f-a1b2-c3d4e5f6a7b8", decidedAt: null, expiresAt: null };
  const measuring = (o: Partial<PackShipTask> = {}) => contentsDone({ taskStatus: "MEASURING", stage: "MEASUREMENTS", claim: HELD,
    packageId: "P1", packageRowVersion: 2, rowVersion: 8, manualWeightApproval: APPROVAL, ...o } as Partial<PackShipTask>);
  const fill = (v: Record<string, string>) => { for (const [label, value] of Object.entries(v)) type(label, value); };
  it("Save is inactive until a weight and all three dimensions are entered", async () => {
    await renderScreen(measuring());
    const save = button("Save Measurements");
    expect(save.disabled).toBe(true);
    fill({ "Weight (oz)": "5", "Length (in)": "8", "Width (in)": "5" });
    expect(save.disabled).toBe(true);
    fill({ "Height (in)": "5" });
    expect(save.disabled).toBe(false);
  });
  it("saved: the form is emptied and Save is inactive again", async () => {
    await renderScreen(measuring());
    fill({ "Weight (oz)": "5", "Length (in)": "8", "Width (in)": "5", "Height (in)": "5" });
    current = measuring({ taskStatus: "EVIDENCE_PENDING", rowVersion: 9, packageRowVersion: 3 });
    await act(async () => { fireEvent.click(button("Save Measurements")); });
    await waitFor(() => expect(posts("/measurements")).toHaveLength(1));
    await waitFor(() => expect(input("Length (in)").value).toBe(""));
    expect(input("Weight (oz)").value).toBe("");
    expect(button("Save Measurements").disabled).toBe(true);
  });
  it("refused: the entered values stay for a correction", async () => {
    answer = (c) => (c.url.includes("/measurements") ? { status: 409, code: "PACKSHIP_ROW_VERSION_CONFLICT" } : undefined);
    await renderScreen(measuring());
    fill({ "Weight (oz)": "5", "Length (in)": "8", "Width (in)": "5", "Height (in)": "5" });
    await act(async () => { fireEvent.click(button("Save Measurements")); });
    await waitFor(() => expect(posts("/measurements")).toHaveLength(1));
    await screen.findByText("The task changed");
    expect(input("Length (in)").value).toBe("8");
  });
});
