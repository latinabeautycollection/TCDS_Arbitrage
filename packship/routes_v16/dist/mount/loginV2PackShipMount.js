"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.flattenErrorShape = exports.PACKSHIP_PATHS = exports.SESSION_COOKIE = void 0;
exports.createLoginV2IdentityReader = createLoginV2IdentityReader;
exports.mountPackShipOnLoginV2 = mountPackShipOnLoginV2;
const node_crypto_1 = __importDefault(require("node:crypto"));
const PackShipPrincipalResolver_1 = require("../domains/packShip/auth/PackShipPrincipalResolver");
const PackShipV02Repository_1 = require("../domains/packShip/repositories/PackShipV02Repository");
const PackShipTaskResponseMapper_1 = require("../domains/packShip/mappers/PackShipTaskResponseMapper");
const PackShipRouteService_1 = require("../domains/packShip/services/PackShipRouteService");
const packShipRoutes_1 = require("../domains/packShip/routes/packShipRoutes");
const packShipErrorMiddleware_1 = require("../domains/packShip/routes/packShipErrorMiddleware");
exports.SESSION_COOKIE = "__Host-tcds_session";
exports.PACKSHIP_PATHS = ["/api/v1/packing", "/api/v1/shipments"];
const MUTATION = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const CSRF_PASSED = Symbol("packShipCsrfPassed");
/**
 * Reads the Warehouse Identity session exactly the way the deployed 6.1B admin guard does:
 * HMAC(session cookie, SESSION_HASH_KEY) → warehouse_identity.runtime_session_envelope_by_token_v1.
 * Called with no permission, so "no row" means the session itself is invalid (401), and the PACKSHIP_PACK check
 * on the returned permissions gives 403. The V0.2 functions re-check session, device and permission in the database.
 */
function createLoginV2IdentityReader(d) {
    const invalid = { authenticated: false, activeSession: false, deviceAssertionVerified: false, restrictedSession: false,
        authSessionId: "", permissions: [] };
    return async (req) => {
        const token = d.security.cookie(req, exports.SESSION_COOKIE);
        if (!token)
            return invalid;
        const hash = node_crypto_1.default.createHmac("sha256", d.sessionHashKey).update(token).digest();
        let x;
        try {
            const q = await d.identityPool.query("SELECT * FROM warehouse_identity.runtime_session_envelope_by_token_v1($1,$2)", [hash, null]);
            x = q.rows[0];
        }
        catch {
            throw (0, PackShipPrincipalResolver_1.routeError)(503, "AUTH_SECURITY_DEPENDENCY_UNAVAILABLE");
        }
        if (!x)
            return invalid;
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
            csrfVerified: MUTATION.has(req.method) ? req[CSRF_PASSED] === true : undefined,
            restrictedSession: x.restricted_session === true,
            authSessionId: x.auth_session_id,
            permissions: Array.isArray(x.permissions) ? x.permissions : [],
        };
    };
}
/**
 * 6.1B's guards (and the host's 404) answer `{error:{code}}`; PR #13's packShipApi reads a top-level `body.code`.
 * On Pack/Ship paths only, error bodies of that shape are re-emitted as `{code}`. Success bodies are untouched.
 */
const flattenErrorShape = (_req, res, next) => {
    const json = res.json.bind(res);
    res.json = (body) => {
        if (res.statusCode >= 400 && body && typeof body === "object" && !("code" in body) &&
            body.error && typeof body.error.code === "string")
            return json({ code: body.error.code });
        return json(body);
    };
    next();
};
exports.flattenErrorShape = flattenErrorShape;
/** Mounts the Pack/Ship routes behind the same guards 6.1B uses for /api/v1/auth. Leaves every other path alone. */
function mountPackShipOnLoginV2(app, d) {
    const s = d.security;
    const csrf = s.requireCsrf(d.identityPool, d.sessionHashKey, d.csrfHashKey);
    const csrfMarked = (req, res, next) => csrf(req, res, (err) => {
        if (err)
            return next(err);
        if (MUTATION.has(req.method) && s.cookie(req, exports.SESSION_COOKIE))
            req[CSRF_PASSED] = true;
        next();
    });
    app.use(exports.PACKSHIP_PATHS, exports.flattenErrorShape, s.requestIds, s.securityHeaders, s.noStore, s.exactOrigin(d.publicOrigin), s.fetchMetadataGuard, csrfMarked);
    const service = new PackShipRouteService_1.PackShipRouteService(new PackShipV02Repository_1.PackShipV02Repository(d.packShipPool), new PackShipTaskResponseMapper_1.PackShipTaskResponseMapper());
    app.use((0, packShipRoutes_1.buildPackShipRoutes)({ principalResolver: new PackShipPrincipalResolver_1.PackShipPrincipalResolver(createLoginV2IdentityReader(d)), service }));
    app.use(exports.PACKSHIP_PATHS, packShipErrorMiddleware_1.packShipErrorMiddleware);
}
