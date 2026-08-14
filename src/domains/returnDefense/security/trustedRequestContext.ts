
import type { Request } from "express";

export interface AuthenticatedPrincipal {
  tenantId: string;
  actorId: string;
  roles: string[];
}

export interface TrustedRequest extends Request {
  auth?: AuthenticatedPrincipal;
  correlationId?: string;
}

export function requireTrustedContext(req: TrustedRequest) {
  if (!req.auth?.tenantId || !req.auth.actorId || !req.correlationId) {
    const error = new Error("Authenticated Domain 8 context is required");
    Object.assign(error, { statusCode: 401 });
    throw error;
  }
  return {
    tenantId: req.auth.tenantId,
    actorId: req.auth.actorId,
    correlationId: req.correlationId,
    roles: req.auth.roles,
  };
}
