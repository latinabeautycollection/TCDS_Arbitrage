import type{Pool}from'pg';import type{AccessPrincipal}from'../models/accessTypes';
interface Row{tenant_key:string;user_id:string;auth_session_id:string;device_id:string|null;facility_id:string|null;
 assurance_level:'AAL1'|'AAL2';permissions:string[]}
export class AccessPrincipalAdapter{
 constructor(private readonly pool:Pool){}
 async resolve(userId:string,authSessionId:string):Promise<AccessPrincipal>{
  const{rows}=await this.pool.query<Row>(`SELECT tenant_key,user_id,auth_session_id,device_id,facility_id,assurance_level,permissions
   FROM warehouse_identity.v_effective_access_context WHERE user_id=$1::uuid AND auth_session_id=$2::uuid
   AND session_active AND user_active`,[userId,authSessionId]);
  const r=rows[0];if(!r)throw new Error('Active identity context not found');
  return{tenantKey:r.tenant_key,userId:r.user_id,authSessionId:r.auth_session_id,
   deviceId:r.device_id??undefined,facilityId:r.facility_id??undefined,assuranceLevel:r.assurance_level,
   permissions:Object.freeze([...r.permissions])};
 }}
