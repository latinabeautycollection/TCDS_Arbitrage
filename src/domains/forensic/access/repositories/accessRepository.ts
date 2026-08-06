import type{Pool}from'pg';import type{AccessAuthorization,AccessPrincipal,BeginAccessInput,ProcessContext}from'../models/accessTypes';
interface BeginRow{receipt_id:string;authorization_token:string;authorization_expires_at:string;authorization_source:'GRANT'|'BREAK_GLASS';authorization_source_id:string}
export class AccessRepository{
 constructor(private readonly pool:Pool){}
 async begin(p:AccessPrincipal,i:BeginAccessInput,ctx:ProcessContext):Promise<AccessAuthorization>{
  const{rows}=await this.pool.query<BeginRow>(`SELECT * FROM forensic.d7h1_r5_begin_access(
   $1,$2::uuid,$3::uuid,$4::uuid,$5,$6,$7,$8,$9,$10::uuid,$11::uuid,$12::uuid,$13::inet,$14)`,
   [p.tenantKey,p.userId,p.authSessionId,p.deviceId??null,i.subjectType,i.subjectReference,i.action,i.scope,i.purpose,
    i.breakGlassSessionId??null,ctx.processRunId,ctx.correlationId,i.clientIp??null,i.userAgentHash??null]);
  const r=rows[0];if(!r)throw new Error('Authorization not returned');
  return{receiptId:r.receipt_id,token:r.authorization_token,expiresAt:r.authorization_expires_at,
   source:r.authorization_source,sourceId:r.authorization_source_id}}
 async complete(id:string,token:string,bytes:number|undefined,hash:string|undefined,payload:unknown,ctx:ProcessContext){
  await this.pool.query(`SELECT forensic.d7h1_r5_complete_access($1::uuid,$2,$3,$4,$5::jsonb,$6::uuid,$7::uuid)`,
   [id,token,bytes??null,hash??null,JSON.stringify(payload),ctx.processRunId,ctx.correlationId])}
 async fail(id:string,token:string,code:string,payload:unknown,ctx:ProcessContext){
  await this.pool.query(`SELECT forensic.d7h1_r5_fail_access($1::uuid,$2,$3,$4::jsonb,$5::uuid,$6::uuid)`,
   [id,token,code,JSON.stringify(payload),ctx.processRunId,ctx.correlationId])}
}
