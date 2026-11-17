import type { Request, Response } from "express";
import type { PackShipRoutePrincipal } from "../contracts/packShipRouteTypes";

export type TrustedWarehouseIdentityReader = (
  req: Request,
  res: Response,
) => Promise<{
  authenticated: boolean;
  activeSession: boolean;
  deviceAssertionVerified: boolean;
  csrfVerified?: boolean;
  restrictedSession: boolean;
  authSessionId: string;
  permissions: readonly string[];
  /** From the server-side session envelope (device and facility chosen at sign-in). Never from the request. */
  deviceId?: string | null;
  facilityId?: string | null;
}>;

export class PackShipPrincipalResolver {
  constructor(private readonly readIdentity: TrustedWarehouseIdentityReader) {}

  async resolve(
    req: Request,
    res: Response,
    requireCsrf: boolean,
  ): Promise<PackShipRoutePrincipal> {
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

export function routeError(status: number, code: string, detail?: unknown): Error & {
  status: number;
  code: string;
  detail?: unknown;
} {
  const error = new Error(code) as Error & {
    status: number;
    code: string;
    detail?: unknown;
  };
  error.status = status;
  error.code = code;
  error.detail = detail;
  return error;
}
