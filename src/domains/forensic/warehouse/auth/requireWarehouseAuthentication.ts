import type { RequestHandler } from 'express';

// Domain 7B warehouse-forensic API: read the warehouse auth-session id from a header into
// res.locals.authSessionId. attachForensicPrincipal then VALIDATES it against
// warehouse_identity.auth_sessions and derives the principal (never trusts a client actor).
export const requireWarehouseAuthentication: RequestHandler = (req, res, next) => {
  const sid = req.header('x-warehouse-auth-session') ?? req.header('x-auth-session-id');
  if (!sid) { res.status(401).json({ ok: false, error: 'UNAUTHENTICATED' }); return; }
  res.locals.authSessionId = sid;
  next();
};
