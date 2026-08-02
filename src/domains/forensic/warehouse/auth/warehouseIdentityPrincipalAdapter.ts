import type { RequestHandler } from 'express';
import type { Pool } from 'pg';

function requiredTenantKey(): string {
  const value = process.env.DOMAIN7_TENANT_KEY?.trim();
  if (!value) {
    throw new Error('DOMAIN7_TENANT_KEY is required.');
  }
  return value;
}

export function attachForensicPrincipal(pool: Pool): RequestHandler {
  return async (req, res, next): Promise<void> => {
    try {
      const authSessionId = res.locals.authSessionId;
      if (!authSessionId) {
        res.status(401).json({ ok: false, error: 'UNAUTHENTICATED' });
        return;
      }

      const { rows } = await pool.query(
        `SELECT
           a.auth_session_id,
           a.user_id,
           a.employee_id,
           a.device_id,
           a.warehouse_device_session_id,
           e.facility_id,
           e.default_station_id,
           u.display_name,
           COALESCE(
             array_agg(DISTINCT permission_name)
               FILTER (WHERE permission_name IS NOT NULL),
             ARRAY[]::text[]
           ) AS permissions
         FROM warehouse_identity.auth_sessions AS a
         JOIN warehouse_identity.users AS u
           ON u.user_id = a.user_id
         JOIN warehouse_identity.employees AS e
           ON e.employee_id = a.employee_id
         LEFT JOIN warehouse_identity.user_role_assignments AS ura
           ON ura.user_id = u.user_id
          AND ura.revoked_at IS NULL
          AND ura.valid_from <= clock_timestamp()
          AND (ura.valid_until IS NULL OR ura.valid_until > clock_timestamp())
         LEFT JOIN warehouse_identity.roles AS r
           ON r.role_id = ura.role_id
          AND r.active
         LEFT JOIN LATERAL
           unnest(COALESCE(r.permissions, ARRAY[]::text[])) AS permission_name
           ON true
         WHERE a.auth_session_id = $1::uuid
           AND a.revoked_at IS NULL
           AND a.idle_expires_at > clock_timestamp()
           AND a.absolute_expires_at > clock_timestamp()
           AND u.status = 'ACTIVE'
           AND e.employment_status = 'ACTIVE'
         GROUP BY
           a.auth_session_id,
           a.user_id,
           a.employee_id,
           a.device_id,
           a.warehouse_device_session_id,
           e.facility_id,
           e.default_station_id,
           u.display_name`,
        [authSessionId],
      );

      const row = rows[0];
      if (!row) {
        res.status(401).json({ ok: false, error: 'SESSION_INVALID' });
        return;
      }

      const required = [
        row.auth_session_id,
        row.user_id,
        row.employee_id,
        row.device_id,
        row.warehouse_device_session_id,
        row.facility_id,
        row.display_name,
      ];
      if (required.some(value => value === null || value === undefined || value === '')) {
        throw new Error('FORENSIC_PRINCIPAL_CONTEXT_INCOMPLETE');
      }

      const permissions = Array.isArray(row.permissions)
        ? row.permissions.map(String)
        : [];

      req.forensicPrincipal = {
        tenantKey: requiredTenantKey(),
        actorType: 'user',
        actorId: String(row.user_id),
        actorName: String(row.display_name),
        permissions: new Set<string>(permissions),
        warehouse: {
          warehouseUserId: String(row.user_id),
          warehouseEmployeeId: String(row.employee_id),
          warehouseAuthSessionId: String(row.auth_session_id),
          warehouseDeviceSessionId: String(row.warehouse_device_session_id),
          facilityId: String(row.facility_id),
          ...(row.default_station_id
            ? { stationId: String(row.default_station_id) }
            : {}),
          deviceId: String(row.device_id),
        },
      };
      next();
    } catch (error) {
      next(error);
    }
  };
}
