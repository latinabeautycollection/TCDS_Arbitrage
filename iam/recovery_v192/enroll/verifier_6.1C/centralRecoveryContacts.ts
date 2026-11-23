import crypto from 'node:crypto';
import {generateAuthenticationOptions,verifyAuthenticationResponse} from '@simplewebauthn/server';
import type {CentralConfig} from './centralConfig';
import {CentralError,VERIFIER_SERVICE,VERIFIER_VERSION,b64u,claimToken,clientChallenge,hmac,sha256Hex,signCentralResult,type Db,type Ids} from './centralService';

/**
 * Recovery-email approval (TCDS 645). An employee added and confirmed a recovery email in the Warehouse PWA; an approver
 * (role IAM_RECOVERY_DESTINATION_APPROVER, global) approves it here with the central laptop passkey, the same
 * discoverable ceremony as the 628 binding and 630 grant approvals. 645 decides who may approve, records the approval,
 * and, once the policy's required number of approvals exists, makes the email the employee's recovery email.
 * The approver sees only a masked address (stored at enrollment by the login API, which holds the contact key).
 */
export class CentralRecoveryContactService{
  constructor(private db:Db,private cfg:CentralConfig){}

  async info(enrollmentId:string){
    const r=(await this.db.query(`SELECT * FROM warehouse_identity.central_recovery_contact_info_v645($1)`,[enrollmentId])).rows[0];
    if(!r)throw new CentralError('RECOVERY_CONTACT_ENROLLMENT_NOT_FOUND',404);
    const iso=(x:unknown)=>x?new Date(x as string).toISOString():null;
    return {enrollmentId:r.enrollment_id,status:r.status,targetDisplayName:r.target_display_name,targetUsername:r.target_username,
      employeeNumber:r.employee_number??null,contactHint:r.contact_hint,requestedAt:iso(r.requested_at),codeVerifiedAt:iso(r.code_verified_at),
      expiresAt:iso(r.expires_at),approvals:r.approvals,required:r.required,serverTime:new Date().toISOString()};
  }

  async options(enrollmentId:string,ids:Ids){
    const options=await generateAuthenticationOptions({rpID:this.cfg.CENTRAL_RP_ID,userVerification:'required',allowCredentials:[],timeout:120_000});
    let id:string;
    try{
      id=(await this.db.query(`SELECT warehouse_identity.central_recovery_contact_approval_begin_v645($1,$2,$3,$4,$5,$6) id`,
        [enrollmentId,this.cfg.CENTRAL_RP_ID,this.cfg.CENTRAL_ORIGIN,hmac(options.challenge,this.cfg.challengeHashKey),ids.requestId,ids.correlationId])).rows[0].id;
    }catch(e:any){
      if(/RECOVERY_CONTACT_NOT_AWAITING_APPROVAL/.test(String(e?.message)))throw new CentralError('RECOVERY_CONTACT_NOT_AWAITING_APPROVAL',409);
      throw new CentralError('CENTRAL_APPROVAL_UNAVAILABLE',503);
    }
    return {challengeId:id,options};
  }

  /** Verify the assertion; 645 checks the approver, records the approval and, when enough exist, activates the email. */
  async verify(input:{challengeId:string;enrollmentId:string;response:any},ids:Ids){
    const resp=input.response;
    if(typeof resp?.id!=='string'||resp.type!=='public-key')throw new CentralError('ASSERTION_INVALID',400);
    const challenge=clientChallenge(resp.response?.clientDataJSON);
    const claimHash=hmac(claimToken(),this.cfg.claimHashKey);
    const c=(await this.db.query(`SELECT * FROM warehouse_identity.central_claim_challenge_v1($1,$2,$3,'RECOVERY_CONTACT_APPROVAL',$4,NULL,NULL,NULL)`,
      [input.challengeId,hmac(challenge,this.cfg.challengeHashKey),claimHash,this.cfg.CENTRAL_RP_ID])).rows[0];
    if(c?.outcome!=='CLAIMED')throw new CentralError(c?.outcome??'CHALLENGE_CLAIM_FAILED');
    let f:any;
    try{
      const k=(await this.db.query(`SELECT * FROM warehouse_identity.central_passkey_material_v1($1,$2)`,[resp.id,this.cfg.CENTRAL_RP_ID])).rows[0];
      if(!k||k.security_state!=='ACTIVE'||k.user_active!==true)throw new CentralError('CREDENTIAL_NOT_ACTIVE');
      const uh=resp.response?.userHandle;
      if(typeof uh!=='string'||!crypto.timingSafeEqual(Buffer.from(b64u(k.user_handle)),Buffer.from(uh.length===43?uh:'x'.repeat(43))))
        throw new CentralError('USER_HANDLE_MISMATCH');
      // counter 0: the signature is always checked first; 645 enforces the real counter on verified evidence (as 628/630)
      const v=await verifyAuthenticationResponse({response:{...resp,clientExtensionResults:resp.clientExtensionResults??{}},
        expectedChallenge:challenge,expectedOrigin:this.cfg.CENTRAL_ORIGIN,expectedRPID:this.cfg.CENTRAL_RP_ID,requireUserVerification:true,
        credential:{id:k.credential_id,publicKey:new Uint8Array(k.public_key),counter:0,transports:k.transports??[]}});
      if(!v.verified)throw new CentralError('AUTHENTICATION_NOT_VERIFIED');
      const i:any=v.authenticationInfo,r=resp.response;
      f=(await this.db.query(`SELECT * FROM warehouse_identity.central_finalize_recovery_contact_approval_v645(
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
        [input.challengeId,claimHash,c.claim_generation,k.central_passkey_id,k.row_version,k.sign_count,i.newCounter,
         i.origin,i.rpID,i.userVerified===true,sha256Hex(Buffer.from(r.authenticatorData,'base64url')),
         sha256Hex(Buffer.from(r.clientDataJSON,'base64url')),sha256Hex(Buffer.from(r.signature,'base64url')),
         i.credentialDeviceType==='multiDevice',i.credentialBackedUp===true,VERIFIER_SERVICE,VERIFIER_VERSION,this.cfg.verifierInstance,
         ids.requestId,ids.correlationId])).rows[0];
      if(f?.outcome!=='SUCCEEDED')throw new CentralError(f?.outcome??'FINALIZE_FAILED');
    }catch(e){
      await this.db.query(`SELECT warehouse_identity.central_fail_challenge_v1($1,$2,$3)`,
        [input.challengeId,claimHash,e instanceof CentralError?e.code:'AUTHENTICATION_NOT_VERIFIED']).catch(()=>{});
      throw e instanceof CentralError?e:new CentralError('AUTHENTICATION_NOT_VERIFIED');
    }
    return signCentralResult(this.cfg,{ceremony:'RECOVERY_CONTACT_APPROVAL',userId:f.approver_user_id,challengeId:input.challengeId,
      evidenceId:f.evidence_id,enrollmentId:input.enrollmentId,approvals:f.approvals,required:f.required,approved:f.approved===true,
      requestId:ids.requestId,correlationId:ids.correlationId});
  }
}
