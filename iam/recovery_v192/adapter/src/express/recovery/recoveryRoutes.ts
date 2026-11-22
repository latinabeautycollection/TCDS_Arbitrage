import crypto from 'node:crypto';
import path from 'node:path';
import {Router,type Request,type Response,type RequestHandler} from 'express';
import {z} from 'zod';
import type {Pool} from 'pg';
import type {IdentityEnv} from '../../config/env';
import type {RateLimitService} from '../../services/rateLimitService';
import type {PasswordResetService} from '../../services/passwordResetService';
import {IdentityError,RateLimitError} from '../../errors/errors';
import {keyedHash} from '../../security/crypto';
import {tx} from '../../db/pool';
import type {RecoveryConfig,RecoveryKeys} from './recoveryConfig';
import {RecoveryStore,RECOVERY_COOKIE,COOKIE_RE} from './recoveryStore';
import {hmac,otpDigest,safeEqual,sha256hex,REF_RE} from './recoveryCrypto';

/** Same HTTP contract as the vendor V1.9.2 router (paths, payloads, __Host-tcds_recovery), on the TCDS 644 functions. */
class HttpError extends Error{constructor(public code:string,public status:number){super(code);}}
const APPROVE_PERMISSION='warehouse:identity:password:reset_approve';
const TOKEN_TTL_SECONDS=30*60;                       // approve_password_reset_v3 accepts at most 30 minutes
const U=z.string().uuid();
const ACCEPTED_MESSAGE='If the account is eligible, an administrator will review the request.';

export interface RecoveryRouteDeps{
  pool:Pool;env:IdentityEnv;limits:RateLimitService;resets:PasswordResetService;
  cfg:RecoveryConfig;keys:RecoveryKeys;store:RecoveryStore;
}

type WebAuthnLib={
  generateAuthenticationOptions(o:any):Promise<any>;
  verifyAuthenticationResponse(o:any):Promise<{verified:boolean;authenticationInfo:{newCounter:number;userVerified:boolean}}>;
};
/** @simplewebauthn/server lives in its own pinned install (RECOVERY_DEPS_DIR); 6.1B's node_modules stay untouched. */
export const loadWebAuthn=(depsDir:string):WebAuthnLib=>require(path.join(depsDir,'node_modules','@simplewebauthn','server'));

const ids=(req:Request)=>({requestId:(req as any).requestId as string,correlationId:(req as any).correlationId as string});
const cookieValue=(req:Request,name:string)=>req.headers.cookie?.split(';').map(x=>x.trim()).find(x=>x.startsWith(name+'='))?.slice(name.length+1);

function sendError(req:Request,res:Response,e:any){
  if(res.headersSent)return;
  if(e instanceof RateLimitError){res.set('Retry-After',String(Math.max(1,Math.ceil(e.retryAfterMs/1000))));return res.status(429).json({error:{code:'RATE_LIMITED'}});}
  if(e instanceof HttpError)return res.status(e.status).json({error:{code:e.code}});
  if(e instanceof IdentityError)return res.status(e.statusCode).json({error:{code:e.code}});
  if(e?.name==='ZodError')return res.status(400).json({error:{code:'REQUEST_INVALID'}});
  const pg=typeof e?.code==='string'&&/^[0-9A-Z]{5}$/.test(e.code)?e.code:null;
  const token=typeof e?.message==='string'&&/^[A-Z][A-Z0-9_]{2,63}$/.test(e.message)?e.message:null;
  if(pg&&token){
    const status=pg==='42501'?403:pg==='40001'||pg==='55000'||pg==='55P03'?409:pg.startsWith('22')||pg.startsWith('23')?400:409;
    return res.status(status).json({error:{code:token}});
  }
  console.error(JSON.stringify({level:'error',msg:'recovery route failed',route:req.path,requestId:(req as any).requestId,error:String(e?.message??e).slice(0,120)}));
  return res.status(503).json({error:{code:'RECOVERY_DEPENDENCY_UNAVAILABLE'}});
}
const handle=(fn:(req:Request,res:Response)=>Promise<unknown>):RequestHandler=>async(req,res)=>{try{await fn(req,res);}catch(e){sendError(req,res,e);}};

export function recoveryRouter(d:RecoveryRouteDeps):Router{
  const r=Router();
  const webauthn=loadWebAuthn(d.cfg.RECOVERY_DEPS_DIR);
  const refHash=(ref:string)=>hmac(d.keys.ref,'invitation',ref);

  // Existing 6.1B rate limiter (PostgreSQL authoritative + Redis), per IP and per IP+route.
  async function limited<T>(req:Request,route:string,work:()=>Promise<T>,extra?:string):Promise<T>{
    const ip=req.ip??'unknown';
    const dims:any[]=[{type:'IP',value:ip},{type:'IP_IDENTIFIER',value:`${ip}:recovery:${route}`}];
    if(extra)dims.push({type:'IDENTIFIER',value:`recovery:${extra.toLowerCase()}`});
    await d.limits.check(dims);
    try{const out=await work();await d.limits.success(dims);return out;}
    catch(e){await d.limits.failure(dims,`RECOVERY_${route}_FAILURE`).catch(()=>{});throw e;}
  }
  async function resolveRef(ref:unknown):Promise<string>{
    if(typeof ref!=='string'||!REF_RE.test(ref))throw new HttpError('INVITATION_UNAVAILABLE',404);
    const q=await d.pool.query('SELECT warehouse_identity.recovery_invitation_resolve_v192($1) id',[refHash(ref)]);
    const id=q.rows[0]?.id;if(!id)throw new HttpError('INVITATION_UNAVAILABLE',404);
    return id;
  }
  function browserCookie(req:Request):string{
    const v=cookieValue(req,RECOVERY_COOKIE);
    if(!v||!COOKIE_RE.test(v))throw new HttpError('RECOVERY_COOKIE_REQUIRED',401);
    return v;
  }
  async function session(req:Request,permission:string){
    const token=cookieValue(req,'__Host-tcds_session');
    if(!token)throw new HttpError('SESSION_INVALID',401);
    const q=await d.pool.query('SELECT * FROM warehouse_identity.runtime_session_envelope_by_token_v1($1,$2)',[keyedHash(token,d.env.SESSION_HASH_KEY),permission]);
    const x:any=q.rows[0];
    if(!x)throw new HttpError('ACCESS_DENIED',403);
    return {sessionId:x.auth_session_id as string,userId:x.user_id as string,deviceId:x.device_id as string,
      facilityId:x.facility_id as string,assurance:x.assurance_level as string};
  }

  // Code check -> OTP proof bound to this browser -> server-side claim of the reset token (6.1B claim service).
  async function claimFor(req:Request,cookie:string,requestId:string,code:unknown){
    const state=await d.store.state(cookie);
    if(!state||state.requestId!==requestId)throw new HttpError('RECOVERY_SESSION_INVALID',401);
    if(state.stage==='CLAIMED')return state.secrets;
    const binding=d.store.bindingHash(cookie);
    let proofId:string|null=(await d.pool.query('SELECT warehouse_identity.recovery_bound_proof_v192($1,$2) p',[requestId,binding])).rows[0]?.p??null;
    if(!proofId){
      if(typeof code!=='string'||!/^\d{8}$/.test(code))throw new HttpError('OTP_INVALID',400);
      proofId=await tx(d.pool as any,async c=>{
        const l=(await c.query('SELECT * FROM warehouse_identity.recovery_otp_load_v192($1)',[requestId])).rows[0];
        const match=safeEqual(otpDigest(code,l.otp_salt,d.keys.otp),l.otp_hash);
        return (await c.query('SELECT warehouse_identity.recovery_otp_settle_v192($1,$2,$3,$4) p',[requestId,l.challenge_id,match,binding])).rows[0]?.p??null;
      });
      if(!proofId)throw new HttpError('OTP_INVALID',403);
    }
    const token=await d.store.getToken(requestId);
    if(!token)throw new HttpError('RESET_TOKEN_UNAVAILABLE',409);
    const claimed:any=await d.resets.claim(requestId,token,ids(req));
    if(!claimed?.claimToken||!claimed?.browserBinding)throw new HttpError('RESET_CLAIM_FAILED',409);
    const secrets={claimToken:claimed.claimToken,browserBinding:claimed.browserBinding,proofId};
    if(!await d.store.markClaimed(cookie,requestId,secrets))throw new HttpError('RECOVERY_SESSION_CONFLICT',409);
    await d.store.dropToken(requestId);
    return secrets;
  }

  // ---------------------------------------------------------------- public (no session; Origin + Fetch-Metadata apply)
  r.post('/request',handle(async(req,res)=>{
    const b=z.object({identifier:z.string().min(2).max(200),reason:z.enum(['FORGOT_PASSWORD','ACCOUNT_LOCKED','SUSPECTED_COMPROMISE','OTHER']),
      details:z.string().max(1000).optional()}).parse(req.body??{});
    await limited(req,'REQUEST',async()=>{
      const o=await d.pool.query('SELECT warehouse_identity.recovery_intake_v192($1,$2,$3,$4,$5) outcome',
        [b.identifier,b.reason,b.details??'',ids(req).requestId,ids(req).correlationId]);
      console.log(JSON.stringify({level:'info',msg:'recovery intake',requestId:ids(req).requestId,outcome:o.rows[0]?.outcome}));
    },b.identifier);
    res.status(202).json({message:ACCEPTED_MESSAGE});
  }));

  r.get('/invitation/context',handle(async(req,res)=>{
    const ref=req.query.ref;
    await limited(req,'INVITATION',()=>resolveRef(ref));
    res.json({publicReference:ref});                // the internal request id is never sent to the browser
  }));

  r.post('/binding',handle(async(req,res)=>{
    const ref=z.object({reference:z.string().max(100)}).parse(req.body??{}).reference;
    const requestId=await limited(req,'BINDING',()=>resolveRef(ref));
    const cookie=d.store.newCookieValue();
    if(!await d.store.reserve(cookie,requestId))throw new HttpError('RECOVERY_SESSION_UNAVAILABLE',503);
    res.cookie(RECOVERY_COOKIE,cookie,{httpOnly:true,secure:true,sameSite:'strict',path:'/',maxAge:15*60*1000});
    res.status(204).end();
  }));

  r.post('/claim',handle(async(req,res)=>{
    const b=z.object({reference:z.string().max(100),code:z.string().max(16)}).parse(req.body??{});
    const cookie=browserCookie(req);
    await limited(req,'CLAIM',async()=>claimFor(req,cookie,await resolveRef(b.reference),b.code));
    res.status(204).end();
  }));

  // Accepts the code too, so the PWA can verify the code and set the password in one submit (claim window is 2 min).
  r.post('/complete',handle(async(req,res)=>{
    const b=z.object({reference:z.string().max(100),newPassword:z.string().min(1).max(1024),code:z.string().max(16).optional()}).parse(req.body??{});
    const cookie=browserCookie(req);
    await limited(req,'COMPLETE',async()=>{
      const requestId=await resolveRef(b.reference);
      const s=await claimFor(req,cookie,requestId,b.code);
      const result=await d.resets.consume(requestId,s.claimToken,s.browserBinding,b.newPassword,ids(req),s.proofId);
      if(result!=='CONSUMED')throw new HttpError('RESET_NOT_CONFIRMED',409);
      // The password change is committed. Cleanup is best effort; the consumed reset cannot be used again anyway.
      await Promise.allSettled([d.store.forget(cookie),d.store.dropToken(requestId),
        d.pool.query('SELECT warehouse_identity.recovery_invitation_revoke_v192($1)',[requestId])]);
    });
    res.clearCookie(RECOVERY_COOKIE,{secure:true,sameSite:'strict',path:'/'});
    res.json({completed:true});
  }));

  // ---------------------------------------------------------------- administrator (session + permission; CSRF via 6.1B chain)
  const view=(x:any)=>({requestId:x.request_id,expectedRowVersion:String(x.row_version),rowVersion:String(x.row_version),
    employeeDisplayId:x.employee_display_id,status:x.status,reasonCode:x.reason_code,reason:x.reason||x.reason_code,
    requestedAt:x.requested_at,facilityId:x.facility_id});
  const cursorSign=(body:string)=>hmac(d.keys.cursor,'cursor',body).toString('base64url');

  r.get('/admin/pending',handle(async(req,res)=>{
    const s=await session(req,APPROVE_PERMISSION);
    const limit=req.query.limit===undefined?25:Number(req.query.limit);
    if(!Number.isInteger(limit)||limit<1||limit>50)throw new HttpError('QUEUE_PAGE_SIZE_INVALID',400);
    let after:{t:string;id:string}|null=null;
    if(typeof req.query.cursor==='string'&&req.query.cursor){
      const [body,sig]=req.query.cursor.split('.');
      if(!body||!sig||!safeEqual(Buffer.from(cursorSign(body)),Buffer.from(sig)))throw new HttpError('QUEUE_CURSOR_INVALID',400);
      const o=JSON.parse(Buffer.from(body,'base64url').toString());
      if(o.s!==s.sessionId)throw new HttpError('QUEUE_CURSOR_INVALID',400);
      after={t:o.t,id:o.id};
    }
    const rows=(await d.pool.query('SELECT * FROM warehouse_identity.recovery_queue_v192($1,$2,$3,NULL,$4,$5,$6)',
      [s.sessionId,s.facilityId,APPROVE_PERMISSION,after?.t??null,after?.id??null,limit+1])).rows;
    const items=rows.slice(0,limit);
    const last=items[items.length-1];
    let nextCursor:string|null=null;
    if(rows.length>limit&&last){const body=Buffer.from(JSON.stringify({s:s.sessionId,t:new Date(last.requested_at).toISOString(),id:last.request_id})).toString('base64url');nextCursor=`${body}.${cursorSign(body)}`;}
    res.json({items:items.map(view),nextCursor});
  }));

  r.get('/admin/review/:id',handle(async(req,res)=>{
    const s=await session(req,APPROVE_PERMISSION);const id=U.parse(req.params.id);
    const x=(await d.pool.query('SELECT * FROM warehouse_identity.recovery_queue_v192($1,$2,$3,$4,NULL,NULL,1)',[s.sessionId,s.facilityId,APPROVE_PERMISSION,id])).rows[0];
    if(!x)throw new HttpError('RECOVERY_REVIEW_NOT_AUTHORIZED',403);
    res.json(view(x));
  }));

  r.post('/admin/step-up/:id',handle(async(req,res)=>{
    const s=await session(req,APPROVE_PERMISSION);const id=U.parse(req.params.id);
    const o=(await d.pool.query('SELECT * FROM warehouse_identity.recovery_stepup_options_v192($1,$2,$3,$4,$5)',
      [s.sessionId,s.deviceId,s.facilityId,'WAREHOUSE_PASSWORD_RESET_APPROVAL',id])).rows[0];
    const options=await webauthn.generateAuthenticationOptions({rpID:d.env.PASSKEY_RP_ID,userVerification:'required',timeout:120000,
      allowCredentials:(o.credential_ids as string[]).map(cid=>({id:cid}))});
    const challengeId=(await d.pool.query('SELECT warehouse_identity.recovery_stepup_begin_v192($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) id',
      [s.sessionId,s.deviceId,s.facilityId,'WAREHOUSE_PASSWORD_RESET_APPROVAL',id,o.row_version,options.challenge,
       d.env.PUBLIC_APP_ORIGIN,d.env.PASSKEY_RP_ID,ids(req).correlationId])).rows[0].id;
    res.json({challengeId,options,purpose:'WAREHOUSE_PASSWORD_RESET_APPROVAL',requestId:id,rowVersion:String(o.row_version)});
  }));

  r.post('/admin/approve',handle(async(req,res)=>{
    const s=await session(req,APPROVE_PERMISSION);
    const b=z.object({requestId:U,expectedRowVersion:z.string().regex(/^[1-9][0-9]{0,18}$/),decision:z.string(),notes:z.string().max(1000).optional(),
      challengeId:U.optional(),passkeyResponse:z.any().optional()}).parse(req.body??{});
    // Approval only. Reject / require-verification must never be turned into an approval here.
    if(b.decision!=='APPROVE_RESET')throw new HttpError('REVIEW_DECISION_NOT_SUPPORTED',422);
    if(!b.challengeId||!b.passkeyResponse)throw new HttpError('FRESH_STEP_UP_REQUIRED',403);
    if(s.assurance!=='AAL2')throw new HttpError('AAL2_REQUIRED',403);
    const eligible=(await d.pool.query('SELECT warehouse_identity.recovery_contact_eligible_v192($1,$2) ok',[b.requestId,'EMAIL'])).rows[0]?.ok;
    if(eligible!==true)throw new HttpError('VERIFIED_RECOVERY_DESTINATION_REQUIRED',409);
    const resp:any=b.passkeyResponse;
    if(typeof resp?.id!=='string'||typeof resp?.response?.authenticatorData!=='string'||typeof resp?.response?.clientDataJSON!=='string'
      ||typeof resp?.response?.signature!=='string')throw new HttpError('STEPUP_ASSERTION_INVALID',400);

    // Passkey step-up: lock challenge + passkey, verify the assertion, record evidence and 6.2 authorization - one transaction.
    await tx(d.pool as any,async c=>{
      const k=(await c.query('SELECT * FROM warehouse_identity.recovery_stepup_load_v192($1,$2,$3,$4)',[s.sessionId,s.deviceId,b.challengeId,resp.id])).rows[0];
      let v;
      try{
        v=await webauthn.verifyAuthenticationResponse({response:resp,expectedChallenge:k.challenge_text,expectedOrigin:k.expected_origin,
          expectedRPID:k.expected_rp_id,requireUserVerification:true,
          credential:{id:resp.id,publicKey:new Uint8Array(k.public_key),counter:Number(k.sign_count)}});
      }catch{throw new HttpError('STEPUP_SIGNATURE_INVALID',403);}
      if(!v.verified)throw new HttpError('STEPUP_SIGNATURE_INVALID',403);
      const raw=(x:string)=>Buffer.from(x,'base64url');
      await c.query('SELECT warehouse_identity.recovery_stepup_finish_v192($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
        [s.sessionId,s.deviceId,b.challengeId,k.passkey_id,v.authenticationInfo.newCounter,v.authenticationInfo.userVerified,
         sha256hex(raw(resp.response.authenticatorData)),sha256hex(raw(resp.response.clientDataJSON)),sha256hex(raw(resp.response.signature)),
         'simplewebauthn-13',ids(req).correlationId]);
    });

    // Intent first (so a crash after approval still gets the code issued), then the token, then the approval itself.
    await d.pool.query('SELECT warehouse_identity.recovery_issuance_intent_v192($1,$2)',[b.requestId,ids(req).correlationId]);
    const token=crypto.randomBytes(32).toString('base64url');
    await d.store.putToken(b.requestId,token,TOKEN_TTL_SECONDS);
    const expiresAt=new Date(Date.now()+TOKEN_TTL_SECONDS*1000-5000).toISOString();
    let outcome:string|undefined;
    try{
      outcome=(await d.pool.query('SELECT warehouse_identity.approve_password_reset_v3($1,$2,$3,$4,$5) outcome',
        [s.sessionId,b.requestId,b.expectedRowVersion,keyedHash(token,d.env.SESSION_HASH_KEY),expiresAt])).rows[0]?.outcome;
    }catch(e){await d.store.dropToken(b.requestId).catch(()=>{});throw e;}
    if(outcome!=='APPROVED'){await d.store.dropToken(b.requestId).catch(()=>{});throw new HttpError(outcome??'APPROVAL_FAILED',409);}
    console.log(JSON.stringify({level:'info',msg:'recovery approved',requestId:ids(req).requestId}));
    res.json({status:'TOKEN_ISSUED',deliveryStatus:'PENDING'});
  }));

  // Manager 24-hour override needs EXECUTE on authorize_password_recovery_override_v62 (644 addendum) - not enabled yet.
  r.post('/manager/step-up',handle(async()=>{throw new HttpError('MANAGER_OVERRIDE_NOT_AVAILABLE',501);}));
  r.post('/manager/override',handle(async()=>{throw new HttpError('MANAGER_OVERRIDE_NOT_AVAILABLE',501);}));
  r.use(handle(async()=>{throw new HttpError('NOT_FOUND',404);}));
  return r;
}
