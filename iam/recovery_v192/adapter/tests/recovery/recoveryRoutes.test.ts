import {describe,it,expect,beforeEach,afterEach} from 'vitest';
import express from 'express';
import crypto from 'node:crypto';
import path from 'node:path';
import type {AddressInfo} from 'node:net';
import {recoveryRouter} from '../../src/express/recovery/recoveryRoutes';
import {RecoveryStore} from '../../src/express/recovery/recoveryStore';
import {deriveRecoveryKeys} from '../../src/express/recovery/recoveryConfig';
import {hmac,otpDigest} from '../../src/express/recovery/recoveryCrypto';
import {IdentityError} from '../../src/errors/errors';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const soft=require('../../harness/softPasskey.cjs');

const SESSION_HASH_KEY='s'.repeat(64),ORIGIN='https://warehouse-app.example.test',RP='warehouse-app.example.test';
const keys=deriveRecoveryKeys('ab'.repeat(32));
const REQ='11111111-1111-4111-8111-111111111111',SESS='22222222-2222-4222-8222-222222222222',DEV='33333333-3333-4333-8333-333333333333',
  FAC='44444444-4444-4444-8444-444444444444',CH='55555555-5555-4555-8555-555555555555',PASSKEY='66666666-6666-4666-8666-666666666666';
const REF='R'.repeat(43),CODE='12345678',SALT=crypto.randomBytes(16);
const H=(v:string)=>crypto.createHmac('sha256',SESSION_HASH_KEY).update(v).digest();

class FakeRedis{m=new Map<string,string>();
  async set(k:string,v:string,_ex:'EX',_s:number,nx?:'NX'){if(nx&&this.m.has(k))return null;this.m.set(k,v);return 'OK' as const;}
  async get(k:string){return this.m.get(k)??null;} async del(...k:string[]){k.forEach(x=>this.m.delete(x));return k.length;}
  async eval(_s:string,_n:number,key:string,req:string,value:string){const v=this.m.get(key);if(!v)return 0;const x=JSON.parse(v);
    if(x.r!==req||x.s!=='R')return 0;this.m.set(key,value);return 1;}}

function world(){
  const pk=soft.create();
  const w:any={calls:[] as string[],pk,assurance:'AAL2',approveOutcome:'APPROVED',bound:new Map<string,string>(),consumeError:null as any,
    attempts:0,claims:0,consumes:0,stepChallenge:null as string|null,counter:0,finished:0,
    otp:{challenge_id:CH,otp_hash:otpDigest(CODE,SALT,keys.otp),otp_salt:SALT}};
  const q=async(sql:string,p:any[]=[])=>{
    const f=(sql.match(/warehouse_identity\.(\w+)/)||[])[1]??sql.trim().split(' ')[0];w.calls.push(f);
    switch(f){
      case 'BEGIN':case 'COMMIT':case 'ROLLBACK':return {rows:[]};
      case 'recovery_intake_v192':return {rows:[{outcome:p[0]==='known_user'?'ACCEPTED':'NO_ACCOUNT'}]};
      case 'recovery_invitation_resolve_v192':return {rows:[{id:Buffer.compare(p[0],hmac(keys.ref,'invitation',REF))===0?REQ:null}]};
      case 'recovery_bound_proof_v192':return {rows:[{p:w.bound.get(p[1].toString('hex'))??null}]};
      case 'recovery_otp_load_v192':return {rows:[w.otp]};
      case 'recovery_otp_settle_v192':{w.attempts++;if(!p[2])return {rows:[{p:null}]};const proof=crypto.randomUUID();w.bound.set(p[3].toString('hex'),proof);return {rows:[{p:proof}]};}
      case 'recovery_invitation_revoke_v192':return {rows:[{n:1}]};
      case 'runtime_session_envelope_by_token_v1':return {rows:Buffer.compare(p[0],H('admin-token'))===0?[{auth_session_id:SESS,user_id:'u',device_id:DEV,facility_id:FAC,assurance_level:w.assurance}]:[]};
      case 'recovery_queue_v192':return {rows:[{request_id:REQ,user_id:'t',row_version:'7',status:'REQUESTED',facility_id:FAC,employee_display_id:'STG-9001',reason_code:'FORGOT_PASSWORD',reason:'',requested_at:new Date('2026-11-22T10:00:00Z')}]};
      case 'recovery_stepup_options_v192':return {rows:[{actor_user_id:'u',target_user_id:'t',row_version:'7',credential_ids:[pk.credentialId]}]};
      case 'recovery_stepup_begin_v192':w.stepChallenge=p[6];return {rows:[{id:CH}]};
      case 'recovery_stepup_load_v192':return {rows:[{challenge_text:w.stepChallenge,expected_origin:ORIGIN,expected_rp_id:RP,passkey_id:PASSKEY,public_key:pk.cosePublicKey,sign_count:w.counter}]};
      case 'recovery_stepup_finish_v192':w.finished++;w.counter=p[4];return {rows:[{x:'e'}]};
      case 'recovery_contact_eligible_v192':return {rows:[{ok:true}]};
      case 'recovery_issuance_intent_v192':return {rows:[{x:'RECORDED'}]};
      case 'approve_password_reset_v3':return {rows:[{outcome:w.approveOutcome}]};
      default:throw new Error('unexpected SQL '+f);
    }};
  w.pool={query:q,connect:async()=>({query:q,release(){}})};
  w.resets={claim:async()=>{w.claims++;return {claimToken:'c'.repeat(43),browserBinding:'b'.repeat(43),result:'CLAIMED'};},
    consume:async(_r:string,_c:string,_b:string,_p:string,_i:any,proof:string)=>{w.consumes++;if(w.consumeError){const e=w.consumeError;w.consumeError=null;throw e;}w.lastProof=proof;return 'CONSUMED';}};
  return w;
}

let w:any,store:RecoveryStore,redis:FakeRedis,server:any,base:string;
beforeEach(async()=>{
  w=world();redis=new FakeRedis();store=new RecoveryStore(redis as any,keys.cookie,keys.token);
  const app=express();app.use(express.json());
  app.use((req,_res,next)=>{(req as any).requestId=crypto.randomUUID();(req as any).correlationId=crypto.randomUUID();next();});
  app.use('/r',recoveryRouter({pool:w.pool,env:{SESSION_HASH_KEY,PUBLIC_APP_ORIGIN:ORIGIN,PASSKEY_RP_ID:RP} as any,
    limits:{check:async()=>{},success:async()=>{},failure:async()=>{}} as any,resets:w.resets as any,
    cfg:{RECOVERY_DEPS_DIR:path.resolve(__dirname,'../..')} as any,keys,store}));
  server=app.listen(0);base=`http://127.0.0.1:${(server.address() as AddressInfo).port}/r`;
});
afterEach(()=>server.close());

const post=(p:string,body:unknown,cookie?:string)=>fetch(base+p,{method:'POST',headers:{'content-type':'application/json',...(cookie?{cookie}:{})},body:JSON.stringify(body)});
const get=(p:string,cookie?:string)=>fetch(base+p,{headers:cookie?{cookie}:{}});
async function bind(){const r=await post('/binding',{reference:REF});expect(r.status).toBe(204);
  const sc=r.headers.get('set-cookie')!;return {sc,cookie:sc.split(';')[0]};}

describe('public recovery steps',()=>{
  it('request answers 202 with the same message for known and unknown accounts',async()=>{
    const a=await post('/request',{identifier:'known_user',reason:'FORGOT_PASSWORD'}),b=await post('/request',{identifier:'nobody',reason:'FORGOT_PASSWORD'});
    expect([a.status,b.status]).toEqual([202,202]);expect(await a.json()).toEqual(await b.json());
  });
  it('invitation context hides the request id and 404s an unknown reference',async()=>{
    const ok=await get('/invitation/context?ref='+REF);expect(ok.status).toBe(200);expect(await ok.json()).toEqual({publicReference:REF});
    expect((await get('/invitation/context?ref='+'X'.repeat(43))).status).toBe(404);
    expect((await get('/invitation/context?ref=short')).status).toBe(404);
  });
  it('binding sets an HttpOnly, Secure, SameSite=Strict __Host- cookie',async()=>{
    const {sc}=await bind();expect(sc).toMatch(/^__Host-tcds_recovery=[A-Za-z0-9_-]{43};/);
    expect(sc).toMatch(/HttpOnly/);expect(sc).toMatch(/Secure/);expect(sc).toMatch(/SameSite=Strict/);expect(sc).toMatch(/Path=\//);
  });
  it('complete without the cookie is refused',async()=>{
    expect((await post('/complete',{reference:REF,newPassword:'x',code:CODE})).status).toBe(401);
  });
  it('wrong code: 403, attempt recorded, nothing claimed',async()=>{
    const {cookie}=await bind();await store.putToken(REQ,'tok',600);
    const r=await post('/complete',{reference:REF,newPassword:'N3w-Passw0rd-Long!',code:'00000000'},cookie);
    expect(r.status).toBe(403);expect((await r.json()).error.code).toBe('OTP_INVALID');expect(w.attempts).toBe(1);expect(w.claims).toBe(0);
  });
  it('right code + password in one submit: claims with the stored token, consumes with the proof, cleans up',async()=>{
    const {cookie}=await bind();await store.putToken(REQ,'tok',600);
    const r=await post('/complete',{reference:REF,newPassword:'N3w-Passw0rd-Long!',code:CODE},cookie);
    expect(r.status).toBe(200);expect(await r.json()).toEqual({completed:true});
    expect(w.claims).toBe(1);expect(w.consumes).toBe(1);expect(w.lastProof).toMatch(/^[0-9a-f-]{36}$/);
    expect(await store.getToken(REQ)).toBeNull();expect(await store.state(cookie.split('=')[1])).toBeNull();
    expect(r.headers.get('set-cookie')).toMatch(/__Host-tcds_recovery=;/);expect(w.calls).toContain('recovery_invitation_revoke_v192');
  });
  it('a refused password keeps the claim so the user can pick another password without a new code',async()=>{
    const {cookie}=await bind();await store.putToken(REQ,'tok',600);
    w.consumeError=new IdentityError('PASSWORD_BREACHED',400);
    const a=await post('/complete',{reference:REF,newPassword:'password123',code:CODE},cookie);
    expect(a.status).toBe(400);expect((await a.json()).error.code).toBe('PASSWORD_BREACHED');
    const b=await post('/complete',{reference:REF,newPassword:'N3w-Passw0rd-Long!'},cookie);
    expect(b.status).toBe(200);expect(w.claims).toBe(1);expect(w.consumes).toBe(2);
  });
  it('separate /claim then /complete also works (vendor two-step contract)',async()=>{
    const {cookie}=await bind();await store.putToken(REQ,'tok',600);
    expect((await post('/claim',{reference:REF,code:CODE},cookie)).status).toBe(204);
    expect((await post('/complete',{reference:REF,newPassword:'N3w-Passw0rd-Long!'},cookie)).status).toBe(200);
    expect(w.claims).toBe(1);
  });
  it('approved reset whose token is gone cannot be claimed',async()=>{
    const {cookie}=await bind();
    const r=await post('/complete',{reference:REF,newPassword:'N3w-Passw0rd-Long!',code:CODE},cookie);
    expect(r.status).toBe(409);expect((await r.json()).error.code).toBe('RESET_TOKEN_UNAVAILABLE');
  });
});

describe('administrator approval',()=>{
  const admin='__Host-tcds_session=admin-token';
  it('requires a session',async()=>{expect((await get('/admin/pending')).status).toBe(401);});
  it('queue items carry expectedRowVersion as a string; a tampered cursor is refused',async()=>{
    const r=await get('/admin/pending?limit=10',admin);expect(r.status).toBe(200);const j=await r.json();
    expect(j.items[0]).toMatchObject({requestId:REQ,expectedRowVersion:'7',employeeDisplayId:'STG-9001'});expect(j.items[0].userId).toBeUndefined();
    expect((await get('/admin/pending?cursor=abc.def',admin)).status).toBe(400);
  });
  it('refuses non-approval decisions, missing step-up and AAL1 sessions',async()=>{
    const body={requestId:REQ,expectedRowVersion:'7',decision:'REJECT'};
    expect((await post('/admin/approve',body,admin)).status).toBe(422);
    const r=await post('/admin/approve',{...body,decision:'APPROVE_RESET'},admin);expect(r.status).toBe(403);expect((await r.json()).error.code).toBe('FRESH_STEP_UP_REQUIRED');
    w.assurance='AAL1';const a=await post('/admin/approve',{...body,decision:'APPROVE_RESET',challengeId:CH,passkeyResponse:{id:'x'}},admin);
    expect((await a.json()).error.code).toBe('AAL2_REQUIRED');
  });
  async function stepUp(){
    const r=await post(`/admin/step-up/${REQ}`,{},admin);expect(r.status).toBe(200);const o=await r.json();
    expect(o).toMatchObject({challengeId:CH,purpose:'WAREHOUSE_PASSWORD_RESET_APPROVAL',requestId:REQ,rowVersion:'7'});
    expect(o.options.allowCredentials[0].id).toBe(w.pk.credentialId);expect(o.options.userVerification).toBe('required');
    return o;
  }
  it('passkey step-up + approve: verifies the assertion, records intent, stores the token, approves',async()=>{
    const o=await stepUp();
    const resp=soft.assert(w.pk,{rpId:RP,origin:ORIGIN,challenge:o.options.challenge,counter:3});
    const r=await post('/admin/approve',{requestId:REQ,expectedRowVersion:'7',decision:'APPROVE_RESET',challengeId:CH,passkeyResponse:resp},admin);
    expect(r.status).toBe(200);expect(await r.json()).toEqual({status:'TOKEN_ISSUED',deliveryStatus:'PENDING'});
    expect(w.finished).toBe(1);expect(w.counter).toBe(3);
    const order=w.calls.filter((c:string)=>/issuance_intent|approve_password_reset_v3/.test(c));expect(order).toEqual(['recovery_issuance_intent_v192','approve_password_reset_v3']);
    expect(await store.getToken(REQ)).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
  it('an assertion for another origin is refused and nothing is approved',async()=>{
    const o=await stepUp();
    const resp=soft.assert(w.pk,{rpId:RP,origin:'https://evil.example',challenge:o.options.challenge});
    const r=await post('/admin/approve',{requestId:REQ,expectedRowVersion:'7',decision:'APPROVE_RESET',challengeId:CH,passkeyResponse:resp},admin);
    expect(r.status).toBe(403);expect((await r.json()).error.code).toBe('STEPUP_SIGNATURE_INVALID');
    expect(w.finished).toBe(0);expect(w.calls).not.toContain('approve_password_reset_v3');
  });
  it('a refused approval drops the stored token',async()=>{
    w.approveOutcome='STALE_OR_INVALID_STATE';const o=await stepUp();
    const resp=soft.assert(w.pk,{rpId:RP,origin:ORIGIN,challenge:o.options.challenge});
    const r=await post('/admin/approve',{requestId:REQ,expectedRowVersion:'7',decision:'APPROVE_RESET',challengeId:CH,passkeyResponse:resp},admin);
    expect(r.status).toBe(409);expect((await r.json()).error.code).toBe('STALE_OR_INVALID_STATE');expect(await store.getToken(REQ)).toBeNull();
  });
  it('manager override is reported as not available yet',async()=>{expect((await post('/manager/override',{},admin)).status).toBe(501);});
});
