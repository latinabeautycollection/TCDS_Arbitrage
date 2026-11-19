import crypto from 'node:crypto';
import http from 'node:http';
import {generateAuthenticationOptions,verifyAuthenticationResponse} from '@simplewebauthn/server';
import {z} from 'zod';
import type {CentralConfig} from './centralConfig';
import {CentralError,VERIFIER_SERVICE,VERIFIER_VERSION,b64u,claimToken,clientChallenge,hmac,sha256Hex,signCentralResult,type Db,type Ids} from './centralService';

/**
 * EOC module-grant approval (TCDS 630). Optional: the /grant-approval routes exist only when ALL of these are set.
 * An approver signs ONE passkey ceremony for a whole grant set; when two different approvers' approvals are live
 * (5 minutes, the EOC's window), this verifier signs one vendor V13 attestation per item and approver
 * (TCDS:EOC:APPROVAL:V13, Ed25519, its own key) and hands them to the separately credentialed grant-admission
 * service, which admits them with the vendor's code and creates the grants with the vendor's 072 writer.
 */
const G=z.object({
  CENTRAL_GRANT_ADMISSION_URL:z.string().url(),
  CENTRAL_GRANT_ADMISSION_SECRET:z.string().min(32),
  CENTRAL_APPROVAL_SIGNING_KEY_PEM:z.string().min(64),
  CENTRAL_APPROVAL_ISSUER:z.string().min(8).max(200),
  CENTRAL_APPROVAL_AUDIENCE:z.string().min(8).max(200),
});
export type GrantConfig=z.infer<typeof G>;
const GKEYS=Object.keys(G.shape) as (keyof GrantConfig)[];

export function readGrantConfig(e:NodeJS.ProcessEnv):GrantConfig|null{
  const set=GKEYS.filter(k=>e[k]!==undefined&&e[k]!=='');
  if(set.length===0)return null;
  if(set.length!==GKEYS.length)throw new Error('CENTRAL_GRANT_CONFIG_INCOMPLETE');
  const g=G.parse(e);
  const u=new URL(g.CENTRAL_GRANT_ADMISSION_URL);
  if(u.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(u.hostname))throw new Error('CENTRAL_GRANT_ADMISSION_MUST_BE_LOOPBACK');
  const k=crypto.createPrivateKey(g.CENTRAL_APPROVAL_SIGNING_KEY_PEM);
  if(k.asymmetricKeyType!=='ed25519')throw new Error('CENTRAL_APPROVAL_SIGNING_KEY_MUST_BE_ED25519');
  return g;
}

// The vendor's canonical form (server/iam-v13/approvalProtocol.mjs canonicalApproval), field for field.
const APPROVAL_KEYS=['version','issuer','audience','purpose','evidenceId','requestId','approverUserId','approverSessionId','webAuthnEvidenceId',
  'targetUserId','bindingId','oidcIssuer','subjectHash','moduleId','operation','scopeKind','scopeIds','verifiedAt','expiresAt','ceremonyId','verifierReference'];
export const canonicalApproval=(a:Record<string,unknown>)=>'TCDS:EOC:APPROVAL:V13\n'+APPROVAL_KEYS.map(k=>JSON.stringify(a[k]??null)).join('\n');

type Item={moduleId:string;operation:string;scopeKind:string;scopeIds:string[]};
type Approval={approvalId:string;approverUserId:string;webAuthnEvidenceId:string;challengeId:string;verifiedAt:string;expiresAt:string};

export class CentralGrantService{
  constructor(private db:Db,private cfg:CentralConfig,private g:GrantConfig){}

  private async request(grantRequestId:string){
    const r=(await this.db.query(`SELECT * FROM warehouse_identity.central_grant_request_info_v1($1)`,[grantRequestId])).rows[0];
    if(!r)throw new CentralError('CENTRAL_GRANT_REQUEST_NOT_FOUND',404);
    return r;
  }

  /** Approval page: who, what (every item), for how long, and the live approvals with their 5-minute window. */
  async info(grantRequestId:string){
    const r=await this.request(grantRequestId);
    return {grantRequestId:r.request_id,status:r.status,purpose:r.purpose,targetDisplayName:r.target_display_name,targetUsername:r.target_username,
      items:r.items,validDays:r.valid_days,setFingerprint:String(r.set_sha256).slice(0,16),expiresAt:new Date(r.expires_at).toISOString(),
      approvals:r.approvals,required:2,firstApprovalExpiresAt:r.first_approval_expires_at?new Date(r.first_approval_expires_at).toISOString():null,
      serverTime:new Date().toISOString()};
  }

  async options(grantRequestId:string,ids:Ids){
    const options=await generateAuthenticationOptions({rpID:this.cfg.CENTRAL_RP_ID,userVerification:'required',allowCredentials:[],timeout:120_000});
    let id:string;
    try{
      id=(await this.db.query(`SELECT warehouse_identity.central_grant_approval_begin_v1($1,$2,$3,$4,$5,$6) id`,
        [grantRequestId,this.cfg.CENTRAL_RP_ID,this.cfg.CENTRAL_ORIGIN,hmac(options.challenge,this.cfg.challengeHashKey),ids.requestId,ids.correlationId])).rows[0].id;
    }catch(e:any){
      if(/CENTRAL_GRANT_REQUEST_NOT_OPEN/.test(String(e?.message)))throw new CentralError('CENTRAL_GRANT_REQUEST_NOT_OPEN',409);
      throw new CentralError('CENTRAL_APPROVAL_UNAVAILABLE',503);
    }
    return {challengeId:id,options};
  }

  /** Verify the assertion; 630 checks the approver and records it. The second live approval creates the EOC grants. */
  async verify(input:{challengeId:string;grantRequestId:string;response:any},ids:Ids){
    const resp=input.response;
    if(typeof resp?.id!=='string'||resp.type!=='public-key')throw new CentralError('ASSERTION_INVALID',400);
    const challenge=clientChallenge(resp.response?.clientDataJSON);
    const claimHash=hmac(claimToken(),this.cfg.claimHashKey);
    const c=(await this.db.query(`SELECT * FROM warehouse_identity.central_claim_challenge_v1($1,$2,$3,'EOC_GRANT_APPROVAL',$4,NULL,NULL,NULL)`,
      [input.challengeId,hmac(challenge,this.cfg.challengeHashKey),claimHash,this.cfg.CENTRAL_RP_ID])).rows[0];
    if(c?.outcome!=='CLAIMED')throw new CentralError(c?.outcome??'CHALLENGE_CLAIM_FAILED');
    let f:any;
    try{
      const k=(await this.db.query(`SELECT * FROM warehouse_identity.central_passkey_material_v1($1,$2)`,[resp.id,this.cfg.CENTRAL_RP_ID])).rows[0];
      if(!k||k.security_state!=='ACTIVE'||k.user_active!==true)throw new CentralError('CREDENTIAL_NOT_ACTIVE');
      const uh=resp.response?.userHandle;
      if(typeof uh!=='string'||!crypto.timingSafeEqual(Buffer.from(b64u(k.user_handle)),Buffer.from(uh.length===43?uh:'x'.repeat(43))))
        throw new CentralError('USER_HANDLE_MISMATCH');
      // counter 0: the signature is always checked first; 630 enforces the real counter on verified evidence (as 626/628)
      const v=await verifyAuthenticationResponse({response:{...resp,clientExtensionResults:resp.clientExtensionResults??{}},
        expectedChallenge:challenge,expectedOrigin:this.cfg.CENTRAL_ORIGIN,expectedRPID:this.cfg.CENTRAL_RP_ID,requireUserVerification:true,
        credential:{id:k.credential_id,publicKey:new Uint8Array(k.public_key),counter:0,transports:k.transports??[]}});
      if(!v.verified)throw new CentralError('AUTHENTICATION_NOT_VERIFIED');
      const i:any=v.authenticationInfo,r=resp.response;
      f=(await this.db.query(`SELECT * FROM warehouse_identity.central_finalize_grant_approval_v1(
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
    // The approval is recorded (committed). If this was the second live approval, create the EOC grants now.
    let grants=0;
    if(f.complete===true){
      const created=await this.createGrants(input.grantRequestId,f.approvals_detail as Approval[]);
      grants=created.length;
    }
    return signCentralResult(this.cfg,{ceremony:'EOC_GRANT_APPROVAL',userId:f.approver_user_id,challengeId:input.challengeId,
      evidenceId:f.evidence_id,grantRequestId:input.grantRequestId,approvals:f.approvals,granted:grants>0,grants,
      requestId:ids.requestId,correlationId:ids.correlationId});
  }

  private attestation(a:Approval,r:any,item:Item){
    const envelope={version:13,issuer:this.g.CENTRAL_APPROVAL_ISSUER,audience:this.g.CENTRAL_APPROVAL_AUDIENCE,purpose:'EOC_MODULE_GRANT_APPROVE',
      evidenceId:crypto.randomUUID(),requestId:r.request_id,approverUserId:a.approverUserId,
      // A laptop ceremony has no Warehouse session; the session field carries the ceremony's own single-use challenge id.
      approverSessionId:a.challengeId,webAuthnEvidenceId:a.webAuthnEvidenceId,targetUserId:r.target_user_id,
      bindingId:null,oidcIssuer:null,subjectHash:null,moduleId:item.moduleId,operation:item.operation,scopeKind:item.scopeKind,
      scopeIds:item.scopeIds,verifiedAt:a.verifiedAt,expiresAt:a.expiresAt,ceremonyId:a.challengeId,
      verifierReference:`central-1.0:${r.set_sha256}:${a.webAuthnEvidenceId}`};
    const signature=crypto.sign(null,Buffer.from(canonicalApproval(envelope)),this.g.CENTRAL_APPROVAL_SIGNING_KEY_PEM).toString('base64url');
    return {envelope,signature};
  }

  private async createGrants(grantRequestId:string,pair:Approval[]){
    const r=await this.request(grantRequestId);
    if(r.status!=='OPEN'||!Array.isArray(pair)||pair.length!==2)throw new CentralError('CENTRAL_GRANT_NOT_COMPLETE',409);
    const items=r.items as Item[];
    const body={grantRequestId:r.request_id,targetUserId:r.target_user_id,validDays:r.valid_days,setSha256:r.set_sha256,items,
      approvals:pair.map(a=>({approverUserId:a.approverUserId,attestations:items.map(it=>this.attestation(a,r,it))}))};
    let out:any;
    try{out=await this.post(body)}
    catch(e:any){
      const code=typeof e?.code==='string'&&/^[A-Z_]{3,64}$/.test(e.code)?e.code:'UNAVAILABLE';
      throw new CentralError('CENTRAL_GRANT_ADMISSION_FAILED_'+code,503);
    }
    if(!Array.isArray(out?.grantIds)||out.grantIds.length!==items.length)throw new CentralError('CENTRAL_GRANT_ADMISSION_INCONSISTENT',502);
    await this.db.query(`SELECT warehouse_identity.central_record_grants_v1($1,$2,$3)`,[r.request_id,pair.map(a=>a.approvalId),out.grantIds]);
    return out.grantIds as string[];
  }

  private post(body:unknown):Promise<any>{
    const raw=JSON.stringify(body),ts=String(Date.now());
    const sig=crypto.createHmac('sha256',this.g.CENTRAL_GRANT_ADMISSION_SECRET).update(ts+'.'+crypto.createHash('sha256').update(raw).digest('hex')).digest('base64url');
    return new Promise((resolve,reject)=>{
      const req=http.request(new URL('/internal/v1/eoc/grants/admit',this.g.CENTRAL_GRANT_ADMISSION_URL),{method:'POST',timeout:20_000,
        headers:{'content-type':'application/json','content-length':String(Buffer.byteLength(raw)),'x-tcds-timestamp':ts,'x-tcds-signature':sig}},res=>{
        let out='';res.setEncoding('utf8');res.on('data',(x:string)=>{if(out.length<65536)out+=x});
        res.on('end',()=>{let j:any;try{j=JSON.parse(out)}catch{return reject({code:'INVALID_RESPONSE'})}
          if(res.statusCode===200)return resolve(j);reject({code:j?.error?.code??'REFUSED'})});
      });
      req.on('timeout',()=>req.destroy(new Error('TIMEOUT')));
      req.on('error',()=>reject({code:'UNAVAILABLE'}));
      req.end(raw);
    });
  }
}
