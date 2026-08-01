import type { RequestHandler } from 'express';
import type { Pool } from 'pg';

export function attachForensicPrincipal(pool:Pool):RequestHandler{
  return async(req,res,next)=>{
    try{
      const authSessionId=res.locals.authSessionId as string|undefined;
      if(!authSessionId){res.status(401).json({ok:false,error:'UNAUTHENTICATED'});return;}
      const {rows}=await pool.query(
        `SELECT a.auth_session_id,a.user_id,a.employee_id,a.device_id,
          a.warehouse_device_session_id,e.facility_id,e.default_station_id,
          u.display_name,COALESCE(array_agg(DISTINCT p),ARRAY[]::text[]) permissions
         FROM warehouse_identity.auth_sessions a
         JOIN warehouse_identity.users u ON u.user_id=a.user_id
         JOIN warehouse_identity.employees e ON e.employee_id=a.employee_id
         LEFT JOIN warehouse_identity.user_role_assignments ura
          ON ura.user_id=u.user_id AND ura.revoked_at IS NULL
          AND ura.valid_from<=clock_timestamp()
          AND (ura.valid_until IS NULL OR ura.valid_until>clock_timestamp())
         LEFT JOIN warehouse_identity.roles r ON r.role_id=ura.role_id AND r.active
         LEFT JOIN LATERAL unnest(COALESCE(r.permissions,ARRAY[]::text[])) p ON true
         WHERE a.auth_session_id=$1::uuid AND a.revoked_at IS NULL
          AND a.idle_expires_at>clock_timestamp()
          AND a.absolute_expires_at>clock_timestamp()
          AND u.status='ACTIVE' AND e.employment_status='ACTIVE'
         GROUP BY a.auth_session_id,a.user_id,a.employee_id,a.device_id,
          a.warehouse_device_session_id,e.facility_id,e.default_station_id,u.display_name`,
        [authSessionId],
      );
      if(!rows[0]){res.status(401).json({ok:false,error:'SESSION_INVALID'});return;}
      const r=rows[0];
      req.forensicPrincipal={
        tenantKey:'TCDS',actorType:'user',actorId:String(r.user_id),
        actorName:String(r.display_name),warehouseUserId:String(r.user_id),
        warehouseEmployeeId:String(r.employee_id),warehouseAuthSessionId:String(r.auth_session_id),
        warehouseDeviceSessionId:String(r.warehouse_device_session_id),
        facilityId:String(r.facility_id),stationId:r.default_station_id?String(r.default_station_id):undefined,
        deviceId:String(r.device_id),permissions:r.permissions as string[],
      };
      next();
    }catch(error){next(error);}
  };
}
