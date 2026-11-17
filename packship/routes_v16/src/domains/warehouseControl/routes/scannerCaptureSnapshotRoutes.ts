import crypto from "node:crypto";
import { Router } from "express";
import type { Pool } from "pg";
import type { TrustedWarehouseIdentityReader } from "../../packShip/auth/PackShipPrincipalResolver";

export const CAPTURE_SNAPSHOT_PATH = "/api/v1/warehouse-control/scanner/capture-snapshot";
export const CAPTURE_SNAPSHOT_CONTRACT_VERSION = "2.0";

/**
 * GET /api/v1/warehouse-control/scanner/capture-snapshot — the authoritative Warehouse Control scanner configuration
 * the PWA must load before starting the camera (scanner snapshot contract v1.0 §4 selection; response in PR #13's
 * decodeWarehouseControlCaptureSnapshot shape: scannerProfile + symbologies at the top level, plus `meta`).
 * The device and facility come from the server-side session only; the request carries nothing that selects a
 * profile (query parameters are ignored). Read only. Never returns a default, guessed or partial snapshot.
 */
export function buildCaptureSnapshotRoutes(d: { readIdentity: TrustedWarehouseIdentityReader; pool: Pool }): Router {
  const r = Router();
  r.get(CAPTURE_SNAPSHOT_PATH, async (req, res, next) => {
    try {
      res.setHeader("Cache-Control", "no-store");
      const requestId = (req as any).requestId;
      if (typeof requestId === "string") res.setHeader("X-Request-ID", requestId);
      const ctx = await d.readIdentity(req, res);
      if (!ctx || !ctx.authenticated || !ctx.activeSession) return void res.status(401).json({ code: "AUTH_REQUIRED" });
      if (ctx.restrictedSession) return void res.status(403).json({ code: "PERMISSION_DENIED" });
      if (!ctx.facilityId) return void res.status(404).json({ code: "SCANNER_PROFILE_NOT_FOUND" });

      let out: any;
      try {
        const q = await d.pool.query("SELECT warehouse_control.get_capture_authority_snapshot_v1($1,$2) AS r",
          [ctx.deviceId ?? null, ctx.facilityId]);
        out = q.rows[0]?.r;
      } catch {
        return void res.status(503).json({ code: "SCANNER_SNAPSHOT_UNAVAILABLE" });
      }
      if (!out || typeof out !== "object") return void res.status(503).json({ code: "SCANNER_SNAPSHOT_UNAVAILABLE" });
      if (out.result === "NOT_FOUND") return void res.status(404).json({ code: "SCANNER_PROFILE_NOT_FOUND" });
      if (out.result === "AMBIGUOUS") return void res.status(409).json({ code: "SCANNER_PROFILE_AMBIGUOUS" });
      if (out.result !== "OK" || !out.scannerProfile || !Array.isArray(out.symbologies) || !out.asset)
        return void res.status(503).json({ code: "SCANNER_SNAPSHOT_UNAVAILABLE" });

      const snapshot = { scannerProfile: out.scannerProfile, symbologies: out.symbologies };
      const contentHash = "sha256:" + crypto.createHash("sha256").update(canonicalJson(snapshot)).digest("hex");
      const etag = `"${contentHash}"`;
      res.setHeader("ETag", etag);
      const inm = req.get("if-none-match");
      if (inm && inm.split(",").map(s => s.trim()).includes(etag)) return void res.status(304).end();
      console.log(JSON.stringify({ level: "info", msg: "capture snapshot", requestId, assetId: out.asset.assetId,
        binding: out.binding, contentHash }));
      res.json({
        ...snapshot,
        meta: {
          contractVersion: CAPTURE_SNAPSHOT_CONTRACT_VERSION,
          assetId: out.asset.assetId, assetCode: out.asset.assetCode, binding: out.binding,
          facilityId: out.asset.facilityId, stationId: out.asset.stationId ?? null,
          contentHash, issuedAt: new Date().toISOString(),
        },
      });
    } catch (e) {
      next(e);
    }
  });
  return r;
}

/** Sorted keys, no whitespace: the hash changes on any profile or symbology change and on nothing else. */
export function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canonicalJson).join(",") + "]";
  const o = v as Record<string, unknown>;
  return "{" + Object.keys(o).sort().filter(k => o[k] !== undefined)
    .map(k => JSON.stringify(k) + ":" + canonicalJson(o[k])).join(",") + "}";
}
