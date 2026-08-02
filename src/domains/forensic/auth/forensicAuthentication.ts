import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { z } from 'zod';

const sessionIdSchema = z.string().uuid();

function bearerSessionId(req: Request): string | undefined {
  const authorization = req.header('authorization')?.trim();
  if (!authorization) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  return match?.[1]?.trim();
}

/**
 * Extracts the opaque warehouse authentication session identifier.
 * This middleware does not authenticate by itself. The following
 * attachForensicPrincipal middleware validates the active session in PostgreSQL.
 *
 * Preferred:
 *   Authorization: Bearer <warehouse auth session UUID>
 *
 * Backward-compatible during PWA cutover:
 *   x-warehouse-auth-session: <warehouse auth session UUID>
 */
export const requireForensicAuthenticationSession: RequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  const bearer = bearerSessionId(req);
  const legacy = req.header('x-warehouse-auth-session')?.trim();

  if (bearer && legacy && bearer.toLowerCase() !== legacy.toLowerCase()) {
    res.status(401).json({
      ok: false,
      error: 'FORENSIC_AUTH_SESSION_MISMATCH',
    });
    return;
  }

  const parsed = sessionIdSchema.safeParse(bearer ?? legacy);
  if (!parsed.success) {
    res.status(401).json({
      ok: false,
      error: 'FORENSIC_AUTHENTICATION_REQUIRED',
    });
    return;
  }

  res.locals.authSessionId = parsed.data;
  next();
};
