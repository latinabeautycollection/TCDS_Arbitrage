import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/components/AppHeader", () => ({ AppHeader: () => null }));

import { PackShipScreen } from "../../src/features/packShip/PackShipScreen";
import { resolvePackShipMessage } from "../../src/features/packShip/messages/packShipMessageCatalog";
import type { PackShipTask } from "../../src/features/packShip/types/packShipTypes";

const TASK = "91093299-c815-4b39-8beb-e9103cb9f3ba";
const PKG = "9b2f4c1e-5d6a-4b7c-8e9f-0a1b2c3d4e5f";
const BOX = "a32f30df-ab2e-442d-9cd5-c9a485af802d";
const APPROVAL = "4e5f6a7b-8c9d-4e0f-a1b2-c3d4e5f6a7b8";
const HELD = { heldBySession: true, expired: false, expiresAt: "2026-11-18T10:00:00Z" };
const gate = (code: string, state = "PENDING") => ({ code, label: code, state, blocking: true, stage: code });

function task(o: Partial<PackShipTask> = {}): PackShipTask {
  return {
    taskId: TASK, taskNumber: "PK-261117-91093299C8", orderId: "O1", orderNumber: "PSTEST-11170500", facilityCode: "LV2TEST",
    stationCode: "UNASSIGNED", employeeName: "Assigned operator", claimExpiresAt: "", rowVersion: 5, stage: "CONTENTS",
    sourceBarcode: "", sourceVerified: false,
    items: [{ itemId: "I1", internalBarcode: "PSTEST-11170500-ITEM-1", title: "TEST ITEM", quantity: 1, verified: false }],
    itemLabelStatus: "ACTIVE_PENDING_PRINT", measurement: { source: "PENDING", stable: false },
    evidence: { required: 0, accepted: 0, pending: 0, rejected: 0, integrityVerified: false }, sealed: false,
    address: { status: "NOT_STARTED" },
    protection: { declaredValue: 0, insuranceRequired: false, deliveryConfirmationRequired: false, signatureRequired: false, restrictedDeliveryRequired: false, routing: "PENDING", reasons: [] },
    rates: [], carrierLabel: { status: "NOT_PURCHASED" },
    readiness: { api: "UNKNOWN", postgres: "UNKNOWN", scanner: "UNKNOWN", scale: "UNKNOWN", printer: "UNKNOWN", gateway: "UNKNOWN", network: "UNKNOWN" },
    completionGates: [gate("CONTENTS"), gate("MEASUREMENTS"), gate("EVIDENCE"), gate("LABEL"), gate("OUTBOUND")],
    localPendingCount: 0, lastUpdatedAt: "2026-11-18T07:00:00Z", operationalMessages: [],
    taskStatus: "READY", claim: null, manualWeightApproval: null, ...o,
  } as PackShipTask;
}
const options = (o: object = {}) => ({
  contractVersion: "packship.packaging-options.v1", taskId: TASK, taskStatus: "PACKING", taskRowVersion: 5, selectable: true,
  eligibilityRule: "PACKSHIP_PACKAGING_ELIGIBILITY_V1",
  basis: { itemCount: 2, knownWeightOz: 0, itemsWithoutWeight: 2, categories: [], itemsWithoutCategory: 2 },
  options: [{ profileId: BOX, profileCode: "PSTEST-BOX-S", profileName: "TEST small box (Pack/Ship pilot)", version: 1, packagingTypeCode: "BOX",
    itemCategoryKey: null, maximumWeightOz: null, minimumLengthIn: null, minimumWidthIn: null, minimumHeightIn: null }], ...o,
});

type Call = { url: string; method: string; headers: Record<string, string>; body: any };
let calls: Call[] = [];
let current: PackShipTask;
let route: (c: Call) => Promise<Response> | undefined;
const ok = (body: unknown) => Promise.resolve({ ok: true, status: 200, json: async () => body, headers: { get: () => null } } as unknown as Response);
const fail = (status: number, code: string) => Promise.resolve({ ok: false, status, json: async () => ({ code }), headers: { get: () => null } } as unknown as Response);
const timeout = () => Promise.reject(new DOMException("aborted", "AbortError"));

beforeEach(() => {
  calls = []; route = () => undefined;
  vi.stubGlobal("fetch", vi.fn((url: string, init: RequestInit = {}) => {
    const c = { url, method: init.method ?? "GET", headers: (init.headers ?? {}) as Record<string, string>, body: init.body ? JSON.parse(String(init.body)) : undefined };
    calls.push(c);
    return route(c) ?? (url.endsWith("/packaging-options") ? ok(options()) : ok(current));
  }));
});
afterEach(() => vi.unstubAllGlobals());

const renderAt = async (t: PackShipTask) => {
  current = t;
  render(<MemoryRouter initialEntries={[`/pack-ship?taskId=${TASK}`]}><PackShipScreen/></MemoryRouter>);
  await screen.findByText(t.taskNumber);
};
const click = async (name: RegExp | string) => { const b = await screen.findByRole("button", { name }); await act(async () => { fireEvent.click(b); }); return b; };
const posts = (path: string) => calls.filter((c) => c.method === "POST" && c.url.endsWith(path));

describe("Claim", () => {
  it("unclaimed task: Claim Task posts /claim with an idempotency key; a timeout is retried as the same operation", async () => {
    let first = true;
    route = (c) => (c.url.endsWith("/claim") && first ? (first = false, timeout()) : undefined);
    await renderAt(task());
    current = task({ taskStatus: "CLAIMED", claim: HELD, rowVersion: 6 });
    await click(/^Claim Task$/);
    await click(resolvePackShipMessage("REQUEST_TIMEOUT").primaryActionLabel as string);
    await waitFor(() => expect(posts("/claim")).toHaveLength(2));
    const [a, b] = posts("/claim");
    expect(a.url).toContain(`/api/v1/packing/tasks/${TASK}/claim`);
    expect(b.headers["Idempotency-Key"]).toBe(a.headers["Idempotency-Key"]);
    expect(b.headers["X-Request-ID"]).not.toBe(a.headers["X-Request-ID"]);
    expect(await screen.findByText(/Claimed by you/)).toBeTruthy();
  });
  it("held by another packer: no claim button, the other claim is shown", async () => {
    await renderAt(task({ taskStatus: "CLAIMED", claim: { ...HELD, heldBySession: false } }));
    expect(screen.getByText(/Another packer has this task/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Claim Task|Take Over Task/ })).toBeNull();
  });
  it("expired claim: Take Over Task", async () => {
    await renderAt(task({ taskStatus: "PACKING", claim: { ...HELD, heldBySession: false, expired: true } }));
    expect(screen.getByRole("button", { name: "Take Over Task" })).toBeTruthy();
  });
  it("claimed by someone else (409): banner explains it, nothing pretends success", async () => {
    route = (c) => (c.url.endsWith("/claim") ? fail(409, "PACKSHIP_TASK_CLAIMED_BY_OTHER") : undefined);
    await renderAt(task());
    await click(/^Claim Task$/);
    expect(await screen.findByText("Another packer has this task")).toBeTruthy();
    expect(screen.queryByText(/Claimed by you/)).toBeNull();
  });
});

describe("Select Box", () => {
  const packing = () => task({ taskStatus: "PACKING", stage: "PACKAGING", claim: HELD, sourceVerified: true });
  it("loads the eligible boxes; Use This Box is disabled until one is chosen; posts its real profileId", async () => {
    await renderAt(packing());
    const radio = await screen.findByRole("radio", { name: /TEST small box/ });
    const use = screen.getByRole("button", { name: "Use This Box" }) as HTMLButtonElement;
    expect(use.disabled).toBe(true);
    expect(calls.some((c) => c.method === "GET" && c.url.endsWith(`/tasks/${TASK}/packaging-options`))).toBe(true);
    await act(async () => { fireEvent.click(radio); });
    current = task({ taskStatus: "MEASURING", stage: "MEASUREMENTS", claim: HELD, packageId: PKG, packageRowVersion: 1, packageBarcode: "TCDS-PKG-1", rowVersion: 6 });
    await click("Use This Box");
    await waitFor(() => expect(posts("/package")).toHaveLength(1));
    expect(posts("/package")[0].body).toEqual({ profileId: BOX, rowVersion: 5 });
    expect((await screen.findAllByText("Box selected")).length).toBeGreaterThan(0);
  });
  it("selectable false from the server: the button stays disabled even with a choice", async () => {
    route = (c) => (c.url.endsWith("/packaging-options") ? ok(options({ selectable: false })) : undefined);
    await renderAt(packing());
    await act(async () => { fireEvent.click(await screen.findByRole("radio", { name: /TEST small box/ })); });
    expect((screen.getByRole("button", { name: "Use This Box" }) as HTMLButtonElement).disabled).toBe(true);
  });
  it("no eligible box: says so, offers nothing", async () => {
    route = (c) => (c.url.endsWith("/packaging-options") ? ok(options({ options: [] })) : undefined);
    await renderAt(packing());
    expect(await screen.findByText(/No eligible box for this task/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Use This Box" })).toBeNull();
  });
  it("a list for another task is never shown", async () => {
    route = (c) => (c.url.endsWith("/packaging-options") ? ok(options({ taskId: "99999999-9999-4999-8999-999999999999" })) : undefined);
    await renderAt(packing());
    expect(await screen.findByText(/Eligible boxes could not be loaded/)).toBeTruthy();
    expect(screen.queryByRole("radio")).toBeNull();
  });
  it("refused as not eligible (409): banner, task reloads on its primary action", async () => {
    route = (c) => (c.url.endsWith("/package") ? fail(409, "PACKSHIP_PACKAGING_NOT_ELIGIBLE") : undefined);
    await renderAt(packing());
    await act(async () => { fireEvent.click(await screen.findByRole("radio", { name: /TEST small box/ })); });
    await click("Use This Box");
    expect(await screen.findByText("That box is not eligible for this task")).toBeTruthy();
    const before = calls.filter((c) => c.method === "GET" && c.url.endsWith(`/tasks/${TASK}`)).length;
    await click("Reload Task");
    await waitFor(() => expect(calls.filter((c) => c.method === "GET" && c.url.endsWith(`/tasks/${TASK}`)).length).toBe(before + 1));
  });
  it("not claimed yet: no list is requested", async () => {
    await renderAt(task({ taskStatus: "PACKING", claim: null }));
    expect(screen.getByText("Claim the task to choose a box.")).toBeTruthy();
    expect(calls.some((c) => c.url.endsWith("/packaging-options"))).toBe(false);
  });
});

describe("Measurements", () => {
  const measuring = (o: Partial<PackShipTask> = {}) => task({ taskStatus: "MEASURING", stage: "MEASUREMENTS", claim: HELD, sourceVerified: true,
    packageId: PKG, packageRowVersion: 2, packageBarcode: "TCDS-PKG-1", rowVersion: 8, ...o });
  const fill = async (v: Record<string, string>) => { for (const [label, value] of Object.entries(v)) await act(async () => { fireEvent.change(screen.getByLabelText(label), { target: { value } }); }); };
  it("no supervisor approval: says so, Save is disabled", async () => {
    await renderAt(measuring());
    expect(screen.getByText("Supervisor approval needed")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Save Measurements" }) as HTMLButtonElement).disabled).toBe(true);
  });
  it("with approval: 1 lb 4 oz, 10 × 8 × 4 posts weightOz 20, the package identity and the approval id", async () => {
    await renderAt(measuring({ manualWeightApproval: { overrideDecisionId: APPROVAL, decidedAt: null, expiresAt: null } }));
    await fill({ "Weight (lb)": "1", "Weight (oz)": "4", "Length (in)": "10", "Width (in)": "8", "Height (in)": "4" });
    current = measuring({ taskStatus: "EVIDENCE_PENDING", rowVersion: 9, packageRowVersion: 3 });
    await click("Save Measurements");
    await waitFor(() => expect(posts("/measurements")).toHaveLength(1));
    expect(posts("/measurements")[0].body).toEqual({ rowVersion: 8, packageId: PKG, packageRowVersion: 2, weightOz: 20, lengthIn: 10, widthIn: 8, heightIn: 4,
      weightSource: { type: "MANUAL", overrideDecisionId: APPROVAL } });
  });
  it("an invalid dimension is caught before any request", async () => {
    await renderAt(measuring({ manualWeightApproval: { overrideDecisionId: APPROVAL, decidedAt: null, expiresAt: null } }));
    await fill({ "Weight (lb)": "1", "Length (in)": "0", "Width (in)": "8", "Height (in)": "4" });
    await click("Save Measurements");
    expect(screen.getByText(/Enter the length in inches/)).toBeTruthy();
    expect(posts("/measurements")).toHaveLength(0);
  });
});

describe("Refusal messages keep their catalog text when the server sends only {code}", () => {
  it("a 409 with body {code} shows the catalog title, explanation and next step (PR #13 blanked them)", async () => {
    route = (c) => (c.url.endsWith("/claim") ? fail(409, "PACKSHIP_ROW_VERSION_CONFLICT") : undefined);
    await renderAt(task());
    await click(/^Claim Task$/);
    const m = resolvePackShipMessage("PACKSHIP_ROW_VERSION_CONFLICT");
    expect(await screen.findByText(m.title)).toBeTruthy();
    expect(screen.getByText(m.explanation)).toBeTruthy();
    expect(screen.getByText(`Next step: ${m.nextAction}`)).toBeTruthy();
  });
  it("server-sent text still wins over the catalog", () => {
    expect(resolvePackShipMessage("PACKSHIP_ROW_VERSION_CONFLICT", undefined, { title: "From server", explanation: undefined }).title).toBe("From server");
    expect(resolvePackShipMessage("PACKSHIP_ROW_VERSION_CONFLICT", undefined, { title: undefined }).title).toBe("The task changed");
  });
});

describe("Seal", () => {
  const evidence = (gates: string[]) => task({ taskStatus: "EVIDENCE_PENDING", stage: "EVIDENCE", claim: HELD, sourceVerified: true,
    packageId: PKG, packageRowVersion: 3, rowVersion: 9,
    completionGates: [gate("CONTENTS", gates[0]), gate("MEASUREMENTS", gates[1]), gate("EVIDENCE", gates[2]), gate("LABEL"), gate("OUTBOUND")] });
  it("all three pass: Seal posts /seal with the package identity and both row versions", async () => {
    await renderAt(evidence(["PASS", "PASS", "PASS"]));
    current = task({ taskStatus: "PACKED", stage: "SEALED", sealed: true, claim: HELD, packageId: PKG, packageRowVersion: 4, rowVersion: 10 });
    await click("Seal Package");
    await waitFor(() => expect(posts("/seal")).toHaveLength(1));
    expect(posts("/seal")[0].body).toEqual({ rowVersion: 9, packageId: PKG, packageRowVersion: 3 });
    expect((await screen.findAllByText("Package sealed")).length).toBeGreaterThan(0);
  });
  it("evidence still pending: Seal is disabled", async () => {
    await renderAt(evidence(["PASS", "PASS", "PENDING"]));
    expect((screen.getByRole("button", { name: "Seal Package" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
