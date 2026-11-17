import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { packShipApi } from "../../src/features/packShip/services/packShipApi";

// Each request as the Pack/Ship routes receive it.
type Sent = { url: string; headers: Record<string, string>; body: Record<string, unknown> };
let sent: Sent[] = [];

const task = { taskId: "T1", rowVersion: 5 };

beforeEach(() => {
  sent = [];
  vi.stubGlobal("fetch", vi.fn((url: string, init: RequestInit = {}) => {
    sent.push({ url, headers: (init.headers ?? {}) as Record<string, string>, body: init.body ? JSON.parse(String(init.body)) : {} });
    return Promise.resolve({ ok: true, status: 200, json: async () => task, headers: { get: () => null } } as unknown as Response);
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const PACKAGE_ID = "9b2f4c1e-5d6a-4b7c-8e9f-0a1b2c3d4e5f";
const OVERRIDE_ID = "4e5f6a7b-8c9d-4e0f-a1b2-c3d4e5f6a7b8";

function withCookie(value: string, run: () => Promise<void>) {
  Object.defineProperty(document, "cookie", { configurable: true, get: () => value });
  return run().finally(() => {
    delete (document as unknown as Record<string, unknown>).cookie;
  });
}

describe("Pack/Ship requests carry the Login V2 CSRF token", () => {
  it("sends the cookie's token, decoded, on every call", async () => {
    await withCookie("theme=dark; __Host-tcds_csrf=a%2Fb%3Dc; other=1", async () => {
      await packShipApi.getTask("T1");
      await packShipApi.scanItem("T1", "ITEM-1", 5);
      await packShipApi.seal("T1", 4, PACKAGE_ID, 2);
    });

    expect(sent).toHaveLength(3);
    for (const request of sent) expect(request.headers["X-CSRF-Token"]).toBe("a/b=c");
  });

  it("sends no CSRF header when there is no token cookie", async () => {
    await withCookie("theme=dark", async () => {
      await packShipApi.scanItem("T1", "ITEM-1", 5);
    });

    expect(sent[0].headers).not.toHaveProperty("X-CSRF-Token");
  });
});

describe("Pack/Ship request bodies match the route contract", () => {
  it("seal sends the task and package versions and nothing else", async () => {
    await packShipApi.seal("T1", 4, PACKAGE_ID, 2);

    expect(sent[0].url).toContain("/api/v1/packing/tasks/T1/seal");
    expect(sent[0].body).toEqual({ rowVersion: 4, packageId: PACKAGE_ID, packageRowVersion: 2 });
  });

  it("measurements send ounces, inches, both versions and the weight source", async () => {
    await packShipApi.saveMeasurements(
      "T1", 4, PACKAGE_ID, 2,
      { weightOz: 12.5, lengthIn: 10, widthIn: 8, heightIn: 4 },
      { type: "MANUAL", overrideDecisionId: OVERRIDE_ID },
    );

    expect(sent[0].url).toContain("/api/v1/packing/tasks/T1/measurements");
    expect(sent[0].body).toEqual({
      rowVersion: 4,
      packageId: PACKAGE_ID,
      packageRowVersion: 2,
      weightOz: 12.5,
      lengthIn: 10,
      widthIn: 8,
      heightIn: 4,
      weightSource: { type: "MANUAL", overrideDecisionId: OVERRIDE_ID },
    });
  });

  it("a scan sends capture evidence only when it has some", async () => {
    await packShipApi.scanSource("T1", "SRC-1", 5);
    await packShipApi.scanSource("T1", "SRC-1", 5, undefined, {
      source: "CAMERA", observationId: "OBS-1", capturedAt: "2026-11-17T00:00:00.000Z", provider: "scandit", canonicalSymbology: "CODE128",
    });

    expect(sent[0].body).toEqual({ barcode: "SRC-1", rowVersion: 5 });
    expect(sent[1].body).toEqual({
      barcode: "SRC-1",
      rowVersion: 5,
      capture: { source: "CAMERA", observationId: "OBS-1", capturedAt: "2026-11-17T00:00:00.000Z", provider: "scandit", canonicalSymbology: "CODE128" },
    });
  });
});
