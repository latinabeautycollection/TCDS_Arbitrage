import type{Pool}from'pg';import type{AccessPrincipal,AccessScope,AccessSubjectType,ProcessContext}from'../models/accessTypes';
export class BreakGlassRepository{constructor(private readonly pool:Pool){}
 async request(p:AccessPrincipal,i:{subjectType:AccessSubjectType;subjectReference:string;reason:string;scopes:readonly AccessScope[];
 expiresAt:string;idempotencyKey:string},ctx:ProcessContext){const{rows}=await this.pool.query(
 `SELECT forensic.d7h1_r5_request_break_glass($1,$2,$3,$4,$5::jsonb,$6::uuid,$7::uuid,$8::timestamptz,$9,$10::uuid,$11::uuid) id`,
 [p.tenantKey,i.subjectType,i.subjectReference,i.reason,JSON.stringify(i.scopes),p.userId,p.authSessionId,i.expiresAt,
 i.idempotencyKey,ctx.processRunId,ctx.correlationId]);return rows[0]}
 async decide(p:AccessPrincipal,id:string,decision:'APPROVE'|'REJECT',reason:string,ctx:ProcessContext){const{rows}=await this.pool.query(
 `SELECT forensic.d7h1_r5_decide_break_glass($1::uuid,$2,$3::uuid,$4::uuid,$5,$6::uuid,$7::uuid) id`,
 [id,decision,p.userId,p.authSessionId,reason,ctx.processRunId,ctx.correlationId]);return rows[0]}
 async close(p:AccessPrincipal,id:string,mode:'CLOSE'|'REVOKE',reason:string,ctx:ProcessContext){await this.pool.query(
 `SELECT forensic.d7h1_r5_close_break_glass($1::uuid,$2,$3::uuid,$4::uuid,$5,$6::uuid,$7::uuid)`,
 [id,mode,p.userId,p.authSessionId,reason,ctx.processRunId,ctx.correlationId])}
}
