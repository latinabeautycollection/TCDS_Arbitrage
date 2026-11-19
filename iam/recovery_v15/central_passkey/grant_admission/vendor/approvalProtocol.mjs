import {createPublicKey,verify,createHash} from 'node:crypto';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const HEX=/^[a-f0-9]{64}$/;
const ACTIONS=new Set(['EOC_FEDERATION_BIND_APPROVE','EOC_MODULE_GRANT_APPROVE']);
export function canonicalApproval(a){
 const keys=['version','issuer','audience','purpose','evidenceId','requestId','approverUserId','approverSessionId','webAuthnEvidenceId','targetUserId','bindingId','oidcIssuer','subjectHash','moduleId','operation','scopeKind','scopeIds','verifiedAt','expiresAt','ceremonyId','verifierReference'];
 return 'TCDS:EOC:APPROVAL:V13\n'+keys.map(k=>JSON.stringify(a[k]??null)).join('\n');
}
export function verifyApprovalEnvelope({envelope,signature,publicKeyPem,expectedIssuer,expectedAudience,now=Date.now()}){
 if(!envelope||typeof envelope!=='object'||typeof signature!=='string'||!publicKeyPem)throw Error('APPROVAL_ENVELOPE_INVALID');
 if(envelope.version!==13||envelope.issuer!==expectedIssuer||envelope.audience!==expectedAudience||!ACTIONS.has(envelope.purpose))throw Error('APPROVAL_CONTEXT_INVALID');
 if(![envelope.evidenceId,envelope.requestId,envelope.approverUserId,envelope.approverSessionId,envelope.webAuthnEvidenceId,envelope.targetUserId,envelope.ceremonyId].every(v=>typeof v==='string'&&UUID.test(v)))throw Error('APPROVAL_IDS_INVALID');
 if(envelope.approverUserId===envelope.targetUserId||typeof envelope.verifierReference!=='string'||envelope.verifierReference.length<16)throw Error('APPROVAL_SEPARATION_INVALID');
 const start=Date.parse(envelope.verifiedAt),end=Date.parse(envelope.expiresAt);
 if(!Number.isFinite(start)||!Number.isFinite(end)||start>now+1000||end<=now||now-start>5*60000||end-start>5*60000)throw Error('APPROVAL_EXPIRED');
 if(envelope.purpose==='EOC_FEDERATION_BIND_APPROVE'&&(!UUID.test(envelope.bindingId??'')||typeof envelope.oidcIssuer!=='string'||!envelope.oidcIssuer.startsWith('https://')||!HEX.test(envelope.subjectHash??'')))throw Error('APPROVAL_BINDING_INVALID');
 if(envelope.purpose==='EOC_MODULE_GRANT_APPROVE'&&(!envelope.moduleId||!envelope.operation||!envelope.scopeKind||!Array.isArray(envelope.scopeIds)))throw Error('APPROVAL_GRANT_INVALID');
 const sig=Buffer.from(signature,'base64url');if(sig.length!==64)throw Error('APPROVAL_SIGNATURE_INVALID');
 const ok=verify(null,Buffer.from(canonicalApproval(envelope)),createPublicKey(publicKeyPem),sig);
 if(!ok)throw Error('APPROVAL_SIGNATURE_INVALID');
 return {envelope,digest:createHash('sha256').update(canonicalApproval(envelope)).digest('hex')};
}
/** A trusted WebAuthn verifier must produce this assertion AFTER verifying the real ceremony. */
export async function issueApprovalFromCentralVerifier({verifyPurposeBoundCeremony,signEnvelope,action,context}){
 if(typeof verifyPurposeBoundCeremony!=='function'||typeof signEnvelope!=='function')throw Error('WEB_AUTHN_VERIFIER_NOT_AVAILABLE');
 if(!ACTIONS.has(action))throw Error('WEB_AUTHN_PURPOSE_UNKNOWN');
 const proof=await verifyPurposeBoundCeremony({action,context});
 if(!proof||proof.verified!==true||proof.userVerified!==true||proof.phishingResistant!==true||proof.originApproved!==true||proof.rpIdApproved!==true||proof.singleUseChallengeConsumed!==true||!proof.approverUserId||!proof.ceremonyId)throw Error('WEB_AUTHN_PROOF_INCOMPLETE');
 if(proof.approverUserId===context.targetUserId)throw Error('WEB_AUTHN_SELF_APPROVAL');
 return signEnvelope({purpose:action,context,verifiedProof:proof});
}
