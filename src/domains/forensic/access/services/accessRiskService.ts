import{randomUUID}from'node:crypto';import type{AccessPrincipal,AccessScope}from'../models/accessTypes';
import{AccessRiskRepository}from'../repositories/accessRiskRepository';import{ArbExecutionAdapter}from'../adapters/arbExecutionAdapter';
export class AccessRiskService{constructor(private readonly repo:AccessRiskRepository,private readonly exec:ArbExecutionAdapter){}
 private need(p:AccessPrincipal,perm:string){if(p.assuranceLevel!=='AAL2'||!p.permissions.includes(perm))throw new Error('Forbidden')}
 private async run<T>(p:AccessPrincipal,name:string,entity:string,pk:string,key:string,payload:unknown,fn:(x:any)=>Promise<T>,c:string=randomUUID()){
  const x=await this.exec.begin({processName:name,queueName:'domain7-access-risk',entityType:entity,entityPk:pk,
   idempotencyKey:key,principal:p,correlationId:c,payload});try{const v=await fn(x);await this.exec.finish(x,'SUCCEEDED',v);return v}
  catch(e){await this.exec.finish(x,'FAILED',{},e);throw e}}
 profile(p:AccessPrincipal,i:{userId:string;date:string;policyCode:string;idempotencyKey:string},c?:string){this.need(p,'forensic.access.security');
  return this.run(p,'D7H2_RISK_PROFILE','USER',i.userId,i.idempotencyKey,i,x=>this.repo.profile(p,i,x),c)}
 open(p:AccessPrincipal,i:any,c?:string){this.need(p,'forensic.access.certification.open');
  return this.run(p,'D7H2_CERT_OPEN','CAMPAIGN',i.campaignCode,i.idempotencyKey,i,x=>this.repo.open(p,i,x),c)}
 decide(p:AccessPrincipal,id:string,d:'RETAIN'|'MODIFY'|'REVOKE',reason:string,scopes:readonly AccessScope[],c?:string){
  this.need(p,'forensic.access.certification.decide');return this.run(p,'D7H2_CERT_DECIDE','ITEM',id,`${id}:${d}`,
  {d,reason,scopes},x=>this.repo.decide(p,id,d,reason,scopes,x),c)}
 close(p:AccessPrincipal,id:string,c?:string){this.need(p,'forensic.access.certification.close');
  return this.run(p,'D7H2_CERT_CLOSE','CAMPAIGN',id,`close:${id}`,{},x=>this.repo.close(p,id,x),c)}
 transition(p:AccessPrincipal,id:string,state:string,reason:string,owner?:string,c?:string){this.need(p,'forensic.access.security');
  return this.run(p,'D7H2_FINDING_TRANSITION','FINDING',id,`${id}:${state}`,{state,reason,owner},
  x=>this.repo.transition(p,id,state,reason,owner,x),c)}
 campaigns(p:AccessPrincipal,status?:string){this.need(p,'forensic.access.audit');return this.repo.campaigns(p,status)}
 campaign(p:AccessPrincipal,id:string){this.need(p,'forensic.access.audit');return this.repo.campaign(p,id)}
 items(p:AccessPrincipal,id:string){this.need(p,'forensic.access.audit');return this.repo.items(p,id)}
 findings(p:AccessPrincipal,status?:string){this.need(p,'forensic.access.security');return this.repo.findings(p,status)}
}
