import type { Request } from "express";
import type { OperationHeaders } from "../contracts/packShipRouteTypes";
import { routeError } from "../auth/PackShipPrincipalResolver";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function requireOperationHeaders(req: Request): OperationHeaders {
  const requestId = req.header("X-Request-ID");
  const correlationId = req.header("X-Correlation-ID");
  const idempotencyKey = req.header("Idempotency-Key");

  if (!requestId || !UUID.test(requestId)) {
    throw routeError(400, "X_REQUEST_ID_INVALID");
  }
  if (!correlationId || !UUID.test(correlationId)) {
    throw routeError(400, "X_CORRELATION_ID_INVALID");
  }
  if (!idempotencyKey || idempotencyKey.length < 8 || idempotencyKey.length > 200) {
    throw routeError(400, "PACKSHIP_IDEMPOTENCY_KEY_INVALID");
  }

  return { requestId, correlationId, idempotencyKey };
}
