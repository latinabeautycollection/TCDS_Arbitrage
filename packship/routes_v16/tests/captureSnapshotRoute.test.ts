import crypto from "node:crypto";
import express from "express";
import request from "supertest";
import * as security from "./loginV2Security.fixture";
import { mountPackShipOnLoginV2 } from "../src/mount/loginV2PackShipMount";
import { canonicalJson, CAPTURE_SNAPSHOT_PATH } from "../src/domains/warehouseControl/routes/scannerCaptureSnapshotRoutes";
import { decodeWarehouseControlCaptureSnapshot, validateAuthoritySnapshot } from "./pr13CaptureSnapshot.fixture";
// Real output of warehouse_control.get_capture_authority_snapshot_v1 (930) on the production-schema replica, with the
// LV2TEST facility default seeded exactly as prod_scanner_seed.sh does.
import DB_OK from "./captureSnapshot930.lv2test.json";

const ORIGIN = "https://warehouse-app.tcdsolutionsgroup.com";
const SK = "s".repeat(48), CK = "c".repeat(48), TOKEN = "session-token-abc";
const SID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", DEV = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const FAC = "b1a24146-8493-4b45-9fac-0b78eb4497d5";
const H = (v: string, k: string) => crypto.createHmac("sha256", k).update(v).digest();

function setup(opt: { envelope?: any; db?: any; dbDown?: boolean } = {}) {
  const calls: any[][] = [];
  const envelope = opt.envelope === undefined
    ? { auth_session_id: SID, device_id: DEV, facility_id: FAC, permissions: [], restricted_session: false } : opt.envelope;
  const identityPool: any = { query: async (sql: string, v: any[]) => {
    if (sql.includes("touch_auth_session_if_due_v3")) return { rows: [{}] };
    if (sql.includes("runtime_session_envelope_by_token_v1")) return { rows: envelope && v[0].equals(H(TOKEN, SK)) ? [envelope] : [] };
    throw new Error("unexpected identity query");
  } };
  const packShipPool: any = { query: async (sql: string, v: any[]) => {
    calls.push([sql, v]);
    if (opt.dbDown) throw new Error("connection refused");
    return { rows: [{ r: opt.db === undefined ? DB_OK : opt.db }] };
  } };
  const app = express();
  mountPackShipOnLoginV2(app, { identityPool, packShipPool, sessionHashKey: SK, csrfHashKey: CK, publicOrigin: ORIGIN, security });
  app.use((_q, res) => res.status(404).json({ error: { code: "NOT_FOUND" } }));
  return { app, calls };
}
const get = (app: any) => request(app).get(CAPTURE_SNAPSHOT_PATH).set("cookie", `__Host-tcds_session=${TOKEN}`);

describe("GET /api/v1/warehouse-control/scanner/capture-snapshot", () => {
  it("200: PR #13's own decoder and validator accept the real database output", async () => {
    const r = await get(setup().app);
    expect(r.status).toBe(200);
    const decoded = decodeWarehouseControlCaptureSnapshot(r.body);           // PR #13 verbatim
    expect(() => validateAuthoritySnapshot(decoded)).not.toThrow();           // PR #13 verbatim
    expect(decoded.scannerProfile.supportedSymbologies).toEqual(["CODE128", "EAN13", "UPC_A", "QR"]);
    expect(r.body.meta).toMatchObject({ contractVersion: "2.0", binding: "FACILITY", assetCode: "PWA-CAM-LV2TEST-01", facilityId: FAC });
  });
  it("device and facility come from the session envelope; query parameters change nothing", async () => {
    const { app, calls } = setup();
    await get(app).query({ facilityId: "11111111-1111-4111-8111-111111111111", deviceId: "x", assetId: "y" });
    expect(calls[0][0]).toContain("get_capture_authority_snapshot_v1"); expect(calls[0][1]).toEqual([DEV, FAC]);
  });
  it("headers: no-store, ETag = meta.contentHash = sha256 of the canonical snapshot; If-None-Match -> 304", async () => {
    const { app } = setup();
    const r = await get(app);
    const want = "sha256:" + crypto.createHash("sha256").update(canonicalJson({ scannerProfile: DB_OK.scannerProfile, symbologies: DB_OK.symbologies })).digest("hex");
    expect(r.headers["cache-control"]).toBe("no-store"); expect(r.body.meta.contentHash).toBe(want); expect(r.headers.etag).toBe(`"${want}"`);
    const r2 = await get(app).set("if-none-match", r.headers.etag);
    expect(r2.status).toBe(304); expect(r2.text).toBe("");
  });
  it("contentHash changes when the profile changes, and is stable otherwise", async () => {
    const h1 = (await get(setup().app)).body.meta.contentHash, h1b = (await get(setup().app)).body.meta.contentHash;
    const changed = { ...DB_OK, scannerProfile: { ...DB_OK.scannerProfile, duplicateSuppressionMs: 1500 } };
    const h2 = (await get(setup({ db: changed }).app)).body.meta.contentHash;
    expect(h1).toBe(h1b); expect(h2).not.toBe(h1);
  });
  it.each([
    [{ result: "NOT_FOUND", reason: "NO_FACILITY_DEFAULT" }, 404, "SCANNER_PROFILE_NOT_FOUND"],
    [{ result: "NOT_FOUND", reason: "DEVICE_ASSET_NOT_USABLE" }, 404, "SCANNER_PROFILE_NOT_FOUND"],
    [{ result: "AMBIGUOUS", count: 2 }, 409, "SCANNER_PROFILE_AMBIGUOUS"],
    [{ result: "WEIRD" }, 503, "SCANNER_SNAPSHOT_UNAVAILABLE"],
    [null, 503, "SCANNER_SNAPSHOT_UNAVAILABLE"],
  ])("database %j -> %i %s, never a snapshot body", async (db, status, code) => {
    const r = await get(setup({ db }).app);
    expect(r.status).toBe(status); expect(r.body).toEqual({ code });
  });
  it("database unavailable -> 503 (PWA: CAPTURE_POLICY_SNAPSHOT_UNAVAILABLE, retry allowed)", async () => {
    const r = await get(setup({ dbDown: true }).app);
    expect(r.status).toBe(503); expect(r.body).toEqual({ code: "SCANNER_SNAPSHOT_UNAVAILABLE" });
  });
  it("no session -> 401 (PWA: SESSION_EXPIRED); no database call", async () => {
    const { app, calls } = setup();
    expect((await request(app).get(CAPTURE_SNAPSHOT_PATH)).status).toBe(401); expect(calls).toHaveLength(0);
    expect((await get(setup({ envelope: null }).app)).status).toBe(401);
  });
  it("restricted session -> 403; session without a facility -> 404", async () => {
    expect((await get(setup({ envelope: { auth_session_id: SID, device_id: DEV, facility_id: FAC, restricted_session: true } }).app)).status).toBe(403);
    expect((await get(setup({ envelope: { auth_session_id: SID, device_id: DEV, facility_id: null } }).app)).status).toBe(404);
  });
  it("does not require PACKSHIP_PACK (it serves every scanner workflow)", async () => {
    const r = await get(setup({ envelope: { auth_session_id: SID, device_id: DEV, facility_id: FAC, permissions: ["INVENTORY_VIEW"] } }).app);
    expect(r.status).toBe(200);
  });
  it("other /api/v1/warehouse-control paths fall through to the host 404, flattened", async () => {
    const r = await request(setup().app).get("/api/v1/warehouse-control/other");
    expect(r.status).toBe(404); expect(r.body).toEqual({ code: "NOT_FOUND" });
  });
});
