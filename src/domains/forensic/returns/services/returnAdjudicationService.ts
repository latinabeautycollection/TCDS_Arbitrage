import { randomUUID } from 'node:crypto';
import type { ReturnPrincipal } from '../models/returnEvidenceTypes';
import { ReturnForensicError } from '../errors/ReturnForensicError';
import { ReturnAdjudicationRepository } from '../repositories/returnAdjudicationRepository';
import { ArbProcessRunAdapter } from '../adapters/arbProcessRunAdapter';

export class ReturnAdjudicationService{
 constructor(private readonly repo:ReturnAdjudicationRepository,private readonly runs:ArbProcessRunAdapter){}
 private require(p:ReturnPrincipal,supervisor=true){const permission=supervisor?'forensic.return.supervise':'forensic.return.capture';
  if(!p.permissions.includes(permission))throw new ReturnForensicError('FORBIDDEN','Forbidden',403);
  if(supervisor&&p.assuranceLevel!=='AAL2')throw new ReturnForensicError('AAL2_REQUIRED','AAL2 authentication required',403)}
 async assess(p:ReturnPrincipal,linkId:string,warehouseAssessmentId?:string,c:string=randomUUID()){
  this.require(p);const run=await this.runs.start({processName:'D7D2_COMPARE_RETURN',stage:'RETURN',
   principal:p,correlationId:c,idempotencyKey:`assess:${linkId}`,entityType:'RETURN_INTAKE_LINK'});
  try{const comparison=await this.repo.compare(p,linkId,run,c);const fraud=await this.repo.assessFraud(p,linkId,run,c);
   const recommendation=await this.repo.recommend(p,linkId,warehouseAssessmentId,run,c);
   await this.runs.finish(run,'SUCCEEDED',{comparisonId:comparison.return_comparison_assessment_id,
    fraudId:fraud.return_fraud_assessment_id,recommendationId:recommendation.return_disposition_recommendation_id});
   return{comparison,fraud,recommendation}}catch(error){await this.runs.finish(run,'FAILED',{},error);throw error}}
 async decide(p:ReturnPrincipal,input:Parameters<ReturnAdjudicationRepository['decide']>[1],c:string=randomUUID()){
  this.require(p);const run=await this.runs.start({processName:'D7D2_SUPERVISOR_ADJUDICATE',stage:'RETURN',
   principal:p,correlationId:c,idempotencyKey:input.idempotencyKey,entityType:'RETURN_INTAKE_LINK'});
  try{const result=await this.repo.decide(p,input,run,c);await this.runs.finish(run,'SUCCEEDED',{decisionId:result.return_supervisor_decision_id});return result}
  catch(error){await this.runs.finish(run,'FAILED',{},error);throw error}}
 async evaluate(p:ReturnPrincipal,linkId:string,key:string,c:string=randomUUID()){
  this.require(p);const run=await this.runs.start({processName:'D7D2_GATE_EVALUATE',stage:'RETURN',
   principal:p,correlationId:c,idempotencyKey:key,entityType:'RETURN_INTAKE_LINK'});
  try{const result=await this.repo.evaluate(p,linkId,run,c);
   await this.runs.finish(run,result.result==='APPROVED'?'SUCCEEDED':'PARTIAL',{gateResult:result.result});return result}
  catch(error){await this.runs.finish(run,'FAILED',{},error);throw error}}
 async linkExecution(p:ReturnPrincipal,input:Parameters<ReturnAdjudicationRepository['linkExecution']>[1],c:string=randomUUID()){
  this.require(p);const run=await this.runs.start({processName:'D7D2_DISPOSITION_RECOMMEND',stage:'RETURN',
   principal:p,correlationId:c,idempotencyKey:input.idempotencyKey,entityType:'RETURN_DISPOSITION'});
  try{const result=await this.repo.linkExecution(p,input,run,c);await this.runs.finish(run,'SUCCEEDED',{executionLinkId:result.return_disposition_execution_link_id});return result}
  catch(error){await this.runs.finish(run,'FAILED',{},error);throw error}}
}
