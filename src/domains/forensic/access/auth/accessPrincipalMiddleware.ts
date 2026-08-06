import type { Pool } from 'pg';
import type { RequestHandler } from 'express';

export interface AccessForensicPrincipal {
  readonly tenantKey: string;
  readonly userId: string;
  readonly authSessionId: string;
  readonly deviceId?: string;
  readonly facilityId?: string;
  readonly assuranceLevel: 'AAL1' | 'AAL2';
  readonly permissions: readonly string[];
}

declare global {
  namespace Express {
    interface Request { accessPrincipal?: AccessForensicPrincipal }
  }
}

// Populates req.accessPrincipal for the Domain 7 access/resilience/certification/operations
// slices from the certified identity contract view. Runs after requireForensicAuthenticationSession
// (which validates the Bearer/x-warehouse-auth-session token into res.locals.authSessionId).
export function attachAccessPrincipal(pool: Pool): RequestHandler {
  return async (req, res, next): Promise<void> => {
    try {
      const authSessionId = res.locals.authSessionId as string | undefined;
      if (!authSessionId) { res.status(401).json({ ok: false, error: 'UNAUTHENTICATED' }); return; }
      const { rows } = await pool.query<{
        tenant_key: string; user_id: string; auth_session_id: string;
        device_id: string | null; assurance_level: 'AAL1' | 'AAL2'; permissions: string[] | null;
      }>(
        `SELECT tenant_key,user_id,auth_session_id,device_id,assurance_level,permissions
           FROM warehouse_identity.v_effective_access_context
          WHERE auth_session_id=$1::uuid AND session_active AND user_active`,
        [authSessionId],
      );
      const r = rows[0];
      if (!r) { res.status(401).json({ ok: false, error: 'SESSION_INVALID' }); return; }
      req.accessPrincipal = {
        tenantKey: r.tenant_key,
        userId: r.user_id,
        authSessionId: r.auth_session_id,
        deviceId: r.device_id ?? undefined,
        assuranceLevel: r.assurance_level,
        permissions: Object.freeze([...(r.permissions ?? [])]),
      };
      next();
    } catch (e) { next(e); }
  };
}
