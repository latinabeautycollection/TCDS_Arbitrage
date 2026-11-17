
import crypto from 'node:crypto';
import type {Request,RequestHandler} from 'express';
import type {Pool} from 'pg';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MUTATION=new Set(['POST','PUT','PATCH','DELETE']);

export const requestIds:RequestHandler=(req,_res,next)=>{
  const valid=(x:unknown):x is string=>typeof x==='string'&&UUID.test(x);
  (req as any).requestId=valid(req.get('x-request-id'))?req.get('x-request-id'):crypto.randomUUID();
  (req as any).correlationId=valid(req.get('x-correlation-id'))?req.get('x-correlation-id'):crypto.randomUUID();
  next();
};

export const exactOrigin=(origin:string):RequestHandler=>(req,res,next)=>{
  if(MUTATION.has(req.method)&&req.get('origin')!==origin)
    return res.status(403).json({error:{code:'REQUEST_REJECTED'}});
  next();
};

export const fetchMetadataGuard:RequestHandler=(req,res,next)=>{
  if(MUTATION.has(req.method)){
    const site=req.get('sec-fetch-site');
    if(site&&site!=='same-origin'&&site!=='same-site')
      return res.status(403).json({error:{code:'REQUEST_REJECTED'}});
  }
  next();
};

export const noStore:RequestHandler=(_req,res,next)=>{
  res.setHeader('Cache-Control','no-store');
  res.setHeader('Pragma','no-cache');
  next();
};

export const securityHeaders:RequestHandler=(_req,res,next)=>{
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('Permissions-Policy','camera=(self), publickey-credentials-get=(self), publickey-credentials-create=(self)');
  res.setHeader('Content-Security-Policy',"default-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'");
  res.setHeader('Strict-Transport-Security','max-age=31536000; includeSubDomains');
  next();
};

export function cookie(req:Request,name:string){
  return req.headers.cookie?.split(';').map(x=>x.trim()).find(x=>x.startsWith(name+'='))?.slice(name.length+1);
}

export const requireCsrf=(pool:Pool,sessionHashKey:string,csrfHashKey:string):RequestHandler=>async(req,res,next)=>{
  if(!MUTATION.has(req.method))return next()
 if(/^\/(login|password\/login|device-proof\/(options|verify)|passkeys\/(availability|authentication\/(options|verify))|password-reset\/(claim|consume))$/.test(req.path))return next();
  const session=cookie(req,'__Host-tcds_session');
  if(!session)return next();

  const c=cookie(req,'__Host-tcds_csrf'),h=req.get('x-csrf-token');
  if(!c||!h||c!==h)return res.status(403).json({error:{code:'CSRF_REJECTED'}});

  const sessionDigest=crypto.createHmac('sha256',sessionHashKey).update(session).digest();
  const csrfDigest=crypto.createHmac('sha256',csrfHashKey).update(h).digest();

  try{
    const q=await pool.query('SELECT warehouse_identity.validate_session_csrf_v2($1,$2) valid',[sessionDigest,csrfDigest]);
    if(q.rows[0]?.valid!==true)return res.status(403).json({error:{code:'CSRF_REJECTED'}});
    return next();
  }catch{
    return res.status(503).json({error:{code:'AUTH_SECURITY_DEPENDENCY_UNAVAILABLE'}});
  }
};
