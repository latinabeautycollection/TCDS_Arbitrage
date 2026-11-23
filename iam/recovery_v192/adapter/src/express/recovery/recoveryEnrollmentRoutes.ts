import crypto from 'node:crypto';
import {Router,type Request,type Response,type RequestHandler} from 'express';
import {z} from 'zod';
import type {Pool} from 'pg';
import type {IdentityEnv} from '../../config/env';
import type {RateLimitService} from '../../services/rateLimitService';
import {IdentityError,RateLimitError} from '../../errors/errors';
import {keyedHash} from '../../security/crypto';
import {tx} from '../../db/pool';
import type {RecoveryConfig,RecoveryKeys} from './recoveryConfig';
import type {RecoveryTransport} from './recoveryDelivery';
import {hmac,otpDigest,randomCode,safeEqual,seal,unseal} from './recoveryCrypto';

/**
 * Recovery-email enrollment for a SIGNED-IN employee (TCDS 645), mounted at /api/v1/auth/recovery-email behind the 6.1B
 * chain (origin, fetch metadata, CSRF for the session). The email is encrypted with the contact key; the database keeps
 * only ciphertext, a keyed fingerprint and a masked hint. Codes go out through the 644 delivery worker; an approver is
 * emailed the login-stg approval link once the employee has confirmed the code. Nothing here can approve an email.
 *   GET    /           current recovery email (masked) and any pending enrollment
 *   POST   /           {email}  start (or restart) an enrollment: a code is emailed to that address
 *   POST   /verify     {code}   confirm the code -> waiting for approval (approver notified)
 *   POST   /cancel              cancel the pending enrollment
 */
class HttpError extends Error{constructor(public code:string,public status:number){super(code);}}
const EMAIL=/^[^\s@<>()[\]\\,;:"]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;

export interface RecoveryEnrollmentDeps{
  pool:Pool;env:IdentityEnv;limits:RateLimitService;cfg:RecoveryConfig;keys:RecoveryKeys;transport:RecoveryTransport;
}

/** r•••@gmail.com - first character of the local part, the full domain. Shown to the employee and the approver. */
export function maskEmail(email:string){
  const [local,domain]=email.split('@');
  return `${local.slice(0,1)}${'•'.repeat(3)}@${domain}`;
}

const cookieValue=(req:Request,name:string)=>req.headers.cookie?.split(';').map(x=>x.trim()).find(x=>x.startsWith(name+'='))?.slice(name.length+1);
const ids=(req:Request)=>({requestId:(req as any).requestId as string,correlationId:(req as any).correlationId as string});

function sendError(req:Request,res:Response,e:any){
  if(res.headersSent)return;
  if(e instanceof RateLimitError){res.set('Retry-After',String(Math.max(1,Math.ceil(e.retryAfterMs/1000))));return res.status(429).json({error:{code:'RATE_LIMITED'}});}
  if(e instanceof HttpError)return res.status(e.status).json({error:{code:e.code}});
  if(e instanceof IdentityError)return res.status(e.statusCode).json({error:{code:e.code}});
  if(e?.name==='ZodError')return res.status(400).json({error:{code:'REQUEST_INVALID'}});
  const pg=typeof e?.code==='string'&&/^[0-9A-Z]{5}$/.test(e.code)?e.code:null;
  const token=typeof e?.message==='string'&&/^[A-Z][A-Z0-9_]{2,63}$/.test(e.message)?e.message:null;
  if(pg&&token){
    const status=token==='SESSION_INVALID'?401:pg==='54000'?429:pg==='42501'?403:pg.startsWith('22')?400:409;
    return res.status(status).json({error:{code:token}});
  }
  console.error(JSON.stringify({level:'error',msg:'recovery-email route failed',route:req.path,requestId:(req as any).requestId,error:String(e?.message??e).slice(0,120)}));
  return res.status(503).json({error:{code:'RECOVERY_DEPENDENCY_UNAVAILABLE'}});
}
const handle=(fn:(req:Request,res:Response)=>Promise<unknown>):RequestHandler=>async(req,res)=>{try{await fn(req,res);}catch(e){sendError(req,res,e);}};

export function recoveryEnrollmentRouter(d:RecoveryEnrollmentDeps):Router{
  const r=Router();
  const approvers=(d.cfg.RECOVERY_APPROVER_EMAILS??'').split(',').map(x=>x.trim()).filter(x=>EMAIL.test(x));

  async function session(req:Request){
    const token=cookieValue(req,'__Host-tcds_session');
    if(!token)throw new HttpError('SESSION_INVALID',401);
    const x=(await d.pool.query('SELECT * FROM warehouse_identity.runtime_session_envelope_by_token_v1($1,$2)',[keyedHash(token,d.env.SESSION_HASH_KEY),null])).rows[0];
    if(!x?.auth_session_id)throw new HttpError('SESSION_INVALID',401);
    return {sessionId:x.auth_session_id as string,userId:x.user_id as string};
  }
  async function limited<T>(req:Request,route:string,userId:string,work:()=>Promise<T>):Promise<T>{
    const dims:any[]=[{type:'IP',value:req.ip??'unknown'},{type:'IDENTIFIER',value:`recovery-email:${route}:${userId}`}];
    await d.limits.check(dims);
    try{const out=await work();await d.limits.success(dims);return out;}
    catch(e){await d.limits.failure(dims,`RECOVERY_EMAIL_${route}_FAILURE`).catch(()=>{});throw e;}
  }
  async function overview(sessionId:string){
    const rows=(await d.pool.query('SELECT * FROM warehouse_identity.recovery_contact_overview_v645($1)',[sessionId])).rows;
    const a=rows.find(x=>x.kind==='ACTIVE'),p=rows.find(x=>x.kind==='PENDING');
    let active:null|{email:string;since:string}=null;
    if(a){
      let masked='•••';
      try{masked=maskEmail(unseal({ciphertext:a.ciphertext,iv:a.iv,tag:a.tag},d.keys.contact).toString('utf8'));}catch{/* unreadable: show dots */}
      active={email:masked,since:new Date(a.since).toISOString()};
    }
    const pending=p?{email:p.contact_hint as string,status:p.status as string,requestedAt:new Date(p.since).toISOString(),
      expiresAt:new Date(p.expires_at).toISOString(),approvals:Number(p.approvals),required:Number(p.required)}:null;
    return {active,pending};
  }

  r.get('/',handle(async(req,res)=>{const s=await session(req);res.json(await overview(s.sessionId));}));

  r.post('/',handle(async(req,res)=>{
    const s=await session(req);
    const email=z.object({email:z.string().trim().min(6).max(254)}).parse(req.body??{}).email.toLowerCase();
    if(!EMAIL.test(email))throw new HttpError('RECOVERY_EMAIL_INVALID',400);
    await limited(req,'START',s.userId,async()=>{
      const code=randomCode(),salt=crypto.randomBytes(16);
      const contact=seal(email,d.keys.contact),payload=seal(JSON.stringify({kind:'CONTACT_CODE',code}),d.keys.outbox);
      await d.pool.query('SELECT * FROM warehouse_identity.recovery_contact_start_v645($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
        [s.sessionId,contact.ciphertext,contact.iv,contact.tag,hmac(d.keys.contactFp,'contact',email),maskEmail(email),
         otpDigest(code,salt,d.keys.otp),salt,payload.ciphertext,payload.iv,payload.tag,ids(req).correlationId]);
    });
    res.status(202).json(await overview(s.sessionId));
  }));

  r.post('/verify',handle(async(req,res)=>{
    const s=await session(req);
    const code=z.object({code:z.string().max(16)}).parse(req.body??{}).code.replace(/\D/g,'');
    if(code.length!==8)throw new HttpError('RECOVERY_CODE_INVALID',400);
    const outcome=await limited(req,'VERIFY',s.userId,()=>tx(d.pool as any,async c=>{
      const l=(await c.query('SELECT * FROM warehouse_identity.recovery_contact_code_load_v645($1)',[s.sessionId])).rows[0];
      const match=safeEqual(otpDigest(code,l.otp_salt,d.keys.otp),l.otp_hash);
      return (await c.query('SELECT warehouse_identity.recovery_contact_code_settle_v645($1,$2,$3) r',[s.sessionId,l.challenge_id,match])).rows[0]?.r as string;
    }));
    if(outcome==='INVALID')throw new HttpError('RECOVERY_CODE_INVALID',403);
    // Tell the approver(s). Best effort: the enrollment is recorded either way and the employee sees it as waiting.
    const view=await overview(s.sessionId);
    const enrollmentId=(await d.pool.query('SELECT warehouse_identity.recovery_contact_pending_id_v645($1) id',[s.sessionId])).rows[0]?.id;
    if(enrollmentId&&approvers.length&&d.cfg.RECOVERY_APPROVAL_LINK_BASE){
      const link=`${d.cfg.RECOVERY_APPROVAL_LINK_BASE}?e=${encodeURIComponent(enrollmentId)}`;
      const sent=await Promise.allSettled(approvers.map(to=>d.transport.sendEmail({kind:'APPROVAL_NEEDED',to,link,hint:view.pending?.email})));
      console.log(JSON.stringify({level:'info',msg:'recovery email awaiting approval',requestId:ids(req).requestId,
        notified:sent.filter(x=>x.status==='fulfilled'&&x.value==='ACCEPTED').length,of:approvers.length}));
    }else if(enrollmentId){
      console.log(JSON.stringify({level:'warn',msg:'recovery email awaiting approval; no approver notification configured',requestId:ids(req).requestId}));
    }
    res.json(view);
  }));

  r.post('/cancel',handle(async(req,res)=>{
    const s=await session(req);
    await d.pool.query('SELECT warehouse_identity.recovery_contact_cancel_v645($1) ok',[s.sessionId]);
    res.json(await overview(s.sessionId));
  }));

  r.use(handle(async()=>{throw new HttpError('NOT_FOUND',404);}));
  return r;
}
