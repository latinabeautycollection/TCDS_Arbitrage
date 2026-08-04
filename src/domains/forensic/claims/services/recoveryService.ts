import{randomUUID}from'node:crypto';
import type{ClaimsPrincipal,OpenDisputeInput,RecordRecoveryInput}from'../models/claimsTypes';
import{ClaimsForensicError}from'../errors/ClaimsForensicError';
import{RecoveryRepository}from'../repositories/recoveryRepository';
import{ArbProcessRunAdapter}from'../adapters/arbProcessRunAdapter';
export class RecoveryService{
 constructor(private readonly repo:RecoveryRepository,private readonly runs:ArbProcessRunAdapter){}
 private need(p:ClaimsPrincipal,supervisor=false){const permission=supervisor?'forensic.recovery.supervise':'forensic.recovery.capture';
  if(!p.permissions.includes(permission))throw new ClaimsForensicError('FORBIDDEN','Forbidden',403);
  if(supervisor&&p.assuranceLevel!=='AAL2')throw new ClaimsForensicError('AAL2_REQUIRED','AAL2 required',403)}
 private async exec<T>(p:ClaimsPrincipal,name:string,key:string,c:string,entity:string,
  action:(run:string)=>Promise<T>,supervisor=false){this.need(p,supervisor);
  const run=await this.runs.start({processName:name,principal:p,correlationId:c,idempotencyKey:key,entityType:entity});
  try{const result=await action(run);await this.runs.finish(run,'SUCCEEDED',{completed:true});return result}
  catch(error){await this.runs.finish(run,'FAILED',{},error);throw error}}
 open(p:ClaimsPrincipal,i:OpenDisputeInput,c:string=randomUUID()){return this.exec(p,'D7E2_DISPUTE_LINK',i.idempotencyKey,c,'DISPUTE',r=>this.repo.open(p,i,r,c))}
 async build(p:ClaimsPrincipal,id:string,key:string,c:string=randomUUID()){this.need(p);const run=await this.runs.start({
  processName:'D7E2_EVIDENCE_PACKAGE',principal:p,correlationId:c,idempotencyKey:key,entityType:'DISPUTE'});
  try{const result=await this.repo.build(p,id,run,c);await this.runs.finish(run,result.coverage_score>=75?'SUCCEEDED':'PARTIAL',{coverageScore:result.coverage_score});return result}
  catch(error){await this.runs.finish(run,'FAILED',{},error);throw error}}
 respond(p:ClaimsPrincipal,i:Parameters<RecoveryRepository['respond']>[1],c:string=randomUUID()){return this.exec(p,'D7E2_RESPONSE_ATTEST',i.idempotencyKey,c,'DISPUTE',r=>this.repo.respond(p,i,r,c),true)}
 recovery(p:ClaimsPrincipal,i:RecordRecoveryInput,c:string=randomUUID()){return this.exec(p,'D7E2_RECOVERY_RECORD',i.idempotencyKey,c,'RECOVERY',r=>this.repo.recovery(p,i,r,c),true)}
 reconcile(p:ClaimsPrincipal,i:Parameters<RecoveryRepository['reconcile']>[1],key:string,c:string=randomUUID()){return this.exec(p,'D7E2_LOSS_RECONCILE',key,c,'RECOVERY',r=>this.repo.reconcile(p,i,r,c),true)}
 exportLearning(p:ClaimsPrincipal,i:Parameters<RecoveryRepository['exportLearning']>[1],c:string=randomUUID()){return this.exec(p,'D7E2_LEARNING_EXPORT',i.idempotencyKey,c,'LEARNING',r=>this.repo.exportLearning(p,i,r,c),true)}
 async get(p:ClaimsPrincipal,id:string){this.need(p);const result=await this.repo.get(p,id);if(!result)throw new ClaimsForensicError('NOT_FOUND','Dispute not found',404);return result}
}
