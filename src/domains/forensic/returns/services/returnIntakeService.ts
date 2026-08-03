import { randomUUID } from 'node:crypto';
import type { ReturnPrincipal } from '../models/returnEvidenceTypes';
import { ReturnForensicError } from '../errors/ReturnForensicError';
import { ReturnIntakeRepository, type OpenReturnInput } from '../repositories/returnIntakeRepository';
import { ArbProcessRunAdapter } from '../adapters/arbProcessRunAdapter';

export class ReturnIntakeService {
  constructor(private readonly repo:ReturnIntakeRepository,private readonly runs:ArbProcessRunAdapter){}

  private require(p:ReturnPrincipal,permission:string):void {
    if(!p.permissions.includes(permission)) throw new ReturnForensicError('FORBIDDEN','Forbidden',403);
  }
  private async execute<T>(p:ReturnPrincipal,processName:string,key:string,correlationId:string,
    action:(runId:string)=>Promise<T>,supervisor=false):Promise<T>{
    this.require(p,supervisor?'forensic.return.supervise':'forensic.return.capture');
    if(supervisor && p.assuranceLevel!=='AAL2') throw new ReturnForensicError('AAL2_REQUIRED','AAL2 authentication required',403);
    const runId=await this.runs.start({processName,stage:'RETURN',principal:p,
      correlationId,idempotencyKey:key,entityType:'RETURN_INTAKE_LINK'});
    try{const result=await action(runId);await this.runs.finish(runId,'SUCCEEDED',{completed:true});return result}
    catch(error){await this.runs.finish(runId,'FAILED',{},error);throw error}
  }

  open(p:ReturnPrincipal,input:OpenReturnInput,c:string=randomUUID()){
    return this.execute(p,'D7D1_RETURN_LINK',input.idempotencyKey,c,r=>this.repo.open(p,input,r,c));
  }
  linkArtifact(p:ReturnPrincipal,input:Parameters<ReturnIntakeRepository['linkArtifact']>[1],c:string=randomUUID()){
    return this.execute(p,'D7D1_ARTIFACT_LINK',input.idempotencyKey,c,r=>this.repo.linkArtifact(p,input,r,c));
  }
  recordPackage(p:ReturnPrincipal,input:Parameters<ReturnIntakeRepository['recordPackage']>[1],c:string=randomUUID()){
    return this.execute(p,'D7D1_PACKAGE_ATTEST',input.idempotencyKey,c,r=>this.repo.recordPackage(p,input,r,c));
  }
  recordComponent(p:ReturnPrincipal,input:Parameters<ReturnIntakeRepository['recordComponent']>[1],c:string=randomUUID()){
    return this.execute(p,'D7D1_COMPONENT_ATTEST',input.idempotencyKey,c,r=>this.repo.recordComponent(p,input,r,c));
  }
  recordIdentity(p:ReturnPrincipal,input:Parameters<ReturnIntakeRepository['recordIdentity']>[1],c:string=randomUUID()){
    return this.execute(p,'D7D1_IDENTITY_COMPARE',input.idempotencyKey,c,r=>this.repo.recordIdentity(p,input,r,c));
  }
  recordContinuityException(p:ReturnPrincipal,input:Parameters<ReturnIntakeRepository['recordContinuityException']>[1],c:string=randomUUID()){
    return this.execute(p,'D7D1_CONTINUITY_EXCEPTION',input.idempotencyKey,c,r=>this.repo.recordContinuityException(p,input,r,c));
  }
  recordContinuityDecision(p:ReturnPrincipal,input:Parameters<ReturnIntakeRepository['recordContinuityDecision']>[1],c:string=randomUUID()){
    return this.execute(p,'D7D1_CONTINUITY_DECISION',input.idempotencyKey,c,r=>this.repo.recordContinuityDecision(p,input,r,c),true);
  }
  async evaluate(p:ReturnPrincipal,linkId:string,key:string,c:string=randomUUID()){
    this.require(p,'forensic.return.capture');
    const runId=await this.runs.start({processName:'D7D1_GATE_EVALUATE',stage:'RETURN',
      principal:p,correlationId:c,idempotencyKey:key,entityType:'RETURN_INTAKE_LINK'});
    try{const result=await this.repo.evaluate(p,linkId,runId,c);
      await this.runs.finish(runId,result.result==='PASSED'?'SUCCEEDED':'PARTIAL',{gateResult:result.result});
      return result;
    }catch(error){await this.runs.finish(runId,'FAILED',{},error);throw error}
  }
  async get(p:ReturnPrincipal,id:string){this.require(p,'forensic.return.capture');
    const result=await this.repo.get(p,id);if(!result)throw new ReturnForensicError('NOT_FOUND','Return intake not found',404);return result}
}
