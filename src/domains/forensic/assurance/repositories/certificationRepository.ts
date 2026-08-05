import type{Pool}from'pg';import type{AssurancePrincipal,OpenCertificationCampaignInput}from'../models/assuranceTypes';
export class CertificationRepository{constructor(private readonly pool:Pool){}
 async open(p:AssurancePrincipal,i:OpenCertificationCampaignInput,run:string,c:string){const{rows}=await this.pool.query(
 `SELECT * FROM forensic.d7g2_open_campaign_r2($1,$2,$3,$4,$5::date,$6::date,$7::timestamptz,
 $8::jsonb,$9::uuid,$10::forensic.event_actor_type,$11,$12,$13::uuid,$14::uuid)`,
 [p.tenantKey,i.campaignCode,i.campaignType,i.title,i.periodStart,i.periodEnd,i.dueAt,
 JSON.stringify(i.scopeJson),p.warehouseUserId,p.actorType,p.actorId,i.idempotencyKey,c,run]);return rows[0]}
 async get(p:AssurancePrincipal,id:string){const{rows}=await this.pool.query(
 `SELECT c.*,COALESCE((SELECT jsonb_agg(f ORDER BY f.freeze_version)
 FROM forensic.assurance_campaign_evidence_freezes f WHERE f.campaign_id=c.assurance_certification_campaign_id),'[]') freezes,
 COALESCE((SELECT jsonb_agg(a ORDER BY a.attested_at)
 FROM forensic.assurance_management_attestations a WHERE a.campaign_id=c.assurance_certification_campaign_id),'[]') attestations,
 COALESCE((SELECT jsonb_agg(d ORDER BY d.decided_at)
 FROM forensic.assurance_certification_decisions d WHERE d.campaign_id=c.assurance_certification_campaign_id),'[]') decisions,
 COALESCE((SELECT jsonb_agg(cert ORDER BY cert.certificate_version)
 FROM forensic.assurance_certificates cert WHERE cert.campaign_id=c.assurance_certification_campaign_id),'[]') certificates
 FROM forensic.assurance_certification_campaigns c WHERE c.assurance_certification_campaign_id=$1::uuid AND c.tenant_key=$2`,
 [id,p.tenantKey]);return rows[0]??null}
 async pendingSigningRequest(id:string){const{rows}=await this.pool.query(
 `SELECT * FROM forensic.assurance_certificate_signing_requests WHERE assurance_certificate_signing_request_id=$1::uuid AND status='PENDING'`,[id]);return rows[0]??null}
 async recordSignature(i:{requestId:string;signatureBase64:string;algorithm:string;provider:string;keyReference:string;
 keyVersion?:string;publicKeyReference?:string;certificateChainReference?:string;timestampAuthorityReference?:string;
 providerResponseSha256:string;signedAt:string;verified:boolean}){const{rows}=await this.pool.query(
 `SELECT * FROM forensic.d7g2_record_certificate_signature($1::uuid,$2,$3,$4,$5,$6,$7,$8,$9,$10,
 $11::timestamptz,$12)`,[i.requestId,i.signatureBase64,i.algorithm,i.provider,i.keyReference,
 i.keyVersion??null,i.publicKeyReference??null,i.certificateChainReference??null,
 i.timestampAuthorityReference??null,i.providerResponseSha256,i.signedAt,i.verified]);return rows[0]}
 async close(p:AssurancePrincipal,id:string){const{rows}=await this.pool.query(
 `SELECT * FROM forensic.d7g2_close_campaign($1::uuid,$2,$3::uuid,$4::uuid)`,
 [id,p.tenantKey,p.warehouseUserId,p.warehouseAuthSessionId]);return rows[0]}
 async revokeCertificate(p:AssurancePrincipal,id:string,reason:string){const{rows}=await this.pool.query(
 `SELECT * FROM forensic.d7g2_revoke_certificate($1::uuid,$2,$3::uuid,$4::uuid)`,
 [id,reason,p.warehouseUserId,p.warehouseAuthSessionId]);return rows[0]}
 async listPlans(findingId:string){const{rows}=await this.pool.query(
 `SELECT * FROM forensic.assurance_remediation_plans WHERE assurance_finding_id=$1::uuid ORDER BY plan_version DESC`,[findingId]);return rows}
 async listRiskAcceptances(findingId:string){const{rows}=await this.pool.query(
 `SELECT * FROM forensic.assurance_risk_acceptances WHERE assurance_finding_id=$1::uuid ORDER BY effective_at DESC`,[findingId]);return rows}
}
