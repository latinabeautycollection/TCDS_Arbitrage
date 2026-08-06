import type{Pool}from'pg';import type{AccessPrincipal,AccessScope,ProcessContext}from'../models/accessTypes';
export class AccessRiskRepository{constructor(private readonly pool:Pool){}
 async profile(p:AccessPrincipal,i:{userId:string;date:string;policyCode:string;idempotencyKey:string},x:ProcessContext){
  const{rows}=await this.pool.query(`SELECT forensic.d7h2_r5_profile_user($1,$2::uuid,$3::date,$4,$5,$6::uuid,$7::uuid) id`,
  [p.tenantKey,i.userId,i.date,i.policyCode,i.idempotencyKey,x.processRunId,x.correlationId]);return rows[0]}
 async open(p:AccessPrincipal,i:any,x:ProcessContext){const{rows}=await this.pool.query(`SELECT forensic.d7h2_r5_open_campaign(
  $1,$2,$3,$4::date,$5::date,$6::timestamptz,$7::jsonb,$8,$9::uuid,$10::uuid,$11,$12::uuid,$13::uuid) id`,
  [p.tenantKey,i.campaignCode,i.title,i.periodStart,i.periodEnd,i.dueAt,JSON.stringify(i.scope),i.policyCode,p.userId,p.authSessionId,
   i.idempotencyKey,x.processRunId,x.correlationId]);return rows[0]}
 async decide(p:AccessPrincipal,id:string,d:'RETAIN'|'MODIFY'|'REVOKE',reason:string,scopes:readonly AccessScope[],x:ProcessContext){
  const{rows}=await this.pool.query(`SELECT forensic.d7h2_r5_decide_item($1::uuid,$2,$3,$4::jsonb,$5::uuid,$6::uuid,$7::uuid,$8::uuid) id`,
  [id,d,reason,JSON.stringify(scopes),p.userId,p.authSessionId,x.processRunId,x.correlationId]);return rows[0]}
 async close(p:AccessPrincipal,id:string,x:ProcessContext){const{rows}=await this.pool.query(
  `SELECT forensic.d7h2_r5_close_campaign($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid) id`,
  [id,p.userId,p.authSessionId,x.processRunId,x.correlationId]);return rows[0]}
 async transition(p:AccessPrincipal,id:string,state:string,reason:string,owner:string|undefined,x:ProcessContext){
  const{rows}=await this.pool.query(`SELECT forensic.d7h2_r5_transition_finding($1::uuid,$2,$3,$4::uuid,$5::uuid,$6::uuid,$7::uuid,$8::uuid) id`,
  [id,state,reason,owner??null,p.userId,p.authSessionId,x.processRunId,x.correlationId]);return rows[0]}
 async campaigns(p:AccessPrincipal,status?:string){const{rows}=await this.pool.query(
  `SELECT * FROM forensic.d7h2_r5_list_campaigns($1,$2,$3::uuid,$4::uuid)`,[p.tenantKey,status??null,p.userId,p.authSessionId]);return rows}
 async campaign(p:AccessPrincipal,id:string){const{rows}=await this.pool.query(
  `SELECT * FROM forensic.d7h2_r5_get_campaign($1::uuid,$2,$3::uuid,$4::uuid)`,[id,p.tenantKey,p.userId,p.authSessionId]);return rows[0]??null}
 async items(p:AccessPrincipal,id:string){const{rows}=await this.pool.query(
  `SELECT * FROM forensic.d7h2_r5_list_items($1::uuid,$2,$3::uuid,$4::uuid)`,[id,p.tenantKey,p.userId,p.authSessionId]);return rows}
 async findings(p:AccessPrincipal,status?:string){const{rows}=await this.pool.query(
  `SELECT * FROM forensic.d7h2_r5_list_findings($1,$2,$3::uuid,$4::uuid)`,[p.tenantKey,status??null,p.userId,p.authSessionId]);return rows}
}
