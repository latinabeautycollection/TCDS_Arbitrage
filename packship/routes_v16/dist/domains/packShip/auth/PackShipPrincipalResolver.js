"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PackShipPrincipalResolver = void 0;
exports.routeError = routeError;
class PackShipPrincipalResolver {
    readIdentity;
    constructor(readIdentity) {
        this.readIdentity = readIdentity;
    }
    async resolve(req, res, requireCsrf) {
        const ctx = await this.readIdentity(req, res);
        if (!ctx || !ctx.authenticated || !ctx.activeSession || !ctx.deviceAssertionVerified ||
            typeof ctx.authSessionId !== "string" ||
            !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(ctx.authSessionId)) {
            throw routeError(401, "PACKSHIP_SESSION_INVALID");
        }
        if (ctx.restrictedSession) {
            throw routeError(403, "PACKSHIP_ACTOR_NOT_ALLOWED");
        }
        if (requireCsrf && ctx.csrfVerified !== true) {
            throw routeError(403, "CSRF_VALIDATION_REQUIRED");
        }
        if (!Array.isArray(ctx.permissions) || !ctx.permissions.includes("PACKSHIP_PACK")) {
            throw routeError(403, "PACKSHIP_ACTOR_NOT_ALLOWED");
        }
        return { authSessionId: ctx.authSessionId };
    }
}
exports.PackShipPrincipalResolver = PackShipPrincipalResolver;
function routeError(status, code, detail) {
    const error = new Error(code);
    error.status = status;
    error.code = code;
    error.detail = detail;
    return error;
}
