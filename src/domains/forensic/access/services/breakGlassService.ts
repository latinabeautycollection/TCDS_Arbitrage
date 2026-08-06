import{randomUUID}from'node:crypto';import type{AccessPrincipal,AccessScope,AccessSubjectType}from'../models/accessTypes';
import{ArbExecutionAdapter}from'../adapters/arbExecutionAdapter';import{BreakGlassRepository}from'../repositories/breakGlassRepository';
export class BreakGlassService{constructor(private readonly repo:BreakGlassRepository,private readonly exec:ArbExecutionAdapter){}
 private require(p:AccessPrincipal,perm:string){if(p.assuranceLevel!=='AAL2'||!p.permissions.includes(perm))throw new Error('Forbidden')}
 async request(p:AccessPrincipal,i:{subjectType:AccessSubjectType;subjectReference:string;reason:string;scopes:readonly AccessScope[];
 expiresAt:string;idempotencyKey:string},c:string=randomUUID()){this.require(p,'forensic.break_glass.request');
  const x=await this.exec.begin({processName:'D7H1_BREAK_GLASS_REQUEST',queueName:'domain7-access',entityType:'BREAK_GLASS',
   entityPk:i.subjectReference,idempotencyKey:i.idempotencyKey,principal:p,correlationId:c,payload:i});
  try{const v=await this.repo.request(p,i,x);await this.exec.finish(x,'SUCCEEDED',v);return v}catch(e){await this.exec.finish(x,'FAILED',{},e);throw e}}
 async decide(p:AccessPrincipal,id:string,d:'APPROVE'|'REJECT',reason:string,c:string=randomUUID()){this.require(p,'forensic.break_glass.approve');
  const x=await this.exec.begin({processName:'D7H1_BREAK_GLASS_DECIDE',queueName:'domain7-access',entityType:'BREAK_GLASS',
   entityPk:id,idempotencyKey:`${id}:${d}`,principal:p,correlationId:c,payload:{d,reason}});
  try{const v=await this.repo.decide(p,id,d,reason,x);await this.exec.finish(x,'SUCCEEDED',v);return v}catch(e){await this.exec.finish(x,'FAILED',{},e);throw e}}
 async close(p:AccessPrincipal,id:string,m:'CLOSE'|'REVOKE',reason:string,c:string=randomUUID()){this.require(p,m==='REVOKE'?'forensic.break_glass.revoke':'forensic.break_glass.close');
  const x=await this.exec.begin({processName:'D7H1_BREAK_GLASS_CLOSE',queueName:'domain7-access',entityType:'BREAK_GLASS',
   entityPk:id,idempotencyKey:`${id}:${m}`,principal:p,correlationId:c,payload:{m,reason}});
  try{await this.repo.close(p,id,m,reason,x);await this.exec.finish(x,'SUCCEEDED',{id,m})}catch(e){await this.exec.finish(x,'FAILED',{},e);throw e}}
}
