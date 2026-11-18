import crypto from "node:crypto";
import express from "express";
import request from "supertest";
import * as security from "./loginV2Security.fixture"; // byte copy of the deployed 6.1B src/express/security.ts
import { mountPackShipOnLoginV2 } from "../src/mount/loginV2PackShipMount";
import { mapPackagingOptions } from "../src/domains/packShip/services/PackShipRouteService";
import replica from "./packagingOptions914.replica.json"; // real 914 output from the local replica run (915 state)

const ORIGIN = "https://warehouse-app.tcdsolutionsgroup.com";
const SK = "s".repeat(48), CK = "c".repeat(48);
const TOKEN = "session-token-abc", CSRF = "csrf-token-xyz";
const SID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TASK = "11111111-1111-4111-8111-111111111111";
const H = (v: string, k: string) => crypto.createHmac("sha256", k).update(v).digest();
const IDS = { "x-request-id": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "x-correlation-id": "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  "idempotency-key": "psv022-package-0001" };
const LIST = () => JSON.parse(JSON.stringify({ ...replica, packingTaskId: TASK }));

function setup(opt: { envelope?: any; packShip?: (sql: string, v: any[]) => any } = {}) {
  const packShipCalls: { sql: string; values: any[] }[] = [];
  const envelope = opt.envelope === undefined
    ? { auth_session_id: SID, device_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", permissions: ["PACKSHIP_PACK"], restricted_session: false }
    : opt.envelope;
  const identityPool: any = { query: async (sql: string, values: any[]) => {
    if (sql.includes("validate_session_csrf_v2"))
      return { rows: [{ valid: values[0].equals(H(TOKEN, SK)) && values[1].equals(H(CSRF, CK)) }] };
    if (sql.includes("touch_auth_session_if_due_v3")) return { rows: [{}] };
    if (sql.includes("runtime_session_envelope_by_token_v1"))
      return { rows: envelope && values[0].equals(H(TOKEN, SK)) ? [envelope] : [] };
    throw new Error("unexpected identity query");
  } };
  const packShipPool: any = { query: async (sql: string, values: any[]) => {
    packShipCalls.push({ sql, values });
    if (opt.packShip) return opt.packShip(sql, values);
    return { rows: [{ result: LIST() }] };
  } };
  const app = express();
  app.use(express.json({ limit: "64kb" }));
  mountPackShipOnLoginV2(app, { identityPool, packShipPool, sessionHashKey: SK, csrfHashKey: CK, publicOrigin: ORIGIN, security });
  app.use((_req, res) => res.status(404).json({ error: { code: "NOT_FOUND" } }));
  app.use((_e: any, _req: any, res: any, _n: any) => res.status(500).json({ error: { code: "INTERNAL_ERROR" } }));
  return { app, packShipCalls };
}
const cookies = (csrf = true) => `__Host-tcds_session=${TOKEN}` + (csrf ? `; __Host-tcds_csrf=${CSRF}` : "");
const get = (app: any, task = TASK) => request(app).get(`/api/v1/packing/tasks/${task}/packaging-options`).set("cookie", cookies(false));

describe("GET /api/v1/packing/tasks/:taskId/packaging-options (V0.2.2)", () => {
  it("returns packship.packaging-options.v1 from the real 914 output; session from the cookie only", async () => {
    const { app, packShipCalls } = setup();
    const r = await get(app);
    expect(r.status).toBe(200);
    expect(r.headers["cache-control"]).toBe("no-store");
    expect(packShipCalls[0].sql).toContain("packship_list_packaging_options_v2");
    expect(packShipCalls[0].values).toEqual([SID, TASK]);
    expect(r.body.contractVersion).toBe("packship.packaging-options.v1");
    expect(r.body).toMatchObject({ taskId: TASK, taskStatus: "MEASURING", selectable: false,
      eligibilityRule: "PACKSHIP_PACKAGING_ELIGIBILITY_V1" });
    expect(r.body.basis).toEqual({ itemCount: 1, knownWeightOz: 10, itemsWithoutWeight: 0, categories: ["phones"], itemsWithoutCategory: 0 });
    expect(r.body.options.map((o: any) => o.profileCode)).toEqual(["PSV022-HEAVY", "PSV022-PHONE", "PSV022-VER"]);
    for (const o of r.body.options) expect(Object.keys(o).sort()).toEqual(["itemCategoryKey", "maximumWeightOz", "minimumHeightIn",
      "minimumLengthIn", "minimumWidthIn", "packagingTypeCode", "profileCode", "profileId", "profileName", "version"]);
  });
  it("the profileId served is what POST .../package sends to select_package", async () => {
    const list = LIST(); const phone = list.options.find((o: any) => o.profileCode === "PSV022-PHONE");
    const { app, packShipCalls } = setup({ packShip: (sql) => sql.includes("list_packaging") ? { rows: [{ result: list }] }
      : { rows: [{ result: { ok: false, code: "PACKSHIP_STOP_HERE" } }] } });
    const opts = await get(app);
    await request(app).post(`/api/v1/packing/tasks/${TASK}/package`).set("origin", ORIGIN).set("sec-fetch-site", "same-origin")
      .set("cookie", cookies()).set("x-csrf-token", CSRF).set(IDS).send({ rowVersion: 7, profileId: opts.body.options[1].profileId });
    const sel = packShipCalls.find(c => c.sql.includes("packship_select_package_v2"));
    expect(sel?.values.slice(0, 4)).toEqual([SID, TASK, 7, phone.profileId]);
  });
  it("is a read: no CSRF header or origin needed", async () => {
    expect((await get(setup().app)).status).toBe(200);
  });
  it("no cookie: 401 and no database call", async () => {
    const { app, packShipCalls } = setup();
    const r = await request(app).get(`/api/v1/packing/tasks/${TASK}/packaging-options`);
    expect(r.status).toBe(401); expect(packShipCalls).toHaveLength(0);
  });
  it("session without PACKSHIP_PACK: 403", async () => {
    const r = await get(setup({ envelope: { auth_session_id: SID, device_id: "d", permissions: ["INVENTORY_VIEW"] } }).app);
    expect(r.status).toBe(403); expect(r.body.code).toBe("PACKSHIP_ACTOR_NOT_ALLOWED");
  });
  it("task id that is not a UUID: 422, no database call", async () => {
    const { app, packShipCalls } = setup();
    const r = await get(app, "not-a-uuid");
    expect(r.status).toBe(422); expect(packShipCalls).toHaveLength(0);
  });
  it.each([["PACKSHIP_TASK_NOT_FOUND", 404], ["PACKSHIP_FACILITY_MISMATCH", 403], ["PACKSHIP_SESSION_INVALID", 401]])(
    "database refusal %s: %i {code}", async (code, status) => {
      const err = Object.assign(new Error(code), { code: "P0001" });
      const r = await get(setup({ packShip: () => { throw err; } }).app);
      expect(r.status).toBe(status); expect(r.body).toEqual({ code });
    });
  it("POST .../package refused as not eligible: 409 PACKSHIP_PACKAGING_NOT_ELIGIBLE (PR #13 CONFLICT: reload options)", async () => {
    const err = Object.assign(new Error("PACKSHIP_PACKAGING_NOT_ELIGIBLE"), { code: "P0001" });
    const r = await request(setup({ packShip: () => { throw err; } }).app).post(`/api/v1/packing/tasks/${TASK}/package`)
      .set("origin", ORIGIN).set("sec-fetch-site", "same-origin").set("cookie", cookies()).set("x-csrf-token", CSRF).set(IDS)
      .send({ rowVersion: 7, profileId: "e905d025-2b9b-42fb-bdca-1652e39e1d85" });
    expect(r.status).toBe(409); expect(r.body).toEqual({ code: "PACKSHIP_PACKAGING_NOT_ELIGIBLE" });
  });
  it("a response for another task: 502, never shown", async () => {
    const r = await get(setup({ packShip: () => ({ rows: [{ result: { ...LIST(), packingTaskId: "99999999-9999-4999-8999-999999999999" } }] }) }).app);
    expect(r.status).toBe(502); expect(r.body).toEqual({ code: "PACKSHIP_CROSS_TASK_RESPONSE" });
  });
});

describe("mapPackagingOptions (pure)", () => {
  const bad = (mut: (l: any) => void) => { const l = LIST(); mut(l); return () => mapPackagingOptions(l, TASK); };
  it.each<[string, (l: any) => void]>([
    ["option id not a UUID", l => { l.options[0].profileId = "PSV022-HEAVY"; }],
    ["duplicate option id", l => { l.options[1].profileId = l.options[0].profileId; }],
    ["missing profile code", l => { delete l.options[0].profileCode; }],
    ["version 0", l => { l.options[0].version = 0; }],
    ["weight limit not a number", l => { l.options[0].maximumWeightOz = "64"; }],
    ["options not an array", l => { l.options = {}; }],
    ["selectable missing", l => { delete l.selectable; }],
    ["row version missing", l => { delete l.taskRowVersion; }],
    ["negative basis weight", l => { l.basis.knownWeightOz = -1; }],
  ])("refuses %s (502 PACKSHIP_PACKAGING_OPTIONS_INVALID)", (_n, mut) => {
    expect(bad(mut)).toThrow(expect.objectContaining({ message: "PACKSHIP_PACKAGING_OPTIONS_INVALID" }));
  });
  it("ok:false with a PACKSHIP code keeps its code; anything else is BACKEND_REJECTED", () => {
    expect(() => mapPackagingOptions({ ok: false, code: "PACKSHIP_TASK_NOT_FOUND" } as any, TASK))
      .toThrow(expect.objectContaining({ message: "PACKSHIP_TASK_NOT_FOUND" }));
    expect(() => mapPackagingOptions({ ok: false, code: "weird" } as any, TASK))
      .toThrow(expect.objectContaining({ message: "PACKSHIP_BACKEND_REJECTED" }));
  });
  it("an empty list is valid (no eligible box): options []", () => {
    expect(mapPackagingOptions({ ...LIST(), options: [] }, TASK).options).toEqual([]);
  });
});
