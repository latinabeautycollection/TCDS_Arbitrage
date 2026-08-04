import type{Pool}from'pg';
import type{ClaimsPrincipal,OpenDisputeInput,RecordRecoveryInput}from'../models/claimsTypes';
export class RecoveryRepository{
 constructor(private readonly pool:Pool){}
 async open(p:ClaimsPrincipal,i:OpenDisputeInput,run:string,c:string){const{rows}=await this.pool.query(
 `SELECT * FROM forensic.d7e2_open_dispute_r2($1::uuid,$2,$3,$4,$5::bigint,$6::bigint,
 $7::bigint,$8::uuid,$9::uuid,$10::uuid,$11,$12::timestamptz,$13::timestamptz,
 $14::forensic.event_actor_type,$15,$16,$17::uuid,$18::uuid,$19::jsonb)`,
 [i.chainId,p.tenantKey,i.externalDisputeId,i.disputeType,i.ebayOrderId??null,
 i.ebayListingId??null,i.arbShipmentId??null,i.claimCaseLinkId??null,i.returnIntakeLinkId??null,
 i.fraudAssessmentId??null,i.disputedAmount,i.openedAt,i.responseDeadline??null,p.actorType,
 p.actorId,i.idempotencyKey,c,run,JSON.stringify(i.metadata??{})]);return rows[0]}
 async build(p:ClaimsPrincipal,id:string,run:string,c:string){const{rows}=await this.pool.query(
 `SELECT * FROM forensic.d7e2_build_evidence_package_r2($1::uuid,$2,$3,
 $4::forensic.event_actor_type,$5::uuid,$6::uuid)`,
 [id,p.tenantKey,p.actorId,p.actorType,run,c]);return rows[0]}
 async respond(p:ClaimsPrincipal,i:{disputeCaseLinkId:string;evidencePackageId:string;
 responseChannel:string;requestSha256:string;responseSha256:string;confirmationArtifactId:string;
 submittedAt:string;idempotencyKey:string},run:string,c:string){const{rows}=await this.pool.query(
 `SELECT * FROM forensic.d7e2_attest_response($1::uuid,$2,$3::uuid,$4,$5,$6,$7::uuid,
 $8::uuid,$9::uuid,$10::timestamptz,$11::forensic.event_actor_type,$12,$13,$14::uuid,$15::uuid)`,
 [i.disputeCaseLinkId,p.tenantKey,i.evidencePackageId,i.responseChannel,i.requestSha256,
 i.responseSha256,i.confirmationArtifactId,p.warehouseUserId,p.warehouseAuthSessionId,
 i.submittedAt,p.actorType,p.actorId,i.idempotencyKey,c,run]);return rows[0]}
 async recovery(p:ClaimsPrincipal,i:RecordRecoveryInput,run:string,c:string){const{rows}=await this.pool.query(
 `SELECT * FROM forensic.d7e2_record_recovery_r2($1::uuid,$2::uuid,$3,$4,$5,$6::uuid,
 $7,$8::char(3),$9::timestamptz,$10,$11::forensic.event_actor_type,$12,$13,$14::uuid,$15::uuid)`,
 [i.disputeCaseLinkId??null,i.claimCaseLinkId??null,i.recoverySource,i.externalTransactionId,
 i.transactionType,i.originalRecoveryTransactionId??null,i.amount,i.currencyCode,i.occurredAt,
 i.payloadSha256,p.actorType,p.actorId,i.idempotencyKey,c,run]);return rows[0]}
 async reconcile(p:ClaimsPrincipal,i:{disputeCaseLinkId?:string;claimCaseLinkId?:string;
 cutoffAt:string;policyVersion:string},run:string,c:string){const{rows}=await this.pool.query(
 `SELECT * FROM forensic.d7e2_reconcile_loss_r2($1::uuid,$2::uuid,$3::timestamptz,
 $4,'d7e2-reconcile-v2',$5::forensic.event_actor_type,$6,$7::uuid,$8::uuid)`,
 [i.disputeCaseLinkId??null,i.claimCaseLinkId??null,i.cutoffAt,i.policyVersion,
 p.actorType,p.actorId,run,c]);return rows[0]}
 async exportLearning(p:ClaimsPrincipal,i:{assessmentId:string;entityType:string;entityPk:string;
 featureGroup:string;featurePayload:Readonly<Record<string,unknown>>;idempotencyKey:string},
 run:string,c:string){const{rows}=await this.pool.query(
 `SELECT * FROM forensic.d7e2_export_learning_outcome($1::uuid,$2,$3,$4,$5::jsonb,
 $6::uuid,$7::uuid,$8,$9::uuid,$10::uuid)`,
 [i.assessmentId,i.entityType,i.entityPk,i.featureGroup,JSON.stringify(i.featurePayload),
 p.warehouseUserId,p.warehouseAuthSessionId,i.idempotencyKey,c,run]);return rows[0]}
 async get(p:ClaimsPrincipal,id:string){const{rows}=await this.pool.query(
 `SELECT d.*,COALESCE((SELECT jsonb_agg(s ORDER BY s.occurred_at,s.dispute_case_state_event_id)
 FROM forensic.dispute_case_state_events s WHERE s.dispute_case_link_id=d.dispute_case_link_id),'[]') state_events,
 COALESCE((SELECT jsonb_agg(ep ORDER BY ep.package_version)
 FROM forensic.dispute_evidence_packages ep WHERE ep.dispute_case_link_id=d.dispute_case_link_id),'[]') evidence_packages
 FROM forensic.dispute_case_links d WHERE d.dispute_case_link_id=$1::uuid AND d.tenant_key=$2`,
 [id,p.tenantKey]);return rows[0]??null}
}
