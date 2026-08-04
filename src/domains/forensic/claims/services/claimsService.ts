import{randomUUID}from'node:crypto';
import type{ClaimsPrincipal,FileClaimInput,LinkClaimEvidenceInput,OpenClaimInput}from'../models/claimsTypes';
import{ClaimsForensicError}from'../errors/ClaimsForensicError';
import{ClaimsRepository}from'../repositories/claimsRepository';
import{ArbProcessRunAdapter}from'../adapters/arbProcessRunAdapter';
export class ClaimsService{
 constructor(private readonly repo:ClaimsRepository,private readonly runs:ArbProcessRunAdapter){}
 private need(p:ClaimsPrincipal,supervisor=false){
  const permission=supervisor?'forensic.claim.supervise':'forensic.claim.capture';
  if(!p.permissions.includes(permission))throw new ClaimsForensicError('FORBIDDEN','Forbidden',403);
  if(supervisor&&p.assuranceLevel!=='AAL2')throw new ClaimsForensicError('AAL2_REQUIRED','AAL2 required',403);
 }
 private async exec<T>(p:ClaimsPrincipal,name:string,key:string,c:string,action:(run:string)=>Promise<T>,supervisor=false){
  this.need(p,supervisor);const run=await this.runs.start({processName:name,principal:p,
   correlationId:c,idempotencyKey:key,entityType:'CLAIM_CASE'});
  try{const result=await action(run);await this.runs.finish(run,'SUCCEEDED',{completed:true});return result}
  catch(error){await this.runs.finish(run,'FAILED',{},error);throw error}
 }
 open(p:ClaimsPrincipal,i:OpenClaimInput,c:string=randomUUID()){return this.exec(p,'D7E1_CLAIM_LINK',i.idempotencyKey,c,r=>this.repo.open(p,i,r,c))}
 linkEvidence(p:ClaimsPrincipal,i:LinkClaimEvidenceInput,c:string=randomUUID()){return this.exec(p,'D7E1_EVIDENCE_LINK',i.idempotencyKey,c,r=>this.repo.linkEvidence(p,i,r,c))}
 assessDeadline(p:ClaimsPrincipal,id:string,key:string,c:string=randomUUID()){return this.exec(p,'D7E1_DEADLINE_ASSESS',key,c,r=>this.repo.assessDeadline(p,id,r,c))}
 async evaluate(p:ClaimsPrincipal,id:string,key:string,c:string=randomUUID()){this.need(p);
  const run=await this.runs.start({processName:'D7E1_READINESS_EVALUATE',principal:p,correlationId:c,idempotencyKey:key,entityType:'CLAIM_CASE'});
  try{const result=await this.repo.evaluate(p,id,run,c);await this.runs.finish(run,result.result==='READY'?'SUCCEEDED':'PARTIAL',{result:result.result});return result}
  catch(error){await this.runs.finish(run,'FAILED',{},error);throw error}}
 file(p:ClaimsPrincipal,i:FileClaimInput,c:string=randomUUID()){return this.exec(p,'D7E1_FILE_ATTEST',i.idempotencyKey,c,r=>this.repo.file(p,i,r,c),true)}
 async get(p:ClaimsPrincipal,id:string){this.need(p);const result=await this.repo.get(p,id);if(!result)throw new ClaimsForensicError('NOT_FOUND','Claim not found',404);return result}
}
