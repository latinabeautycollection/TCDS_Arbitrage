import crypto from 'node:crypto';
import {generateAuthenticationOptions,generateRegistrationOptions,verifyAuthenticationResponse,verifyRegistrationResponse} from '@simplewebauthn/server';
import type {CentralConfig} from './centralConfig';

export type Db={query:(sql:string,values?:unknown[])=>Promise<{rows:any[]}>};
export type Ids={requestId:string;correlationId:string};
export class CentralError extends Error{constructor(readonly code:string,readonly status=403){super(code)}}

export const VERIFIER_SERVICE='tcds-central-passkey-verifier',VERIFIER_VERSION='1.0.0';
export const hmac=(v:string,key:string)=>crypto.createHmac('sha256',key).update(v).digest();
export const sha256Hex=(b:Buffer)=>crypto.createHash('sha256').update(b).digest('hex');
export const b64u=(b:Uint8Array|Buffer)=>Buffer.from(b).toString('base64url');
export const claimToken=()=>crypto.randomBytes(32).toString('base64url');

export function clientChallenge(clientDataJSON:unknown):string{
  if(typeof clientDataJSON!=='string'||clientDataJSON.length>8192)throw new CentralError('CLIENT_DATA_INVALID',400);
  let d:any;try{d=JSON.parse(Buffer.from(clientDataJSON,'base64url').toString('utf8'))}catch{throw new CentralError('CLIENT_DATA_INVALID',400)}
  if(typeof d?.challenge!=='string'||!/^[A-Za-z0-9_-]{16,128}$/.test(d.challenge))throw new CentralError('CLIENT_DATA_INVALID',400);
  return d.challenge;
}

/** Signed with the verifier's existing result key; a distinct contract so it can never pass as a Warehouse result. */
export function signCentralResult(cfg:CentralConfig,x:Record<string,unknown>){
  const unsigned={contractVersion:'central-1.0',verified:true,outcome:'SUCCEEDED',...x,rpId:cfg.CENTRAL_RP_ID,
    issuedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+60_000).toISOString(),
    verifierService:VERIFIER_SERVICE,verifierInstance:cfg.verifierInstance,resultNonce:crypto.randomUUID()};
  const canonical=JSON.stringify(unsigned,Object.keys(unsigned).sort());
  return {...unsigned,signature:crypto.sign(null,Buffer.from(canonical),cfg.resultSigningPrivateKeyPem).toString('base64url')};
}

export class CentralService{
  constructor(private db:Db,private cfg:CentralConfig){}

  /** Enrollment step 1: the invite token identifies exactly one named user. */
  async enrollmentOptions(inviteToken:string,ids:Ids){
    if(!/^[A-Za-z0-9_-]{43}$/.test(inviteToken))throw new CentralError('CENTRAL_INVITE_INVALID');
    const challenge=b64u(crypto.randomBytes(32));
    let s:any;
    try{
      s=(await this.db.query(`SELECT * FROM warehouse_identity.central_enrollment_begin_v1($1,$2,$3,$4,$5,$6)`,
        [crypto.createHash('sha256').update(inviteToken).digest(),this.cfg.CENTRAL_RP_ID,this.cfg.CENTRAL_ORIGIN,
         hmac(challenge,this.cfg.challengeHashKey),ids.requestId,ids.correlationId])).rows[0];
    }catch(e:any){throw new CentralError(/CENTRAL_INVITE/.test(String(e?.message))?'CENTRAL_INVITE_INVALID':'CENTRAL_ENROLLMENT_UNAVAILABLE',
      /CENTRAL_INVITE/.test(String(e?.message))?403:503)}
    const options=await generateRegistrationOptions({
      rpName:this.cfg.CENTRAL_RP_NAME,rpID:this.cfg.CENTRAL_RP_ID,challenge:Buffer.from(challenge,'base64url'),
      userName:s.username,userDisplayName:s.display_name,userID:new Uint8Array(s.user_handle),
      attestationType:'none',timeout:300_000,
      authenticatorSelection:{residentKey:'required',requireResidentKey:true,userVerification:'required'},
      excludeCredentials:(s.exclude_credential_ids??[]).map((id:string)=>({id})),
    });
    if(options.challenge!==challenge)throw new CentralError('CENTRAL_OPTIONS_INCONSISTENT',500);
    return {challengeId:s.auth_challenge_id as string,options};
  }

  /** Enrollment step 2: verify the attestation for the challenge, store the passkey and the evidence. */
  async enrollmentVerify(input:{challengeId:string;response:any;friendlyName?:string},ids:Ids){
    const challenge=clientChallenge(input.response?.response?.clientDataJSON);
    const claimHash=hmac(claimToken(),this.cfg.claimHashKey);
    const c=(await this.db.query(`SELECT * FROM warehouse_identity.central_claim_challenge_v1($1,$2,$3,'CENTRAL_PASSKEY_ENROLLMENT',$4,NULL,NULL,NULL)`,
      [input.challengeId,hmac(challenge,this.cfg.challengeHashKey),claimHash,this.cfg.CENTRAL_RP_ID])).rows[0];
    if(c?.outcome!=='CLAIMED')throw new CentralError(c?.outcome??'CHALLENGE_CLAIM_FAILED');
    try{
      const v=await verifyRegistrationResponse({response:input.response,expectedChallenge:challenge,expectedOrigin:this.cfg.CENTRAL_ORIGIN,
        expectedRPID:this.cfg.CENTRAL_RP_ID,requireUserVerification:true});
      if(!v.verified||!v.registrationInfo)throw new CentralError('REGISTRATION_NOT_VERIFIED');
      const i:any=v.registrationInfo,cred=i.credential;
      const algorithm=Number(require('@simplewebauthn/server/helpers').decodeCredentialPublicKey(cred.publicKey).get(3));
      if(!Number.isInteger(algorithm))throw new CentralError('WEBAUTHN_ALGORITHM_METADATA_MISSING');
      const r=input.response.response;
      const f=(await this.db.query(`SELECT * FROM warehouse_identity.central_finalize_enrollment_v1(
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)`,
        [input.challengeId,claimHash,c.claim_generation,cred.id,Buffer.from(cred.publicKey),algorithm,cred.transports??[],
         i.aaguid&&i.aaguid!=='00000000-0000-0000-0000-000000000000'?i.aaguid:null,i.credentialDeviceType,
         i.credentialDeviceType==='multiDevice',i.credentialBackedUp===true,input.friendlyName?.slice(0,100)??null,
         i.origin,i.rpID??this.cfg.CENTRAL_RP_ID,i.userVerified===true,
         sha256Hex(Buffer.from(r.attestationObject,'base64url')),sha256Hex(Buffer.from(r.clientDataJSON,'base64url')),
         sha256Hex(Buffer.from(cred.publicKey)),VERIFIER_SERVICE,VERIFIER_VERSION,this.cfg.verifierInstance,ids.requestId,ids.correlationId])).rows[0];
      if(f?.outcome!=='SUCCEEDED')throw new CentralError(f?.outcome??'FINALIZE_FAILED');
      return signCentralResult(this.cfg,{ceremony:'CENTRAL_PASSKEY_ENROLLMENT',userId:f.user_id,centralPasskeyId:f.central_passkey_id,
        challengeId:input.challengeId,evidenceId:f.evidence_id,requestId:ids.requestId,correlationId:ids.correlationId});
    }catch(e){
      await this.db.query(`SELECT warehouse_identity.central_fail_challenge_v1($1,$2,$3)`,
        [input.challengeId,claimHash,e instanceof CentralError?e.code:'REGISTRATION_NOT_VERIFIED']).catch(()=>{});
      throw e instanceof CentralError?e:new CentralError('REGISTRATION_NOT_VERIFIED');
    }
  }

  /** Login step 1: discoverable credential, so no user is named and nothing is listed. */
  async loginOptions(input:{issuer:string;interactionId:string;issuerRequestId:string},ids:Ids){
    const options=await generateAuthenticationOptions({rpID:this.cfg.CENTRAL_RP_ID,userVerification:'required',
      allowCredentials:[],timeout:this.cfg.CENTRAL_LOGIN_TTL_SECONDS*1000});
    let id:string;
    try{
      id=(await this.db.query(`SELECT warehouse_identity.central_login_begin_v1($1,$2,$3,$4,$5,$6,$7,$8,$9) id`,
        [input.issuer,input.interactionId,input.issuerRequestId,this.cfg.CENTRAL_RP_ID,this.cfg.CENTRAL_ORIGIN,
         hmac(options.challenge,this.cfg.challengeHashKey),ids.requestId,ids.correlationId,this.cfg.CENTRAL_LOGIN_TTL_SECONDS])).rows[0].id;
    }catch(e:any){
      if(/CENTRAL_LOGIN_ALREADY_STARTED/.test(String(e?.message)))throw new CentralError('CENTRAL_LOGIN_ALREADY_STARTED',409);
      if(/CENTRAL_LOGIN_REQUEST_INVALID/.test(String(e?.message)))throw new CentralError('CENTRAL_LOGIN_REQUEST_INVALID',400);
      throw new CentralError('CENTRAL_LOGIN_UNAVAILABLE',503);
    }
    return {challengeId:id,options};
  }

  /** Approval page header: who is being bound and for what (628). No hash, no binding id. */
  async approvalInfo(bindingRequestId:string){
    const r=(await this.db.query(`SELECT * FROM warehouse_identity.central_binding_request_info_v1($1)`,[bindingRequestId])).rows[0];
    if(!r)throw new CentralError('CENTRAL_BINDING_REQUEST_NOT_FOUND',404);
    return {bindingRequestId:r.request_id,status:r.status,purpose:r.purpose,targetDisplayName:r.target_display_name,
      targetUsername:r.target_username,issuer:r.issuer,expiresAt:new Date(r.expires_at).toISOString(),approvals:r.approvals,required:2};
  }

  /** Approval step 1 (628): discoverable; the passkey that signs identifies the approver, checked at finalize. */
  async approvalOptions(bindingRequestId:string,ids:Ids){
    const options=await generateAuthenticationOptions({rpID:this.cfg.CENTRAL_RP_ID,userVerification:'required',allowCredentials:[],timeout:120_000});
    let id:string;
    try{
      id=(await this.db.query(`SELECT warehouse_identity.central_approval_begin_v1($1,$2,$3,$4,$5,$6) id`,
        [bindingRequestId,this.cfg.CENTRAL_RP_ID,this.cfg.CENTRAL_ORIGIN,hmac(options.challenge,this.cfg.challengeHashKey),ids.requestId,ids.correlationId])).rows[0].id;
    }catch(e:any){
      if(/CENTRAL_BINDING_REQUEST_NOT_OPEN/.test(String(e?.message)))throw new CentralError('CENTRAL_BINDING_REQUEST_NOT_OPEN',409);
      throw new CentralError('CENTRAL_APPROVAL_UNAVAILABLE',503);
    }
    return {challengeId:id,options};
  }

  /** Approval step 2 (628): verify the assertion, then 628 checks the approver and records the approval (the second binds). */
  async approvalVerify(input:{challengeId:string;bindingRequestId:string;response:any},ids:Ids){
    const resp=input.response;
    if(typeof resp?.id!=='string'||resp.type!=='public-key')throw new CentralError('ASSERTION_INVALID',400);
    const challenge=clientChallenge(resp.response?.clientDataJSON);
    const claimHash=hmac(claimToken(),this.cfg.claimHashKey);
    const c=(await this.db.query(`SELECT * FROM warehouse_identity.central_claim_challenge_v1($1,$2,$3,'EOC_BINDING_APPROVAL',$4,NULL,NULL,NULL)`,
      [input.challengeId,hmac(challenge,this.cfg.challengeHashKey),claimHash,this.cfg.CENTRAL_RP_ID])).rows[0];
    if(c?.outcome!=='CLAIMED')throw new CentralError(c?.outcome??'CHALLENGE_CLAIM_FAILED');
    try{
      const k=(await this.db.query(`SELECT * FROM warehouse_identity.central_passkey_material_v1($1,$2)`,[resp.id,this.cfg.CENTRAL_RP_ID])).rows[0];
      if(!k||k.security_state!=='ACTIVE'||k.user_active!==true)throw new CentralError('CREDENTIAL_NOT_ACTIVE');
      const uh=resp.response?.userHandle;
      if(typeof uh!=='string'||!crypto.timingSafeEqual(Buffer.from(b64u(k.user_handle)),Buffer.from(uh.length===43?uh:'x'.repeat(43))))
        throw new CentralError('USER_HANDLE_MISMATCH');
      // counter 0: the signature is always checked first; 628 enforces the real counter on verified evidence (see loginVerify)
      const v=await verifyAuthenticationResponse({response:{...resp,clientExtensionResults:resp.clientExtensionResults??{}},
        expectedChallenge:challenge,expectedOrigin:this.cfg.CENTRAL_ORIGIN,expectedRPID:this.cfg.CENTRAL_RP_ID,requireUserVerification:true,
        credential:{id:k.credential_id,publicKey:new Uint8Array(k.public_key),counter:0,transports:k.transports??[]}});
      if(!v.verified)throw new CentralError('AUTHENTICATION_NOT_VERIFIED');
      const i:any=v.authenticationInfo,r=resp.response;
      const f=(await this.db.query(`SELECT * FROM warehouse_identity.central_finalize_approval_v1(
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
        [input.challengeId,claimHash,c.claim_generation,k.central_passkey_id,k.row_version,k.sign_count,i.newCounter,
         i.origin,i.rpID,i.userVerified===true,sha256Hex(Buffer.from(r.authenticatorData,'base64url')),
         sha256Hex(Buffer.from(r.clientDataJSON,'base64url')),sha256Hex(Buffer.from(r.signature,'base64url')),
         i.credentialDeviceType==='multiDevice',i.credentialBackedUp===true,VERIFIER_SERVICE,VERIFIER_VERSION,this.cfg.verifierInstance,
         ids.requestId,ids.correlationId])).rows[0];
      if(f?.outcome!=='SUCCEEDED')throw new CentralError(f?.outcome??'FINALIZE_FAILED');
      return signCentralResult(this.cfg,{ceremony:'EOC_BINDING_APPROVAL',userId:f.approver_user_id,challengeId:input.challengeId,
        evidenceId:f.evidence_id,bindingRequestId:input.bindingRequestId,approvals:f.approvals,bound:f.bound===true,
        requestId:ids.requestId,correlationId:ids.correlationId});
    }catch(e){
      await this.db.query(`SELECT warehouse_identity.central_fail_challenge_v1($1,$2,$3)`,
        [input.challengeId,claimHash,e instanceof CentralError?e.code:'AUTHENTICATION_NOT_VERIFIED']).catch(()=>{});
      throw e instanceof CentralError?e:new CentralError('AUTHENTICATION_NOT_VERIFIED');
    }
  }

  /** Login step 2: verify the assertion; the challenge must have been issued for this issuer interaction. */
  async loginVerify(input:{challengeId:string;issuer:string;interactionId:string;issuerRequestId:string;response:any},ids:Ids){
    const resp=input.response;
    if(typeof resp?.id!=='string'||resp.type!=='public-key')throw new CentralError('ASSERTION_INVALID',400);
    const challenge=clientChallenge(resp.response?.clientDataJSON);
    const claimHash=hmac(claimToken(),this.cfg.claimHashKey);
    const c=(await this.db.query(`SELECT * FROM warehouse_identity.central_claim_challenge_v1($1,$2,$3,'EOC_OIDC_LOGIN',$4,$5,$6,$7)`,
      [input.challengeId,hmac(challenge,this.cfg.challengeHashKey),claimHash,this.cfg.CENTRAL_RP_ID,
       input.issuer,input.interactionId,input.issuerRequestId])).rows[0];
    if(c?.outcome!=='CLAIMED')throw new CentralError(c?.outcome??'CHALLENGE_CLAIM_FAILED');
    try{
      const k=(await this.db.query(`SELECT * FROM warehouse_identity.central_passkey_material_v1($1,$2)`,[resp.id,this.cfg.CENTRAL_RP_ID])).rows[0];
      if(!k||k.security_state!=='ACTIVE'||k.user_active!==true)throw new CentralError('CREDENTIAL_NOT_ACTIVE');
      // A discoverable credential always returns its user handle; it must be the one registered for this passkey.
      const uh=resp.response?.userHandle;
      if(typeof uh!=='string'||!crypto.timingSafeEqual(Buffer.from(b64u(k.user_handle)),Buffer.from(uh.length===43?uh:'x'.repeat(43))))
        throw new CentralError('USER_HANDLE_MISMATCH');
      // counter: 0 here so the library always checks the SIGNATURE first (it checks the counter before the
      // signature and would otherwise reject unverified input); 626 then enforces the real counter rule with the
      // real prior value and suspends a cloned passkey on verified evidence only.
      const v=await verifyAuthenticationResponse({response:{...resp,clientExtensionResults:resp.clientExtensionResults??{}},
        expectedChallenge:challenge,expectedOrigin:this.cfg.CENTRAL_ORIGIN,expectedRPID:this.cfg.CENTRAL_RP_ID,requireUserVerification:true,
        credential:{id:k.credential_id,publicKey:new Uint8Array(k.public_key),counter:0,transports:k.transports??[]}});
      if(!v.verified)throw new CentralError('AUTHENTICATION_NOT_VERIFIED');
      const i:any=v.authenticationInfo,r=resp.response;
      const f=(await this.db.query(`SELECT * FROM warehouse_identity.central_finalize_login_v1(
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
        [input.challengeId,claimHash,c.claim_generation,k.central_passkey_id,k.row_version,k.sign_count,i.newCounter,
         i.origin,i.rpID,i.userVerified===true,sha256Hex(Buffer.from(r.authenticatorData,'base64url')),
         sha256Hex(Buffer.from(r.clientDataJSON,'base64url')),sha256Hex(Buffer.from(r.signature,'base64url')),
         i.credentialDeviceType==='multiDevice',i.credentialBackedUp===true,VERIFIER_SERVICE,VERIFIER_VERSION,this.cfg.verifierInstance,
         ids.requestId,ids.correlationId])).rows[0];
      if(f?.outcome!=='SUCCEEDED')throw new CentralError(f?.outcome??'FINALIZE_FAILED');
      if(f.issuer!==input.issuer||f.interaction_id!==input.interactionId||f.issuer_request_id!==input.issuerRequestId)
        throw new CentralError('ISSUER_BINDING_MISMATCH');
      return signCentralResult(this.cfg,{ceremony:'EOC_OIDC_LOGIN',userId:f.user_id,challengeId:input.challengeId,evidenceId:f.evidence_id,
        authTime:Math.floor(new Date(f.auth_time).getTime()/1000),issuer:f.issuer,interactionId:f.interaction_id,
        issuerRequestId:f.issuer_request_id,userVerified:true,requestId:ids.requestId,correlationId:ids.correlationId});
    }catch(e){
      await this.db.query(`SELECT warehouse_identity.central_fail_challenge_v1($1,$2,$3)`,
        [input.challengeId,claimHash,e instanceof CentralError?e.code:'AUTHENTICATION_NOT_VERIFIED']).catch(()=>{});
      throw e instanceof CentralError?e:new CentralError('AUTHENTICATION_NOT_VERIFIED');
    }
  }
}
