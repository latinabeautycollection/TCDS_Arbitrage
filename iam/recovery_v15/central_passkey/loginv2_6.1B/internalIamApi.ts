import http from 'node:http';
import crypto from 'node:crypto';
import type {Pool} from 'pg';
import {createCentralVerifierClient,CentralCallError,type CentralVerifierConfig} from './centralVerifierClient';
import {startCentralEnrollment} from './centralEnrollment';

// Internal IAM verification API for EOC (Anthony decision 4). Own listener on 127.0.0.1, never under the public
// /api/v1/auth prefix. EOC calls it on every protected request and treats anything but a verified 200 with a
// matching epoch and userActive=true as signed out.
//   POST /internal/v1/iam/session-status  {"userId":"<uuid>"}
// Request auth (same scheme as 6.1B -> 6.1C verifier calls), secret = INTERNAL_IAM_API_SECRET:
//   x-tcds-workload: eoc, x-tcds-timestamp (ms, +-60 s), x-tcds-nonce (uuid, single use), x-tcds-body-sha256 (hex),
//   x-request-id (uuid), x-tcds-request-signature = base64url HMAC-SHA256(`${ts}.${nonce}.${bodySha256}.${requestId}`)
// Response auth: x-tcds-response-signature = base64url HMAC-SHA256(`${requestId}.${sha256(responseBody)}`).
//
// EOC 6.4 V1.2 IAM bridge (Anthony's authorityRouter contract, ported; enabled when EOC_IAM_SERVICE_TOKEN and/or
// EOC_IAM_ISSUER_TOKEN is set). Callers: the EOC BFF (EOC_IAM_SERVICE_TOKEN) and the OIDC issuer (EOC_IAM_ISSUER_TOKEN).
// Reached from the acquisition server only through the private mTLS proxy in front of this listener.
//   GET  /internal/v1/iam/eoc/ready
//   GET  /internal/v1/iam/eoc/subject/<uuid>
//   POST /internal/v1/iam/eoc/federation/resolve  {"issuer":"https://...","providerSubject":"..."}
// Request auth (EOC authorityClient.mjs), secret = EOC_IAM_SERVICE_TOKEN: x-eoc-workload-timestamp (unix s, +-60 s),
//   x-eoc-workload-nonce (uuid, single use across workers - admitted in the database), x-eoc-workload-signature =
//   hex HMAC-SHA256(method \n path \n timestamp \n nonce \n sha256hex(body)). Every disclosure is audited (623).
//
// Central issuer passkey ceremony (TCDS 626; enabled when centralPasskey is configured). Caller: the OIDC issuer only,
// through its OWN mTLS proxy (iam-issuer-stg, 9444), signed with ITS passkey key (issuer IAM_WORKLOAD_KEY), never the
// bridge key. Same header scheme as the bridge.
//   POST /internal/v1/iam/oidc/passkey/begin   {interactionId,requestId,issuer,purpose:'EOC_OIDC_LOGIN'} -> {challengeId,options}
//   POST /internal/v1/iam/oidc/passkey/finish  {...,challengeId,credential} -> proof checked by the issuer's assertPasskeyProof
// The WebAuthn verification is 6.1C's (central routes). Here: the IAM account must be active (622 status), the opaque
// subject is HMAC(subject key, issuer + "\n" + user id), and it must be bound to that user in 623 (written only by 624's
// two-approver writer). No binding -> no proof.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_SKEW_MS=60_000;
const MAX_BODY=4096;
const MAX_NONCES=100_000;
const BRIDGE='/internal/v1/iam/eoc/';
const PASSKEY='/internal/v1/iam/oidc/passkey/';
const MAX_PASSKEY_BODY=16384;
const REQUIRED_ACR='urn:tcds:acr:phishing-resistant:uv';

export type CentralPasskeyConfig={issuerPasskeySecret:string;allowedIssuer:string;subjectKey:string;verifier:CentralVerifierConfig;
  enrollment?:{host:string;port:number;publicOrigin:string;assetsDir:string}};
export type InternalIamApiConfig={host:string;port:number;secret:string;eocBridgeSecret?:string;eocIssuerSecret?:string;centralPasskey?:CentralPasskeyConfig};

/** The opaque OIDC subject for a user at an issuer: stable, not the IAM UUID, not reversible without the key. */
export function centralSubject(subjectKey:string,issuer:string,userId:string){
  return crypto.createHmac('sha256',subjectKey).update(`${issuer}\n${userId}`,'utf8').digest('base64url');
}

export function startInternalIamApi(pool:Pool,c:InternalIamApiConfig){
  const seen=new Map<string,number>();
  const cp=c.centralPasskey;
  if(cp&&(cp.issuerPasskeySecret.length<32||cp.subjectKey.length<32||!/^https:\/\/[a-z0-9.-]+$/.test(cp.allowedIssuer)
    ||cp.issuerPasskeySecret===c.eocIssuerSecret||cp.issuerPasskeySecret===c.eocBridgeSecret))
    throw new Error('CENTRAL_PASSKEY_CONFIG_INVALID');
  const central=cp?createCentralVerifierClient(cp.verifier):null;
  // The public enrollment page runs on its OWN loopback listener (nginx login-stg /enroll/), never on this private one.
  const enrollment=cp?.enrollment?startCentralEnrollment({...cp.enrollment,verifier:cp.verifier}):null;
  const sha=(s:string)=>crypto.createHash('sha256').update(s,'utf8').digest('hex');
  const sign=(s:string)=>crypto.createHmac('sha256',c.secret).update(s,'utf8').digest('base64url');
  const same=(a:string,b:string)=>a.length===b.length&&crypto.timingSafeEqual(Buffer.from(a),Buffer.from(b));
  const header=(req:http.IncomingMessage,n:string)=>{const v=req.headers[n];return typeof v==='string'?v:'';};

  const server=http.createServer((req,res)=>{
    const send=(status:number,body:object,requestId?:string)=>{
      if(res.headersSent)return;
      const raw=JSON.stringify(body);
      const h:Record<string,string>={'content-type':'application/json','cache-control':'no-store'};
      if(requestId)h['x-tcds-response-signature']=sign(`${requestId}.${sha(raw)}`);
      res.writeHead(status,h).end(raw);
    };
    const url=req.url??'';
    const bridge=(!!c.eocBridgeSecret||!!c.eocIssuerSecret)&&url.startsWith(BRIDGE);
    const passkey=!!central&&(url===PASSKEY+'begin'||url===PASSKEY+'finish');
    if(!bridge&&!passkey&&(req.method!=='POST'||url!=='/internal/v1/iam/session-status'))return send(404,{error:{code:'NOT_FOUND'}});
    const limit=passkey?MAX_PASSKEY_BODY:MAX_BODY;
    let raw='',size=0,tooBig=false;
    req.setEncoding('utf8');
    req.on('data',(x:string)=>{
      size+=Buffer.byteLength(x);
      if(size>limit){tooBig=true;send(413,{error:{code:'REQUEST_TOO_LARGE'}});req.destroy();}
      else raw+=x;
    });
    req.on('end',async()=>{
      if(tooBig)return;
      if(bridge)return eocBridge(req,url,raw,send);
      if(passkey)return issuerPasskey(req,url,raw,send);
      const now=Date.now(),ts=header(req,'x-tcds-timestamp'),nonce=header(req,'x-tcds-nonce'),
        requestId=header(req,'x-request-id'),hash=header(req,'x-tcds-body-sha256'),sig=header(req,'x-tcds-request-signature');
      if(header(req,'x-tcds-workload')!=='eoc'||!UUID.test(requestId)||!UUID.test(nonce)||!/^\d{13}$/.test(ts)
         ||Math.abs(now-Number(ts))>MAX_SKEW_MS||hash!==sha(raw)||!same(sig,sign(`${ts}.${nonce}.${hash}.${requestId}`)))
        return send(401,{error:{code:'REQUEST_SIGNATURE_INVALID'}});
      for(const [k,t] of seen)if(t<now-2*MAX_SKEW_MS)seen.delete(k);
      if(seen.has(nonce))return send(401,{error:{code:'REQUEST_REPLAYED'}});
      if(seen.size>=MAX_NONCES)return send(503,{error:{code:'IAM_STATUS_UNAVAILABLE'}},requestId);
      seen.set(nonce,now);
      let userId:unknown;
      try{userId=JSON.parse(raw)?.userId;}catch{userId=undefined;}
      if(typeof userId!=='string'||!UUID.test(userId))return send(400,{error:{code:'REQUEST_INVALID'}},requestId);
      try{
        const r=await pool.query('SELECT user_active,epoch FROM warehouse_identity.iam_session_epoch_status_v15($1)',[userId]);
        send(200,{contractVersion:'1.0',requestId,userId,userActive:r.rows[0]?.user_active===true,
                  epoch:Number(r.rows[0]?.epoch??0),checkedAt:new Date().toISOString()},requestId);
      }catch{
        send(503,{error:{code:'IAM_STATUS_UNAVAILABLE'}},requestId);
      }
    });
  });

  // Anthony's bridge contract: error bodies are {error:'CODE'} and responses are not signed (mTLS carries them).
  async function eocBridge(req:http.IncomingMessage,url:string,raw:string,send:(s:number,b:object)=>void){
    // Two callers, each with its OWN key (audience-scoped, per the dev team's handoff): the EOC BFF and the OIDC issuer.
    const callers:[string,string|undefined][]=[['eoc-bff',c.eocBridgeSecret],['oidc-issuer',c.eocIssuerSecret]];
    const method=req.method??'';
    const ts=header(req,'x-eoc-workload-timestamp'),nonce=header(req,'x-eoc-workload-nonce'),sig=header(req,'x-eoc-workload-signature');
    // Nonce: a UUID (EOC BFF authorityClient) or 32-128 hex chars (the issuer's iam-verifier-client sends 20 random bytes
    // as hex). Either way it is single-use: admitted by hash in the database below.
    if(!/^\d{10}$/.test(ts)||Math.abs(Date.now()/1000-Number(ts))>MAX_SKEW_MS/1000||!(UUID.test(nonce)||/^[a-f0-9]{32,128}$/.test(nonce))||!/^[a-f0-9]{64}$/.test(sig)
       ||(method==='GET'&&raw!==''))
      return send(401,{error:'UNAUTHORIZED'});
    const canonical=[method,url,ts,nonce,sha(raw)].join('\n');
    const caller=callers.find(([,k])=>!!k&&same(sig,crypto.createHmac('sha256',k as string).update(canonical,'utf8').digest('hex')))?.[0];
    if(!caller)return send(401,{error:'UNAUTHORIZED'});
    // Through the mTLS proxy, the key must belong to the workload whose certificate was verified. (Direct loopback calls
    // on this host carry no caller header; the listener is 127.0.0.1-only.)
    const viaProxy=header(req,'x-tcds-workload-caller');
    if(viaProxy&&viaProxy!==caller)return send(401,{error:'UNAUTHORIZED'});
    console.log(JSON.stringify({level:'info',msg:'eoc bridge call',caller,viaProxy:viaProxy||null,method,path:url.split('?')[0]}));
    const rid=header(req,'x-request-id'),requestId=UUID.test(rid)?rid:null;
    try{
      const a=await pool.query('SELECT warehouse_identity.eoc_bridge_admit_nonce_v623($1) AS ok',[sha(nonce)]);
      if(a.rows[0]?.ok!==true)return send(401,{error:'REPLAY_REJECTED'});
    }catch{return send(503,{error:'IAM_BRIDGE_UNAVAILABLE'});}
    const subject=url.slice(BRIDGE.length).match(/^subject\/([0-9a-f-]{36})$/i);
    try{
      if(method==='GET'&&url===BRIDGE+'ready'){
        await pool.query('SELECT warehouse_identity.eoc_bridge_ready_v623($1)',[requestId]);
        return send(200,{ready:true,epochAuthority:true,federationAuthority:true});
      }
      if(method==='GET'&&subject){
        if(!UUID.test(subject[1]))return send(400,{error:'BAD_SUBJECT'});
        const r=await pool.query('SELECT warehouse_identity.eoc_subject_snapshot_v623($1,$2) AS snapshot',[subject[1],requestId]);
        const snap=r.rows[0]?.snapshot;
        return snap?send(200,{...snap,epoch:Number(snap.epoch)}):send(404,{error:'UNKNOWN_SUBJECT'});
      }
      if(method==='POST'&&url===BRIDGE+'federation/resolve'){
        let b:{issuer?:unknown;providerSubject?:unknown}={};
        try{b=JSON.parse(raw)??{};}catch{b={};}
        const {issuer,providerSubject}=b;
        if(typeof issuer!=='string'||!issuer.startsWith('https://')||issuer.length>500
           ||typeof providerSubject!=='string'||providerSubject.length<1||providerSubject.length>255)
          return send(400,{error:'BAD_IDENTITY'});
        const r=await pool.query('SELECT warehouse_identity.eoc_resolve_federation_v623($1,$2,$3) AS user_id',[issuer,sha(providerSubject),requestId]);
        const userId=r.rows[0]?.user_id;
        return userId?send(200,{verified:true,userId}):send(403,{error:'FEDERATION_BINDING_DENIED'});
      }
      return send(404,{error:'NOT_FOUND'});
    }catch{
      return send(503,{error:'IAM_AUTHORITY_UNAVAILABLE'});
    }
  }

  // Bridge-style errors ({error:'CODE'}); the issuer treats anything but 200 as a refusal.
  async function issuerPasskey(req:http.IncomingMessage,url:string,raw:string,send:(s:number,b:object)=>void){
    const k=cp as CentralPasskeyConfig,v=central as NonNullable<typeof central>;
    const method=req.method??'',ts=header(req,'x-eoc-workload-timestamp'),nonce=header(req,'x-eoc-workload-nonce'),sig=header(req,'x-eoc-workload-signature');
    if(method!=='POST'||!/^\d{10}$/.test(ts)||Math.abs(Date.now()/1000-Number(ts))>MAX_SKEW_MS/1000||!UUID.test(nonce)||!/^[a-f0-9]{64}$/.test(sig)
       ||!/^application\/json(;|$)/i.test(header(req,'content-type')))
      return send(401,{error:'UNAUTHORIZED'});
    const expected=crypto.createHmac('sha256',k.issuerPasskeySecret).update([method,url,ts,nonce,sha(raw)].join('\n'),'utf8').digest('hex');
    if(!same(sig,expected))return send(401,{error:'UNAUTHORIZED'});
    const viaProxy=header(req,'x-tcds-workload-caller');
    if(viaProxy&&viaProxy!=='oidc-issuer')return send(401,{error:'UNAUTHORIZED'});
    try{
      const a=await pool.query('SELECT warehouse_identity.eoc_bridge_admit_nonce_v623($1) AS ok',[sha(nonce)]);
      if(a.rows[0]?.ok!==true)return send(401,{error:'REPLAY_REJECTED'});
    }catch{return send(503,{error:'IAM_PASSKEY_UNAVAILABLE'});}
    let b:any;try{b=JSON.parse(raw)}catch{b=null}
    if(!b||b.purpose!=='EOC_OIDC_LOGIN'||b.issuer!==k.allowedIssuer||typeof b.interactionId!=='string'||!/^[A-Za-z0-9_-]{8,160}$/.test(b.interactionId)
       ||typeof b.requestId!=='string'||!UUID.test(b.requestId))
      return send(400,{error:'OIDC_PASSKEY_REQUEST_INVALID'});
    const ids={requestId:crypto.randomUUID(),correlationId:b.requestId};
    console.log(JSON.stringify({level:'info',msg:'issuer passkey call',op:url.slice(PASSKEY.length),viaProxy:viaProxy||null}));
    try{
      if(url===PASSKEY+'begin'){
        const o=await v.loginOptions({issuer:b.issuer,interactionId:b.interactionId,issuerRequestId:b.requestId},ids);
        if(typeof o?.challengeId!=='string'||!UUID.test(o.challengeId)||o.options?.userVerification!=='required'||o.options?.rpId!==k.verifier.rpId
           ||typeof o.options?.challenge!=='string')
          return send(502,{error:'CENTRAL_OPTIONS_INVALID'});
        return send(200,{challengeId:o.challengeId,options:o.options});
      }
      if(typeof b.challengeId!=='string'||!UUID.test(b.challengeId)||!b.credential||typeof b.credential!=='object')
        return send(400,{error:'WEBAUTHN_ASSERTION_MISSING'});
      const r=await v.loginVerify({challengeId:b.challengeId,issuer:b.issuer,interactionId:b.interactionId,issuerRequestId:b.requestId,response:b.credential},ids);
      const status=await pool.query('SELECT user_active FROM warehouse_identity.iam_session_epoch_status_v15($1)',[r.userId]);
      if(status.rows[0]?.user_active!==true)return send(403,{error:'IAM_ACCOUNT_INACTIVE'});
      const subject=centralSubject(k.subjectKey,b.issuer,r.userId);
      const bound=await pool.query('SELECT warehouse_identity.eoc_resolve_federation_v623($1,$2,$3) AS user_id',[b.issuer,sha(subject),b.requestId]);
      if(bound.rows[0]?.user_id!==r.userId)return send(403,{error:'FEDERATED_SUBJECT_BINDING_DENIED'});
      const now=Math.floor(Date.now()/1000);
      if(Math.abs(now-r.authTime)>120)return send(403,{error:'CENTRAL_WEBAUTHN_AUTH_TIME_UNVERIFIED'});
      return send(200,{verifier:'TCDS_CENTRAL_IAM_WEBAUTHN',action:'EOC_OIDC_LOGIN',interactionId:b.interactionId,issuer:b.issuer,
        requestId:b.requestId,challengeId:b.challengeId,subject,iamUserId:r.userId,evidenceId:r.evidenceId,userVerified:true,rpVerified:true,
        originVerified:true,counterOrBackupPolicyPassed:true,credentialActive:true,accountActive:true,bindingVerified:true,acr:REQUIRED_ACR,
        amr:['webauthn','user_verification'],authTime:r.authTime,expiresAt:now+45});
    }catch(e){
      if(e instanceof CentralCallError)return send(e.status===403?403:503,{error:e.code});
      return send(503,{error:'IAM_PASSKEY_UNAVAILABLE'});
    }
  }

  server.on('error',e=>console.error(JSON.stringify({level:'error',msg:'internal iam api error',error:e.message})));
  server.listen(c.port,c.host,()=>console.log(JSON.stringify({level:'info',msg:'internal iam api listening',port:c.port,eocBridge:!!c.eocBridgeSecret,oidcIssuer:!!c.eocIssuerSecret,centralPasskey:!!central})));
  return {close:async()=>{await enrollment?.close();await new Promise<void>(resolve=>server.close(()=>resolve()))}};
}
