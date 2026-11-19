import crypto from 'node:crypto';
import {Router,type Request,type Response,type NextFunction} from 'express';
import {z} from 'zod';
import {CentralError,CentralService,type Db} from './centralService';
import type {CentralConfig} from './centralConfig';
import {CentralGrantService,type GrantConfig} from './centralGrants';

const U=z.string().uuid();
const Issuer=z.string().regex(/^https:\/\/[a-z0-9.-]+(:[0-9]{1,5})?\/?$/);
const Interaction=z.string().regex(/^[A-Za-z0-9_-]{8,160}$/);
const Assertion=z.object({id:z.string().min(16).max(1366),rawId:z.string().min(16).max(1366),type:z.literal('public-key'),
  response:z.object({clientDataJSON:z.string().max(8192),authenticatorData:z.string().max(8192),signature:z.string().max(2048),
    userHandle:z.string().max(128).nullable().optional()}).passthrough(),
  clientExtensionResults:z.record(z.string(),z.unknown()).optional(),authenticatorAttachment:z.string().max(32).nullable().optional()}).passthrough();
const Attestation=z.object({id:z.string().min(16).max(1366),rawId:z.string().min(16).max(1366),type:z.literal('public-key'),
  response:z.object({clientDataJSON:z.string().max(8192),attestationObject:z.string().max(65536)}).passthrough(),
  clientExtensionResults:z.record(z.string(),z.unknown()).optional()}).passthrough();

const ids=(r:Request)=>{
  const requestId=String(r.get('x-request-id')),correlationId=String(r.get('x-correlation-id'));
  if(!U.safeParse(requestId).success||!U.safeParse(correlationId).success)throw new CentralError('REQUEST_IDS_INVALID',400);
  return {requestId,correlationId};
};

/** Same request signing as the vendor 'webauthn' / 'device' scopes, with its own secret, scope and nonce table. */
export function centralWorkloadAuth(db:Db,cfg:CentralConfig){
  return async(req:Request,res:Response,next:NextFunction)=>{
    try{
      const hash=crypto.createHash('sha256').update(JSON.stringify(req.body??{})).digest('hex');
      const ts=req.get('x-tcds-timestamp'),nonce=req.get('x-tcds-nonce'),rid=req.get('x-request-id'),cid=req.get('x-correlation-id');
      const sig=req.get('x-tcds-request-signature');
      if(!ts||!nonce||!rid||!cid||!sig||!/^\d{13}$/.test(ts)||Math.abs(Date.now()-Number(ts))>60_000||req.get('x-tcds-workload')!=='central'
        ||req.get('x-tcds-body-sha256')!==hash||!U.safeParse(rid).success||!U.safeParse(cid).success||nonce.length<16||nonce.length>128)
        return res.status(401).json({error:{code:'WORKLOAD_AUTH_FAILED'}});
      const expected=Buffer.from(crypto.createHmac('sha256',cfg.CENTRAL_WORKLOAD_SECRET).update(`${ts}.${nonce}.${hash}.${rid}`).digest('base64url'));
      const supplied=Buffer.from(sig);
      if(expected.length!==supplied.length||!crypto.timingSafeEqual(expected,supplied))return res.status(401).json({error:{code:'WORKLOAD_AUTH_FAILED'}});
      const q=await db.query(`SELECT warehouse_identity.central_claim_workload_nonce_v1($1,$2,$3,clock_timestamp()+interval '70 seconds') claimed`,
        [crypto.createHash('sha256').update(nonce).digest(),rid,cid]);
      if(q.rows[0]?.claimed!==true)return res.status(409).json({error:{code:'WORKLOAD_REPLAY_REJECTED'}});
      return next();
    }catch{return res.status(503).json({error:{code:'WORKLOAD_SECURITY_DEPENDENCY_UNAVAILABLE'}})}
  };
}

export function centralRoutes(db:Db,cfg:CentralConfig,grants:GrantConfig|null=null){
  const r=Router(),s=new CentralService(db,cfg);
  const run=(fn:(req:Request)=>Promise<unknown>)=>async(req:Request,res:Response)=>{
    try{res.set('Cache-Control','no-store').json(await fn(req))}
    catch(e){
      if(e instanceof z.ZodError)return res.status(400).json({error:{code:'REQUEST_INVALID'}});
      const c=e instanceof CentralError?e:new CentralError('CENTRAL_VERIFIER_FAILED',500);
      res.status(c.status).json({error:{code:c.code}});
    }
  };
  r.post('/enrollment/options',run(q=>s.enrollmentOptions(z.object({inviteToken:z.string().regex(/^[A-Za-z0-9_-]{43}$/)}).parse(q.body).inviteToken,ids(q))));
  r.post('/enrollment/verify',run(q=>{const b=z.object({challengeId:U,response:Attestation,friendlyName:z.string().max(100).optional()}).parse(q.body);
    return s.enrollmentVerify(b,ids(q))}));
  r.post('/login/options',run(q=>s.loginOptions(z.object({issuer:Issuer,interactionId:Interaction,issuerRequestId:U}).parse(q.body),ids(q))));
  r.post('/login/verify',run(q=>{const b=z.object({challengeId:U,issuer:Issuer,interactionId:Interaction,issuerRequestId:U,response:Assertion}).parse(q.body);
    return s.loginVerify(b,ids(q))}));
  // 628 binding approval (the binding request id is not secret: approving needs a passkey with the approver role)
  r.post('/approval/info',run(q=>s.approvalInfo(z.object({bindingRequestId:U}).parse(q.body).bindingRequestId)));
  r.post('/approval/options',run(q=>s.approvalOptions(z.object({bindingRequestId:U}).parse(q.body).bindingRequestId,ids(q))));
  r.post('/approval/verify',run(q=>{const b=z.object({challengeId:U,bindingRequestId:U,response:Assertion}).parse(q.body);
    return s.approvalVerify(b,ids(q))}));
  // 630 module-grant approval (one ceremony per approver for the whole set); only when the grant admission is configured
  if(grants){
    const g=new CentralGrantService(db,cfg,grants);
    r.post('/grant-approval/info',run(q=>g.info(z.object({grantRequestId:U}).parse(q.body).grantRequestId)));
    r.post('/grant-approval/options',run(q=>g.options(z.object({grantRequestId:U}).parse(q.body).grantRequestId,ids(q))));
    r.post('/grant-approval/verify',run(q=>{const b=z.object({challengeId:U,grantRequestId:U,response:Assertion}).parse(q.body);
      return g.verify(b,ids(q))}));
  }
  return r;
}
