import type { NextFunction, Request, Response } from 'express';
import type { Pool } from 'pg';
import type { ReturnPrincipal } from '../models/returnEvidenceTypes';
import { ReturnForensicError } from '../errors/ReturnForensicError';

export interface AuthenticatedWarehouseRequest extends Request {
  warehouseAuthSessionId?: string;
  returnPrincipal?: ReturnPrincipal;
  correlationId?: string;
}

export const attachReturnPrincipal = (pool: Pool) =>
  async (req: AuthenticatedWarehouseRequest, _res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.warehouseAuthSessionId) {
        throw new ReturnForensicError('UNAUTHENTICATED','Warehouse authentication required',401);
      }
      const { rows } = await pool.query<{
        auth_session_id: string; user_id: string; employee_id: string; device_id: string;
        warehouse_device_session_id: string; assurance_level: 'AAL1'|'AAL2';
        facility_id: string; default_station_id: string|null; display_name: string;
        permissions: string[];
      }>(
        `SELECT a.auth_session_id,a.user_id,a.employee_id,a.device_id,
          a.warehouse_device_session_id,a.assurance_level,e.facility_id,e.default_station_id,
          u.display_name,COALESCE(array_agg(DISTINCT permission) FILTER(WHERE permission IS NOT NULL),'{}') permissions
         FROM warehouse_identity.auth_sessions a
         JOIN warehouse_identity.users u ON u.user_id=a.user_id AND u.status='ACTIVE'
         JOIN warehouse_identity.employees e ON e.employee_id=a.employee_id
          AND e.user_id=a.user_id AND e.employment_status='ACTIVE'
         LEFT JOIN warehouse_identity.user_role_assignments ura ON ura.user_id=a.user_id
          AND ura.revoked_at IS NULL AND ura.valid_from<=clock_timestamp()
          AND (ura.valid_until IS NULL OR ura.valid_until>clock_timestamp())
          AND (ura.facility_id IS NULL OR ura.facility_id=e.facility_id)
         LEFT JOIN warehouse_identity.roles r ON r.role_id=ura.role_id AND r.active
         LEFT JOIN LATERAL unnest(r.permissions) permission ON true
         WHERE a.auth_session_id=$1::uuid AND a.revoked_at IS NULL
          AND a.idle_expires_at>clock_timestamp() AND a.absolute_expires_at>clock_timestamp()
         GROUP BY a.auth_session_id,a.user_id,a.employee_id,a.device_id,
          a.warehouse_device_session_id,a.assurance_level,e.facility_id,e.default_station_id,
          u.display_name`,
        [req.warehouseAuthSessionId],
      );
      const row = rows[0];
      if (!row) throw new ReturnForensicError('UNAUTHENTICATED','Warehouse session expired or invalid',401);
      req.returnPrincipal = {
        tenantKey: 'TCDS',
        actorType: 'user',
        actorId: row.user_id,
        actorName: row.display_name,
        warehouseUserId: row.user_id,
        warehouseEmployeeId: row.employee_id,
        warehouseAuthSessionId: row.auth_session_id,
        warehouseDeviceSessionId: row.warehouse_device_session_id,
        facilityId: row.facility_id,
        stationId: row.default_station_id ?? undefined,
        deviceId: row.device_id,
        assuranceLevel: row.assurance_level,
        permissions: row.permissions,
      };
      next();
    } catch (error) { next(error); }
  };
