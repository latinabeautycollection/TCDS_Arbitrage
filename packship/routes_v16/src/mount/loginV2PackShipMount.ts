import crypto from "node:crypto";
import type { Express, Request, RequestHandler } from "express";
import type { Pool } from "pg";
import { PackShipPrincipalResolver, routeError, type TrustedWarehouseIdentityReader } from "../domains/packShip/auth/PackShipPrincipalResolver";
import { PackShipV02Repository } from "../domains/packShip/repositories/PackShipV02Repository";
import { PackShipTaskResponseMapper } from "../domains/packShip/mappers/PackShipTaskResponseMapper";
import { PackShipRouteService } from "../domains/packShip/services/PackShipRouteService";
import { buildPackShipRoutes } from "../domains/packShip/routes/packShipRoutes";
import { packShipErrorMiddleware } from "../domains/packShip/routes/packShipErrorMiddleware";
import { buildCaptureSnapshotRoutes } from "../domains/warehouseControl/routes/scannerCaptureSnapshotRoutes";

/** The deployed 6.1B build's own request guards (dist/express/security), injected so nothing is reimplemented. */
export type LoginV2Security = {
  requestIds: RequestHandler;
  securityHeaders: RequestHandler;
  noStore: RequestHandler;
  exactOrigin: (origin: string) => RequestHandler;
  fetchMetadataGuard: RequestHandler;
  requireCsrf: (pool: Pool, sessionHashKey: string, csrfHashKey: string) => RequestHandler;
  cookie: (req: Request, name: string) => string | undefined;
};

export type PackShipMountDeps = {
  /** The Login V2 pool (tcds_login_api): session envelope and CSRF validation only. */
  identityPool: Pool;
  /** Dedicated pool on tcds_login_packship (member of tcds_packship_api only): packship_*_v2 functions only. */
  packShipPool: Pool;
  sessionHashKey: string;
  csrfHashKey: string;
  publicOrigin: string;
  security: LoginV2Security;
};

export const SESSION_COOKIE = "__Host-tcds_session";
export const PACKSHIP_PATHS = ["/api/v1/packing", "/api/v1/shipments"];
export const WAREHOUSE_CONTROL_PATH = "/api/v1/warehouse-control";
const MUTATION = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const CSRF_PASSED = Symbol("packShipCsrfPassed");

/**
 * Reads the Warehouse Identity session exactly the way the deployed 6.1B admin guard does:
 * HMAC(session cookie, SESSION_HASH_KEY) → warehouse_identity.runtime_session_envelope_by_token_v1.
 * Called with no permission, so "no row" means the session itself is invalid (401), and the PACKSHIP_PACK check
 * on the returned permissions gives 403. The V0.2 functions re-check session, device and permission in the database.
 */
export function createLoginV2IdentityReader(d: Pick<PackShipMountDeps, "identityPool" | "sessionHashKey" | "security">): TrustedWarehouseIdentityReader {
  const invalid = { authenticated: false, activeSession: false, deviceAssertionVerified: false, restrictedSession: false,
    authSessionId: "", permissions: [] as string[] };
  return async (req) => {
    const token = d.security.cookie(req, SESSION_COOKIE);
    if (!token) return invalid;
    const hash = crypto.createHmac("sha256", d.sessionHashKey).update(token).digest();
    let x: any;
    try {
      const q = await d.identityPool.query(
        "SELECT * FROM warehouse_identity.runtime_session_envelope_by_token_v1($1,$2)", [hash, null]);
      x = q.rows[0];
    } catch {
      throw routeError(503, "AUTH_SECURITY_DEPENDENCY_UNAVAILABLE");
    }
    if (!x) return invalid;
    // Same best-effort idle-timer extension 6.1B's GET /api/v1/auth/session does (90 s coalescing), so a packer who
    // only uses Pack/Ship is not signed out mid-task. A failed touch never blocks the request.
    await d.identityPool.query("SELECT warehouse_identity.touch_auth_session_if_due_v3($1,$2)", [x.auth_session_id, 90])
      .catch(() => undefined);
    return {
      authenticated: true,
      activeSession: true,
      // The session is bound to a device at sign-in (device proof / passkey); V0.2 rejects inactive or moved devices.
      deviceAssertionVerified: typeof x.device_id === "string" && x.device_id.length > 0,
      // Mutations are only reachable after 6.1B's requireCsrf passed with a session cookie present.
      csrfVerified: MUTATION.has(req.method) ? (req as any)[CSRF_PASSED] === true : undefined,
      restrictedSession: x.restricted_session === true,
      authSessionId: x.auth_session_id,
      permissions: Array.isArray(x.permissions) ? x.permissions : [],
      deviceId: typeof x.device_id === "string" ? x.device_id : null,
      facilityId: typeof x.facility_id === "string" ? x.facility_id : null,
    };
  };
}

/**
 * 6.1B's guards (and the host's 404) answer `{error:{code}}`; PR #13's packShipApi reads a top-level `body.code`.
 * On Pack/Ship paths only, error bodies of that shape are re-emitted as `{code}`. Success bodies are untouched.
 */
export const flattenErrorShape: RequestHandler = (_req, res, next) => {
  const json = res.json.bind(res);
  res.json = (body?: any) => {
    if (res.statusCode >= 400 && body && typeof body === "object" && !("code" in body) &&
        body.error && typeof body.error.code === "string") return json({ code: body.error.code });
    return json(body);
  };
  next();
};

/** Mounts the Pack/Ship routes behind the same guards 6.1B uses for /api/v1/auth. Leaves every other path alone. */
export function mountPackShipOnLoginV2(app: Express, d: PackShipMountDeps): void {
  const s = d.security;
  const csrf = s.requireCsrf(d.identityPool, d.sessionHashKey, d.csrfHashKey);
  const csrfMarked: RequestHandler = (req, res, next) =>
    csrf(req, res, (err?: unknown) => {
      if (err) return next(err);
      if (MUTATION.has(req.method) && s.cookie(req, SESSION_COOKIE)) (req as any)[CSRF_PASSED] = true;
      next();
    });
  app.use([...PACKSHIP_PATHS, WAREHOUSE_CONTROL_PATH], flattenErrorShape, s.requestIds, s.securityHeaders, s.noStore,
    s.exactOrigin(d.publicOrigin), s.fetchMetadataGuard, csrfMarked);
  const reader = createLoginV2IdentityReader(d);
  const service = new PackShipRouteService(new PackShipV02Repository(d.packShipPool), new PackShipTaskResponseMapper());
  app.use(buildPackShipRoutes({ principalResolver: new PackShipPrincipalResolver(reader), service }));
  // Capture snapshot: any valid, unrestricted session (it serves every scanner workflow, not only Pack/Ship).
  // The Pack/Ship pool's login holds tcds_scanner_snapshot_api (930), which may only execute the snapshot function.
  app.use(buildCaptureSnapshotRoutes({ readIdentity: reader, pool: d.packShipPool }));
  app.use(PACKSHIP_PATHS, packShipErrorMiddleware);
}
