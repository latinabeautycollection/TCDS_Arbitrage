"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireOperationHeaders = requireOperationHeaders;
const PackShipPrincipalResolver_1 = require("../auth/PackShipPrincipalResolver");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function requireOperationHeaders(req) {
    const requestId = req.header("X-Request-ID");
    const correlationId = req.header("X-Correlation-ID");
    const idempotencyKey = req.header("Idempotency-Key");
    if (!requestId || !UUID.test(requestId)) {
        throw (0, PackShipPrincipalResolver_1.routeError)(400, "X_REQUEST_ID_INVALID");
    }
    if (!correlationId || !UUID.test(correlationId)) {
        throw (0, PackShipPrincipalResolver_1.routeError)(400, "X_CORRELATION_ID_INVALID");
    }
    if (!idempotencyKey || idempotencyKey.length < 8 || idempotencyKey.length > 200) {
        throw (0, PackShipPrincipalResolver_1.routeError)(400, "PACKSHIP_IDEMPOTENCY_KEY_INVALID");
    }
    return { requestId, correlationId, idempotencyKey };
}
