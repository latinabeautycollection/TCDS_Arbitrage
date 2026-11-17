import crypto from "node:crypto";
import express from "express";
import request from "supertest";
import * as security from "./loginV2Security.fixture"; // byte copy of the deployed 6.1B src/express/security.ts
import { mountPackShipOnLoginV2 } from "../src/mount/loginV2PackShipMount";

const ORIGIN = "https://warehouse-app.tcdsolutionsgroup.com";
const SK = "s".repeat(48), CK = "c".repeat(48);
const TOKEN = "session-token-abc", CSRF = "csrf-token-xyz";
const SID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TASK = "11111111-1111-4111-8111-111111111111";
const H = (v: string, k: string) => crypto.createHmac("sha256", k).update(v).digest();
const IDS = { "x-request-id": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "x-correlation-id": "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  "idempotency-key": "psv16-claim-0001" };
const SNAP = { packingTaskId: TASK, taskNumber: "PK-1", status: "CLAIMED", rowVersion: 2,
  facilityId: "22222222-2222-4222-8222-222222222222", assignedStationId: null,
  fulfillmentOrderId: "33333333-3333-4333-8333-333333333333",
  claim: { heldBySession: true, expiresAt: "2026-11-17T10:00:00Z" }, sourceVerified: false,
  items: [{ packingTaskItemId: "i1", itemId: "i", expectedBarcode: "B", expectedQuantity: 1, verifiedQuantity: 0, status: "PENDING", rowVersion: 1, title: "T" }],
  package: null, shipment: null, blockers: [], snapshotVersion: "0.2.1", carrierCutoffAt: null,
  facility: { facilityCode: "LV2TEST" }, station: null, order: { externalOrderId: "E-1", shipByAt: null },
  evidence: { requirementCount: 0, required: 0, accepted: 0, pending: 0, rejected: 0, integrityVerified: false },
  stationReadiness: null, printJob: null };

function setup(opt: { envelope?: any; csrfValid?: boolean; identityDown?: boolean; touchFails?: boolean; packShip?: (sql: string, v: any[]) => any } = {}) {
  const identityCalls: { sql: string; values: any[] }[] = [], packShipCalls: { sql: string; values: any[] }[] = [];
  const envelope = opt.envelope === undefined
    ? { auth_session_id: SID, device_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", permissions: ["PACKSHIP_PACK"], restricted_session: false }
    : opt.envelope;
  const identityPool: any = { query: async (sql: string, values: any[]) => {
    identityCalls.push({ sql, values });
    if (opt.identityDown) throw new Error("connection refused");
    if (sql.includes("validate_session_csrf_v2"))
      return { rows: [{ valid: opt.csrfValid !== false && values[0].equals(H(TOKEN, SK)) && values[1].equals(H(CSRF, CK)) }] };
    if (sql.includes("touch_auth_session_if_due_v3")) { if (opt.touchFails) throw new Error("touch failed"); return { rows: [{}] }; }
    if (sql.includes("runtime_session_envelope_by_token_v1"))
      return { rows: envelope && values[0].equals(H(TOKEN, SK)) ? [envelope] : [] };
    throw new Error("unexpected identity query");
  } };
  const packShipPool: any = { query: async (sql: string, values: any[]) => {
    packShipCalls.push({ sql, values });
    if (opt.packShip) return opt.packShip(sql, values);
    return { rows: [{ result: { ok: true, code: "OK", task: SNAP } }] };
  } };
  const app = express();
  app.use(express.json({ limit: "64kb" }));
  mountPackShipOnLoginV2(app, { identityPool, packShipPool, sessionHashKey: SK, csrfHashKey: CK, publicOrigin: ORIGIN, security });
  app.use((_req, res) => res.status(404).json({ error: { code: "NOT_FOUND" } }));            // host's 404
  app.use((_e: any, _req: any, res: any, _n: any) => res.status(500).json({ error: { code: "INTERNAL_ERROR" } })); // host's handler
  return { app, identityCalls, packShipCalls };
}
const cookies = (csrf = true) => `__Host-tcds_session=${TOKEN}` + (csrf ? `; __Host-tcds_csrf=${CSRF}` : "");
const claim = (app: any) => request(app).post(`/api/v1/packing/tasks/${TASK}/claim`).set("origin", ORIGIN)
  .set("sec-fetch-site", "same-origin").set("cookie", cookies()).set("x-csrf-token", CSRF).set(IDS).send({});

describe("Pack/Ship mounted on the Login V2 host", () => {
  it("GET task: session from the cookie, the database is called with that session id (never a client value)", async () => {
    const { app, identityCalls, packShipCalls } = setup();
    const r = await request(app).get(`/api/v1/packing/tasks/${TASK}`).set("cookie", cookies(false));
    expect(r.status).toBe(200); expect(r.body.taskId).toBe(TASK); expect(r.body.facilityCode).toBe("LV2TEST");
    expect(r.headers["cache-control"]).toBe("no-store");
    expect(identityCalls[0].values[0].equals(H(TOKEN, SK))).toBe(true); expect(identityCalls[0].values[1]).toBeNull();
    expect(packShipCalls[0].sql).toContain("packship_get_task_v2"); expect(packShipCalls[0].values).toEqual([SID, TASK]);
  });
  it("a valid session is touched like GET /api/v1/auth/session (90 s), and a failed touch does not block", async () => {
    const { app, identityCalls } = setup();
    expect((await request(app).get(`/api/v1/packing/tasks/${TASK}`).set("cookie", cookies(false))).status).toBe(200);
    const touch = identityCalls.find(c => c.sql.includes("touch_auth_session_if_due_v3"));
    expect(touch?.values).toEqual([SID, 90]);
    expect((await request(setup({ touchFails: true }).app).get(`/api/v1/packing/tasks/${TASK}`).set("cookie", cookies(false))).status).toBe(200);
  });
  it("no cookie: 401, and no Pack/Ship database call", async () => {
    const { app, packShipCalls } = setup();
    const r = await request(app).get(`/api/v1/packing/tasks/${TASK}`);
    expect(r.status).toBe(401); expect(r.body.code).toBe("PACKSHIP_SESSION_INVALID"); expect(packShipCalls).toHaveLength(0);
  });
  it("expired/unknown session (no envelope row): 401", async () => {
    const r = await request(setup({ envelope: null }).app).get(`/api/v1/packing/tasks/${TASK}`).set("cookie", cookies(false));
    expect(r.status).toBe(401);
  });
  it("valid session without PACKSHIP_PACK: 403", async () => {
    const r = await request(setup({ envelope: { auth_session_id: SID, device_id: "d", permissions: ["INVENTORY_VIEW"] } }).app)
      .get(`/api/v1/packing/tasks/${TASK}`).set("cookie", cookies(false));
    expect(r.status).toBe(403); expect(r.body.code).toBe("PACKSHIP_ACTOR_NOT_ALLOWED");
  });
  it("restricted session (must change password): 403", async () => {
    const r = await request(setup({ envelope: { auth_session_id: SID, device_id: "d", permissions: ["PACKSHIP_PACK"], restricted_session: true } }).app)
      .get(`/api/v1/packing/tasks/${TASK}`).set("cookie", cookies(false));
    expect(r.status).toBe(403);
  });
  it("identity database unavailable: 503, not 500", async () => {
    const r = await request(setup({ identityDown: true }).app).get(`/api/v1/packing/tasks/${TASK}`).set("cookie", cookies(false));
    expect(r.status).toBe(503); expect(r.body.code).toBe("AUTH_SECURITY_DEPENDENCY_UNAVAILABLE");
  });
  it("POST claim with origin + CSRF + headers: 200, calls claim with the cookie's session and the client's keys", async () => {
    const { app, packShipCalls } = setup();
    const r = await claim(app);
    expect(r.status).toBe(200);
    expect(packShipCalls[0].sql).toContain("packship_claim_task_v2");
    expect(packShipCalls[0].values).toEqual([SID, TASK, IDS["idempotency-key"], IDS["x-request-id"], IDS["x-correlation-id"]]);
  });
  it("POST from another origin: 403 by 6.1B's exactOrigin, nothing reaches the database", async () => {
    const { app, packShipCalls } = setup();
    const r = await request(app).post(`/api/v1/packing/tasks/${TASK}/claim`).set("origin", "https://evil.example")
      .set("cookie", cookies()).set("x-csrf-token", CSRF).set(IDS).send({});
    expect(r.status).toBe(403); expect(r.body).toEqual({ code: "REQUEST_REJECTED" }); expect(packShipCalls).toHaveLength(0);
  });
  it("POST cross-site fetch: 403 by 6.1B's fetchMetadataGuard", async () => {
    const r = await claim(setup().app).set("sec-fetch-site", "cross-site");
    expect(r.status).toBe(403);
  });
  it("POST without the CSRF header, or a header that does not match: 403 CSRF_REJECTED", async () => {
    const { app, packShipCalls } = setup();
    const r1 = await request(app).post(`/api/v1/packing/tasks/${TASK}/claim`).set("origin", ORIGIN).set("cookie", cookies()).set(IDS).send({});
    const r2 = await claim(app).set("x-csrf-token", "other");
    expect([r1.status, r2.status]).toEqual([403, 403]); expect(r1.body).toEqual({ code: "CSRF_REJECTED" }); expect(packShipCalls).toHaveLength(0);
  });
  it("POST with a CSRF token the database does not accept for this session: 403", async () => {
    expect((await claim(setup({ csrfValid: false }).app)).status).toBe(403);
  });
  it("POST with no session cookie: CSRF step passes through, then 401 (never reaches the database)", async () => {
    const { app, packShipCalls } = setup();
    const r = await request(app).post(`/api/v1/packing/tasks/${TASK}/claim`).set("origin", ORIGIN).set(IDS).send({});
    expect(r.status).toBe(401); expect(packShipCalls).toHaveLength(0);
  });
  it("missing X-Request-ID: 400, not 500", async () => {
    const r = await claim(setup().app).unset("x-request-id");
    expect(r.status).toBe(400); expect(r.body.code).toBe("X_REQUEST_ID_INVALID");
  });
  it("database refusal (raised code) maps to its status", async () => {
    const err = Object.assign(new Error("PACKSHIP_TASK_CLAIMED_BY_OTHER"), { code: "P0001" });
    const r = await claim(setup({ packShip: () => { throw err; } }).app);
    expect(r.status).toBe(409); expect(r.body).toEqual({ code: "PACKSHIP_TASK_CLAIMED_BY_OTHER" });
  });
  it.each([
    ["WRONG_ITEM", "PACK_WRONG_SERIALIZED_ITEM"], ["ITEM_ALREADY_VERIFIED", "PACK_DUPLICATE_SCAN"],
    ["WRONG_SOURCE", "PACK_WRONG_SOURCE"], ["TRACKING_MISMATCH", "SHIP_TRACKING_MISMATCH"],
    ["PACKAGE_MISMATCH", "SHIP_PACKAGE_LABEL_MISMATCH"], ["WRONG_LOCATION", "PACK_WRONG_OUTBOUND_LOCATION"],
  ])("wrong scan %s: 422 %s (PR #13 REJECTED = scan again), never 5xx/UNCERTAIN", async (db, pwa) => {
    const { app } = setup({ packShip: () => ({ rows: [{ result: { ok: false, code: db, task: SNAP, scanEventId: 9 } }] }) });
    const r = await request(app).post(`/api/v1/packing/tasks/${TASK}/scan-item`).set("origin", ORIGIN)
      .set("cookie", cookies()).set("x-csrf-token", CSRF).set(IDS).send({ barcode: "X-1", rowVersion: 2 });
    expect(r.status).toBe(422); expect(r.body).toEqual({ code: pwa });
  });
  it("an unknown ok:false code is still not reported as success", async () => {
    const { app } = setup({ packShip: () => ({ rows: [{ result: { ok: false, code: "SOMETHING_NEW", task: SNAP } }] }) });
    const r = await claim(app);
    expect(r.status).toBeGreaterThanOrEqual(400); expect(r.body.taskId).toBeUndefined();
  });
  it("host 404 under a Pack/Ship path is flattened to {code}", async () => {
    const r = await request(setup().app).get("/api/v1/packing/unknown");
    expect(r.status).toBe(404); expect(r.body).toEqual({ code: "NOT_FOUND" });
  });
  it("other paths are untouched: /api/v1/auth and unknown /api/v1/packing paths fall through to the host", async () => {
    const { app, identityCalls } = setup();
    const auth = await request(app).get("/api/v1/auth/session");
    expect(auth.status).toBe(404); expect(auth.body).toEqual({ error: { code: "NOT_FOUND" } }); // shape untouched off Pack/Ship
    expect((await request(app).get("/api/v1/packing/unknown")).status).toBe(404);
    expect(identityCalls).toHaveLength(0);
  });
});
