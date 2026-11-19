import {verifyApprovalEnvelope} from './approvalProtocol.mjs';
/** Separately credentialed IAM verifier and retail admission operations; never browser-callable. */
export function makeApprovalAdmission({iamPool,retailPool,publicKeyPem,issuer,audience,approvedOidcIssuer,authorizeApprover}){
 if(typeof authorizeApprover!=='function'||!publicKeyPem||!issuer||!audience)throw Error('APPROVAL_ADMISSION_NOT_CONFIGURED');
 return async function admit({envelope,signature}){
  const {digest}=verifyApprovalEnvelope({envelope,signature,publicKeyPem,expectedIssuer:issuer,expectedAudience:audience});
  if(await authorizeApprover(envelope.approverUserId,envelope.purpose,envelope.targetUserId)!==true)throw Error('APPROVER_NOT_AUTHORIZED');
  if(envelope.purpose==='EOC_FEDERATION_BIND_APPROVE'){
   if(!iamPool)throw Error('IAM_BINDING_DB_UNAVAILABLE');
   if(!approvedOidcIssuer||envelope.oidcIssuer!==approvedOidcIssuer)throw Error('OIDC_BINDING_ISSUER_NOT_APPROVED');
   await iamPool.query(`INSERT INTO warehouse_identity.eoc_binding_approvals_v13(evidence_id,request_id,binding_id,approver_user_id,auth_session_id,web_authn_evidence_id,target_user_id,oidc_issuer,subject_hash,verified_at,expires_at,verifier_digest,ceremony_id)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,[envelope.evidenceId,envelope.requestId,envelope.bindingId,envelope.approverUserId,envelope.approverSessionId,envelope.webAuthnEvidenceId,envelope.targetUserId,envelope.oidcIssuer,envelope.subjectHash,envelope.verifiedAt,envelope.expiresAt,digest,envelope.ceremonyId]);
  }else{
   if(!retailPool)throw Error('EOC_GRANT_DB_UNAVAILABLE');
   await retailPool.query(`INSERT INTO eoc_iam.grant_verified_attestations_v12(evidence_id,approver_user_id,target_user_id,request_id,module_id,operation,scope_kind,scope_ids,purpose,verified_at,expires_at,verifier_reference)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,'EOC_MODULE_GRANT_APPROVE',$9,$10,$11)`,[envelope.evidenceId,envelope.approverUserId,envelope.targetUserId,envelope.requestId,envelope.moduleId,envelope.operation,envelope.scopeKind,envelope.scopeIds,envelope.verifiedAt,envelope.expiresAt,envelope.verifierReference]);
  }
  return {admitted:true,evidenceId:envelope.evidenceId};
 };
}
