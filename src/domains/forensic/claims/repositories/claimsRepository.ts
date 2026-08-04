import type { Pool } from 'pg';
import type { ClaimsPrincipal,FileClaimInput,LinkClaimEvidenceInput,OpenClaimInput } from '../models/claimsTypes';

export class ClaimsRepository{
 constructor(private readonly pool:Pool){}
 async open(p:ClaimsPrincipal,i:OpenClaimInput,run:string,c:string){
  const{rows}=await this.pool.query(`SELECT * FROM forensic.d7e1_open_claim_r2(
   $1::uuid,$2,$3::uuid,$4::uuid,$5::uuid,$6::uuid,$7::bigint,$8::bigint,
   $9::forensic.event_actor_type,$10,$11,$12::uuid,$13::uuid,$14::jsonb)`,
   [i.chainId,p.tenantKey,i.claimCaseId,i.returnIntakeLinkId??null,i.adjudicationGateId??null,
    i.shippingCustodyLinkId??null,i.arbShipmentId??null,i.ebayOrderId??null,p.actorType,p.actorId,
    i.idempotencyKey,c,run,JSON.stringify(i.metadata??{})]);return rows[0];
 }
 async linkEvidence(p:ClaimsPrincipal,i:LinkClaimEvidenceInput,run:string,c:string){
  const{rows}=await this.pool.query(`SELECT * FROM forensic.d7e1_link_evidence_r2(
   $1::uuid,$2,$3,$4::uuid,$5::uuid,$6::uuid,$7::uuid,$8::uuid,$9,$10::uuid,
   $11::forensic.event_actor_type,$12,$13,$14::uuid,$15::uuid,$16::jsonb)`,
   [i.claimCaseLinkId,p.tenantKey,i.evidenceRole,i.forensicArtifactId??null,
    i.warehouseClaimEvidenceId??null,i.retailEvidenceArtifactId??null,i.retailProductId??null,
    i.retailOfferSnapshotId??null,i.required,p.warehouseUserId,p.actorType,p.actorId,
    i.idempotencyKey,c,run,JSON.stringify(i.metadata??{})]);return rows[0];
 }
 async assessDeadline(p:ClaimsPrincipal,id:string,run:string,c:string){
  const{rows}=await this.pool.query(`SELECT * FROM forensic.d7e1_assess_deadline(
   $1::uuid,$2,$3,$4::forensic.event_actor_type,$5::uuid,$6::uuid)`,
   [id,p.tenantKey,p.actorId,p.actorType,run,c]);return rows[0];
 }
 async evaluate(p:ClaimsPrincipal,id:string,run:string,c:string){
  const{rows}=await this.pool.query(`SELECT * FROM forensic.d7e1_evaluate_readiness_r2(
   $1::uuid,$2,$3,$4::forensic.event_actor_type,$5::uuid,$6::uuid)`,
   [id,p.tenantKey,p.actorId,p.actorType,run,c]);return rows[0];
 }
 async file(p:ClaimsPrincipal,i:FileClaimInput,run:string,c:string){
  const{rows}=await this.pool.query(`SELECT * FROM forensic.d7e1_attest_filing_r2(
   $1::uuid,$2,$3::uuid,$4,$5,$6,$7,$8::uuid,$9,$10::uuid,$11::uuid,$12::timestamptz,
   $13::forensic.event_actor_type,$14,$15,$16::uuid,$17::uuid)`,
   [i.claimCaseLinkId,p.tenantKey,i.readinessAssessmentId,i.externalClaimId,i.filingChannel,
    i.requestPayloadSha256,i.responsePayloadSha256,i.confirmationArtifactId,i.filedAmount,
    p.warehouseUserId,p.warehouseAuthSessionId,i.filedAt,p.actorType,p.actorId,
    i.idempotencyKey,c,run]);return rows[0];
 }
 async get(p:ClaimsPrincipal,id:string){
  const{rows}=await this.pool.query(`SELECT l.*,
   COALESCE((SELECT jsonb_agg(e ORDER BY e.linked_at,e.claim_evidence_link_id)
    FROM forensic.claim_evidence_links e WHERE e.claim_case_link_id=l.claim_case_link_id),'[]') evidence,
   COALESCE((SELECT jsonb_agg(s ORDER BY s.occurred_at,s.claim_case_state_event_id)
    FROM forensic.claim_case_state_events s WHERE s.claim_case_link_id=l.claim_case_link_id),'[]') state_events
   FROM forensic.claim_case_links l WHERE l.claim_case_link_id=$1::uuid AND l.tenant_key=$2`,
   [id,p.tenantKey]);return rows[0]??null;
 }
}
