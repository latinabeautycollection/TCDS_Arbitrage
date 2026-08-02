import { randomUUID } from 'node:crypto';
import type { ForensicPrincipal } from '../../auth/forensicPrincipal';
import { WarehouseForensicError } from '../errors/WarehouseForensicError';
import type { WarehouseWorkflow } from '../models/warehouseForensicTypes';
import { WarehouseForensicRepository } from '../repositories/warehouseForensicRepository';
import { ArbProcessRunAdapter } from '../adapters/arbProcessRunAdapter';

export class WarehouseForensicService {
  constructor(
    private readonly repository: WarehouseForensicRepository,
    private readonly processRuns: ArbProcessRunAdapter,
  ) {}

  async startSession(principal:ForensicPrincipal,input:{
    chainId:string;workflowType:WarehouseWorkflow;linkType:string;
    linkRefs:Record<string,string|undefined>;idempotencyKey:string;
    metadata?:Record<string,unknown>;
  },correlationId:string=randomUUID()){
    return this.run(principal,this.processName(input.workflowType),input.workflowType,
      input.idempotencyKey,correlationId,async runId=>
        this.repository.startSession({...input,principal,correlationId,processRunId:runId}));
  }

  async getSession(principal:ForensicPrincipal,sessionId:string){
    this.require(principal,'forensic.warehouse.capture');
    const session=await this.repository.getSession(sessionId,principal.tenantKey);
    if(!session) throw new WarehouseForensicError('SESSION_NOT_FOUND','Session not found',404);
    return {...session,evidence:await this.repository.listSessionEvidence(sessionId,principal.tenantKey)};
  }

  async linkArtifact(principal:ForensicPrincipal,input:Omit<Parameters<WarehouseForensicRepository['linkArtifact']>[0],'principal'|'correlationId'|'processRunId'>,correlationId:string=randomUUID()){
    return this.run(principal,'D7B_RECEIVING_ATTEST','EVIDENCE_LINK',input.idempotencyKey,
      correlationId,runId=>this.repository.linkArtifact({...input,principal,correlationId,processRunId:runId}));
  }

  async recordCondition(principal:ForensicPrincipal,input:Omit<Parameters<WarehouseForensicRepository['recordCondition']>[0],'principal'|'correlationId'|'processRunId'>,correlationId:string=randomUUID()){
    return this.run(principal,'D7B_CONDITION_ATTEST','CONDITION',input.idempotencyKey,
      correlationId,runId=>this.repository.recordCondition({...input,principal,correlationId,processRunId:runId}));
  }

  async applySeal(principal:ForensicPrincipal,input:Omit<Parameters<WarehouseForensicRepository['applySeal']>[0],'principal'|'correlationId'|'processRunId'>,correlationId:string=randomUUID()){
    return this.run(principal,'D7B_TAMPER_SEAL','PACKING',input.idempotencyKey,
      correlationId,runId=>this.repository.applySeal({...input,principal,correlationId,processRunId:runId}));
  }

  async recordPackingAttestation(principal:ForensicPrincipal,input:Omit<Parameters<WarehouseForensicRepository['recordPackingAttestation']>[0],'principal'|'correlationId'|'processRunId'>,correlationId:string=randomUUID()){
    return this.run(principal,'D7B_PACKING_ATTEST','PACKING',input.idempotencyKey,
      correlationId,runId=>this.repository.recordPackingAttestation({...input,principal,correlationId,processRunId:runId}));
  }

  async setContinuityException(principal:ForensicPrincipal,input:Omit<Parameters<WarehouseForensicRepository['setContinuityException']>[0],'principal'|'correlationId'|'processRunId'>,correlationId:string=randomUUID()){
    return this.run(principal,'D7B_CONTINUITY_REVIEW','CONTINUITY',input.idempotencyKey,
      correlationId,runId=>this.repository.setContinuityException({...input,principal,correlationId,processRunId:runId}));
  }

  async recordSupervisorDecision(principal:ForensicPrincipal,input:Omit<Parameters<WarehouseForensicRepository['recordSupervisorDecision']>[0],'principal'|'correlationId'|'processRunId'>,correlationId:string=randomUUID()){
    this.require(principal,'forensic.warehouse.supervise');
    return this.run(principal,'D7B_SUPERVISOR_DECISION','SUPERVISOR',input.idempotencyKey,
      correlationId,runId=>this.repository.recordSupervisorDecision({...input,principal,correlationId,processRunId:runId}),true);
  }

  async evaluateGate(principal:ForensicPrincipal,sessionId:string,idempotencyKey:string,correlationId:string=randomUUID()){
    this.require(principal,'forensic.warehouse.capture');
    const session=await this.repository.getSession(sessionId,principal.tenantKey);
    if(!session) throw new WarehouseForensicError('SESSION_NOT_FOUND','Session not found',404);
    const runId=await this.processRuns.start({
      processName:'D7B_GATE_EVALUATE',stage:session.workflowType,principal,
      correlationId,idempotencyKey,entityType:'WAREHOUSE_EVIDENCE_SESSION',
    });
    try{
      const result=await this.repository.evaluateGate({sessionId,principal,processRunId:runId,correlationId});
      await this.processRuns.finish(runId,result.result==='PASSED'?'SUCCEEDED':'PARTIAL',
        {gateResult:result.result,blockers:result.blockers});
      return result;
    }catch(error){
      await this.processRuns.finish(runId,'FAILED',{},error);
      throw error;
    }
  }

  private async run<T>(
    principal:ForensicPrincipal,processName:string,stage:string,idempotencyKey:string,
    correlationId:string,fn:(runId:string)=>Promise<T>,supervisor=false,
  ):Promise<T>{
    this.require(principal,supervisor?'forensic.warehouse.supervise':'forensic.warehouse.capture');
    const runId=await this.processRuns.start({
      processName,stage,principal,correlationId,idempotencyKey,entityType:'WAREHOUSE_FORENSIC_OPERATION',
    });
    try{
      const result=await fn(runId);
      await this.processRuns.finish(runId,'SUCCEEDED',{completed:true});
      return result;
    }catch(error){
      await this.processRuns.finish(runId,'FAILED',{},error);
      throw error;
    }
  }

  private require(principal:ForensicPrincipal,permission:string):void{
    if(!principal.permissions.has(permission)){
      throw new WarehouseForensicError('FORBIDDEN','Forbidden',403);
    }
  }

  private processName(workflow:WarehouseWorkflow):string{
    return ({
      RECEIVING:'D7B_RECEIVING_ATTEST',IDENTITY:'D7B_IDENTITY_COMPARE',
      TESTING:'D7B_TEST_ATTEST',PHOTO_STATION:'D7B_PHOTO_ATTEST',
      PACKING:'D7B_PACKING_ATTEST',RETURN:'D7B_RECEIVING_ATTEST',
    } as const)[workflow];
  }
}
