import crypto from "node:crypto";

import type { RequestHandler } from "express";
import type { TrustedIntelligenceRequest } from "./trustedIntelligenceContext";

export interface ProductionPrincipal {
  tenantId: string;
  actorId: string;
  roles: string[];
}

export function domain8AuthAdapter(
  resolvePrincipal: (request: TrustedIntelligenceRequest) => ProductionPrincipal | undefined,
): RequestHandler {
  return (request, _response, next) => {
    const trusted = request as TrustedIntelligenceRequest;
    const principal = resolvePrincipal(trusted);
    if (principal) trusted.auth = principal;
    trusted.correlationId =
      trusted.correlationId ??
      String(request.headers["x-correlation-id"] ?? crypto.randomUUID());
    next();
  };
}
