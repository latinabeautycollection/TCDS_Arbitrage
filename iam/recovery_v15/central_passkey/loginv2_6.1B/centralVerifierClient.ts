import http from 'node:http';
import crypto from 'node:crypto';

// Client for the 6.1C central passkey routes (TCDS 626): /internal/v1/central/{enrollment,login}/{options,verify}.
// Request signing = the vendor verifier scheme, scope 'central', secret CENTRAL_WORKLOAD_SECRET. A verify result is
// accepted only if its Ed25519 signature checks with the verifier's result key (hostVerifierClient.resultPublicKeyPem)
// and it is a central-1.0 result for the expected ceremony, RP, challenge and request, not yet expired.
export type CentralVerifierConfig={baseUrl:string;workloadSecret:string;resultPublicKeyPem:string;rpId:string};
export class CentralCallError extends Error{constructor(readonly code:string,readonly status:number){super(code)}}

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createCentralVerifierClient(c:CentralVerifierConfig){
  const base=new URL(c.baseUrl);
  if(base.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(base.hostname))throw new Error('CENTRAL_VERIFIER_MUST_BE_LOOPBACK');
  const key=crypto.createPublicKey(c.resultPublicKeyPem);

  function call(path:string,body:unknown,ids:{requestId:string;correlationId:string}):Promise<any>{
    const raw=JSON.stringify(body),hash=crypto.createHash('sha256').update(raw).digest('hex');
    const ts=String(Date.now()),nonce=crypto.randomUUID();
    const sig=crypto.createHmac('sha256',c.workloadSecret).update(`${ts}.${nonce}.${hash}.${ids.requestId}`).digest('base64url');
    return new Promise((resolve,reject)=>{
      const req=http.request(new URL('/internal/v1/central'+path,base),{method:'POST',timeout:8000,headers:{'content-type':'application/json',
        'content-length':String(Buffer.byteLength(raw)),'x-tcds-workload':'central','x-tcds-timestamp':ts,'x-tcds-nonce':nonce,
        'x-request-id':ids.requestId,'x-correlation-id':ids.correlationId,'x-tcds-body-sha256':hash,'x-tcds-request-signature':sig}},res=>{
        let out='',n=0;res.setEncoding('utf8');
        res.on('data',(x:string)=>{n+=x.length;if(n>65536){req.destroy(new Error('CENTRAL_RESPONSE_TOO_LARGE'));return}out+=x});
        res.on('end',()=>{let j:any;try{j=JSON.parse(out)}catch{return reject(new CentralCallError('CENTRAL_VERIFIER_INVALID_RESPONSE',502))}
          if(res.statusCode===200)return resolve(j);
          const code=typeof j?.error?.code==='string'&&/^[A-Z0-9_]{3,80}$/.test(j.error.code)?j.error.code:'CENTRAL_VERIFIER_REFUSED';
          reject(new CentralCallError(code,res.statusCode&&res.statusCode<500?403:503))});
      });
      req.on('timeout',()=>req.destroy(new Error('CENTRAL_VERIFIER_TIMEOUT')));
      req.on('error',e=>reject(e instanceof CentralCallError?e:new CentralCallError('CENTRAL_VERIFIER_UNAVAILABLE',503)));
      req.end(raw);
    });
  }

  function accept(r:any,expect:{ceremony:string;challengeId:string;requestId:string}){
    if(!r||typeof r.signature!=='string')throw new CentralCallError('CENTRAL_RESULT_UNSIGNED',502);
    const {signature,...unsigned}=r;
    const ok=crypto.verify(null,Buffer.from(JSON.stringify(unsigned,Object.keys(unsigned).sort())),key,Buffer.from(signature,'base64url'));
    if(!ok)throw new CentralCallError('CENTRAL_RESULT_SIGNATURE_INVALID',502);
    if(unsigned.contractVersion!=='central-1.0'||unsigned.verified!==true||unsigned.outcome!=='SUCCEEDED'||unsigned.ceremony!==expect.ceremony
      ||unsigned.rpId!==c.rpId||unsigned.challengeId!==expect.challengeId||unsigned.requestId!==expect.requestId||!UUID.test(String(unsigned.userId))
      ||!UUID.test(String(unsigned.evidenceId))||!(Date.parse(unsigned.expiresAt)>Date.now()))
      throw new CentralCallError('CENTRAL_RESULT_NOT_ACCEPTED',502);
    return unsigned;
  }

  type Ids={requestId:string;correlationId:string};
  return {
    approvalInfo:(bindingRequestId:string,ids:Ids)=>call('/approval/info',{bindingRequestId},ids),
    approvalOptions:(bindingRequestId:string,ids:Ids)=>call('/approval/options',{bindingRequestId},ids),
    approvalVerify:async(b:{challengeId:string;bindingRequestId:string;response:unknown},ids:Ids)=>{
      const r=accept(await call('/approval/verify',b,ids),{ceremony:'EOC_BINDING_APPROVAL',challengeId:b.challengeId,requestId:ids.requestId});
      if(r.bindingRequestId!==b.bindingRequestId||typeof r.bound!=='boolean'||!Number.isInteger(r.approvals))
        throw new CentralCallError('CENTRAL_RESULT_BINDING_MISMATCH',502);
      return r;
    },
    // 630 module-grant approval
    grantInfo:(grantRequestId:string,ids:Ids)=>call('/grant-approval/info',{grantRequestId},ids),
    grantOptions:(grantRequestId:string,ids:Ids)=>call('/grant-approval/options',{grantRequestId},ids),
    grantVerify:async(b:{challengeId:string;grantRequestId:string;response:unknown},ids:Ids)=>{
      const r=accept(await call('/grant-approval/verify',b,ids),{ceremony:'EOC_GRANT_APPROVAL',challengeId:b.challengeId,requestId:ids.requestId});
      if(r.grantRequestId!==b.grantRequestId||typeof r.granted!=='boolean'||!Number.isInteger(r.approvals)||!Number.isInteger(r.grants))
        throw new CentralCallError('CENTRAL_RESULT_BINDING_MISMATCH',502);
      return r;
    },
    enrollmentOptions:(inviteToken:string,ids:{requestId:string;correlationId:string})=>call('/enrollment/options',{inviteToken},ids),
    enrollmentVerify:async(b:{challengeId:string;response:unknown;friendlyName?:string},ids:{requestId:string;correlationId:string})=>
      accept(await call('/enrollment/verify',b,ids),{ceremony:'CENTRAL_PASSKEY_ENROLLMENT',challengeId:b.challengeId,requestId:ids.requestId}),
    loginOptions:(b:{issuer:string;interactionId:string;issuerRequestId:string},ids:{requestId:string;correlationId:string})=>call('/login/options',b,ids),
    loginVerify:async(b:{challengeId:string;issuer:string;interactionId:string;issuerRequestId:string;response:unknown},ids:{requestId:string;correlationId:string})=>{
      const r=accept(await call('/login/verify',b,ids),{ceremony:'EOC_OIDC_LOGIN',challengeId:b.challengeId,requestId:ids.requestId});
      if(r.issuer!==b.issuer||r.interactionId!==b.interactionId||r.issuerRequestId!==b.issuerRequestId||r.userVerified!==true||!Number.isInteger(r.authTime))
        throw new CentralCallError('CENTRAL_RESULT_BINDING_MISMATCH',502);
      return r;
    },
  };
}
