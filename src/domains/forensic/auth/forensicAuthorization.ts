import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { AuthenticatedForensicPrincipal } from './forensicPrincipal';

export function principalOf(req: Request): AuthenticatedForensicPrincipal {
  if (!req.forensicPrincipal) {
    const error = new Error('Authenticated forensic principal required.');
    Object.assign(error, { status: 401, code: 'UNAUTHENTICATED' });
    throw error;
  }
  return req.forensicPrincipal;
}

export function requireForensicPermission(permission: string): RequestHandler {
  return (
    req: Request,
    res: Response,
    next: NextFunction,
  ): void => {
    const principal = req.forensicPrincipal;
    if (!principal) {
      res.status(401).json({ ok: false, error: 'UNAUTHENTICATED' });
      return;
    }
    if (!principal.permissions.has(permission)) {
      res.status(403).json({
        ok: false,
        error: 'FORBIDDEN',
        permission,
      });
      return;
    }
    next();
  };
}

export const requireWarehouseContext: RequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  if (!req.forensicPrincipal?.warehouse) {
    res.status(403).json({
      ok: false,
      error: 'WAREHOUSE_FORENSIC_CONTEXT_REQUIRED',
    });
    return;
  }
  next();
};
