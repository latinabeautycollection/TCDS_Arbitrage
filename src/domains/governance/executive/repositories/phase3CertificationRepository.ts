import { createHash,randomUUID } from 'node:crypto'; import type { Pool } from 'pg';
import type { TrustedActor,CertificationRequest,CertificationResult,RevocationRequest } from '../models/executiveGovernanceTypes';
export class Phase3CertificationRepository {
 constructor(private readonly pool:Pool){}
 private requestSha(v:CertificationRequest){return createHash('sha256').update(JSON.stringify(v,Object.keys(v).sort())).digest('hex')}
 async certify(actor:TrustedActor,r:CertificationRequest):Promise<CertificationResult>{
  const q=await this.pool.query(`SELECT * FROM arb.domain11l_certify_phase3($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,[
   r.idempotencyKey,this.requestSha(r),actor.type,actor.id,randomUUID(),r.evidenceCutoffAt,r.policyReference,r.policySha256,r.activeReleaseIdentity,
   r.activeReleaseManifestSha256,r.sourceRevision,r.sourceManifestSha256,r.migrationBaseline,r.migrationManifestSha256,r.policyManifestSha256,
   r.configurationBaselineSha256??null,r.orchestratorVersion,r.suiteVersion,r.certificationEnvironment,r.certificationEnvironmentSha256]);
  const x=q.rows[0] as Record<string,unknown>|undefined;if(!x)throw new Error('Certification function returned no row');
  return {outcome:String(x.outcome),phase3CertificationId:x.phase3_certification_id?String(x.phase3_certification_id):null,
   epochId:x.epoch_id?String(x.epoch_id):null,epochCode:x.epoch_code?String(x.epoch_code):null,reasonCodes:Array.isArray(x.reason_codes)?x.reason_codes.map(String):[]};
 }
 async revoke(actor:TrustedActor,certificationId:string,r:RevocationRequest):Promise<string>{
  const q=await this.pool.query(`SELECT arb.domain11l_revoke_phase3_certification($1,$2,$3,$4,$5,$6,$7) AS id`,[
   certificationId,actor.type,actor.id,r.reasonCode,r.evidenceReference,r.evidenceSha256,r.correlationId]);return String(q.rows[0]?.id);
 }
}
