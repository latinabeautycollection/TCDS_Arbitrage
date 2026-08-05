import{randomUUID}from'node:crypto';import type{AssurancePrincipal,FindingFilters,RunControlEvaluationInput}from'../models/assuranceTypes';
import{AssuranceError}from'../errors/AssuranceError';import{ArbProcessRunAdapter}from'../adapters/arbProcessRunAdapter';
import{AssuranceRepository}from'../repositories/assuranceRepository';
export class AssuranceService{constructor(private readonly repo:AssuranceRepository,private readonly runs:ArbProcessRunAdapter){}
 private need(p:AssurancePrincipal,supervisor=false){const perm=supervisor?'forensic.assurance.supervise':'forensic.assurance.operate';
 if(!p.permissions.includes(perm))throw new AssuranceError('FORBIDDEN','Forbidden',403);
 if(supervisor&&p.assuranceLevel!=='AAL2')throw new AssuranceError('AAL2_REQUIRED','AAL2 required',403)}
 private async exec<T>(p:AssurancePrincipal,name:string,key:string,c:string,fn:(run:string)=>Promise<T>,supervisor=false){
 this.need(p,supervisor);const run=await this.runs.start({processName:name,principal:p,correlationId:c,idempotencyKey:key,entityType:'ASSURANCE'});
 try{const x=await fn(run);await this.runs.finish(run,'SUCCEEDED',{completed:true});return x}catch(e){await this.runs.finish(run,'FAILED',{},e);throw e}}
 async evaluate(p:AssurancePrincipal,i:RunControlEvaluationInput,c:string=randomUUID()){this.need(p);const run=await this.runs.start({
 processName:'D7G1_CONTROL_EVALUATE',principal:p,correlationId:c,idempotencyKey:i.idempotencyKey,entityType:'ASSURANCE_CONTROL'});
 try{const x=await this.repo.evaluate(p,i,run,c);await this.runs.finish(run,x.result==='PASS'?'SUCCEEDED':'PARTIAL',{result:x.result,score:x.score});return x}
 catch(e){await this.runs.finish(run,'FAILED',{},e);throw e}}
 assign(p:AssurancePrincipal,id:string,assignee:string,reason:string,key:string,c:string=randomUUID()){return this.exec(p,'D7G1_FINDING_TRANSITION',key,c,r=>this.repo.assign(p,id,assignee,reason,r,c),true)}
 contain(p:AssurancePrincipal,id:string,i:Parameters<AssuranceRepository['contain']>[2],key:string,c:string=randomUUID()){return this.exec(p,'D7G1_FINDING_TRANSITION',key,c,r=>this.repo.contain(p,id,i,r,c),true)}
 validate(p:AssurancePrincipal,id:string,evaluationRunId:string,key:string,c:string=randomUUID()){return this.exec(p,'D7G1_FINDING_TRANSITION',key,c,r=>this.repo.validate(p,id,evaluationRunId,r,c),true)}
 list(p:AssurancePrincipal,f:FindingFilters){this.need(p);return this.repo.list(p,f)}
 dashboard(p:AssurancePrincipal){this.need(p);return this.repo.dashboard(p)}
}
