import type { Pool } from 'pg';
import type { ReturnPrincipal } from '../models/returnEvidenceTypes';

export class ReturnAdjudicationRepository {
 constructor(private readonly pool:Pool){}
 async compare(p:ReturnPrincipal,linkId:string,runId:string,correlationId:string){
  const{rows}=await this.pool.query(`SELECT * FROM forensic.d7d2_compare_return_r2(
   $1::uuid,$2,'d7d2-compare-v2',$3::forensic.event_actor_type,$4,$5::uuid,$6::uuid)`,
   [linkId,p.tenantKey,p.actorType,p.actorId,runId,correlationId]);return rows[0];
 }
 async assessFraud(p:ReturnPrincipal,linkId:string,runId:string,correlationId:string){
  const{rows}=await this.pool.query(`SELECT * FROM forensic.d7d2_assess_fraud_r2(
   $1::uuid,$2,'RETURN_FRAUD_DEFAULT','d7d2-fraud-v2',$3::forensic.event_actor_type,$4,$5::uuid,$6::uuid)`,
   [linkId,p.tenantKey,p.actorType,p.actorId,runId,correlationId]);return rows[0];
 }
 async recommend(p:ReturnPrincipal,linkId:string,warehouseAssessmentId:string|undefined,runId:string,correlationId:string){
  const{rows}=await this.pool.query(`SELECT * FROM forensic.d7d2_create_disposition_recommendation(
   $1::uuid,$2,$3::uuid,$4::forensic.event_actor_type,$5,$6::uuid,$7::uuid)`,
   [linkId,p.tenantKey,warehouseAssessmentId??null,p.actorType,p.actorId,runId,correlationId]);return rows[0];
 }
 async decide(p:ReturnPrincipal,input:{
  linkId:string;decisionType:string;decision:string;approvedOutcome?:string;
  warehouseOverrideId?:string;reason:string;supersedesDecisionId?:string;idempotencyKey:string;
 },runId:string,correlationId:string){
  const{rows}=await this.pool.query(`SELECT * FROM forensic.d7d2_record_supervisor_decision(
   $1::uuid,$2,$3,$4,$5,$6::uuid,$7,$8::uuid,$9::uuid,$10::uuid,
   $11::forensic.event_actor_type,$12,$13,$14::uuid,$15::uuid)`,
   [input.linkId,p.tenantKey,input.decisionType,input.decision,input.approvedOutcome??null,
   input.warehouseOverrideId??null,input.reason,p.warehouseUserId,p.warehouseAuthSessionId,
   input.supersedesDecisionId??null,p.actorType,p.actorId,input.idempotencyKey,correlationId,runId]);return rows[0];
 }
 async evaluate(p:ReturnPrincipal,linkId:string,runId:string,correlationId:string){
  const{rows}=await this.pool.query(`SELECT * FROM forensic.d7d2_evaluate_adjudication_r2(
   $1::uuid,$2,$3,$4::forensic.event_actor_type,$5::uuid,$6::uuid)`,
   [linkId,p.tenantKey,p.actorId,p.actorType,runId,correlationId]);return rows[0];
 }
 async linkExecution(p:ReturnPrincipal,input:{
  linkId:string;recommendationId:string;gateId:string;warehouseDispositionId:string;
  warehouseOverrideId?:string;idempotencyKey:string;
 },runId:string,correlationId:string){
  const{rows}=await this.pool.query(`SELECT * FROM forensic.d7d2_link_warehouse_disposition(
   $1::uuid,$2,$3::uuid,$4::uuid,$5::uuid,$6::uuid,$7::uuid,$8::uuid,
   $9::forensic.event_actor_type,$10,$11,$12::uuid,$13::uuid)`,
   [input.linkId,p.tenantKey,input.recommendationId,input.gateId,input.warehouseDispositionId,
   input.warehouseOverrideId??null,p.warehouseUserId,p.warehouseAuthSessionId,p.actorType,
   p.actorId,input.idempotencyKey,correlationId,runId]);return rows[0];
 }
}
