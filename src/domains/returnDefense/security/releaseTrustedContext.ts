
import type { Request } from "express";

export interface ReleaseTrustedRequest extends Request {
  auth?: {
    tenantId: string;
    actorId: string;
    roles: string[];
  };
  correlationId?: string;
}

export function requireReleaseContext(
  request: ReleaseTrustedRequest,
  requiredRoles: string[],
) {
  if (!request.auth || !request.correlationId) {
    throw Object.assign(new Error("Authenticated release context required"), {
      statusCode: 401,
    });
  }
  if (!requiredRoles.some((role) => request.auth!.roles.includes(role))) {
    throw Object.assign(new Error("Insufficient release role"), {
      statusCode: 403,
    });
  }
  return {
    tenantId: request.auth.tenantId,
    actorId: request.auth.actorId,
    correlationId: request.correlationId,
  };
}
