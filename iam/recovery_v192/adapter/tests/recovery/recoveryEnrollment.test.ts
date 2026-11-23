import {describe,it,expect,beforeEach,afterEach} from 'vitest';
import express from 'express';
import crypto from 'node:crypto';
import type {AddressInfo} from 'node:net';
import {recoveryEnrollmentRouter,maskEmail} from '../../src/express/recovery/recoveryEnrollmentRoutes';
import {deriveRecoveryKeys} from '../../src/express/recovery/recoveryConfig';
import {hmac,otpDigest,seal,unseal} from '../../src/express/recovery/recoveryCrypto';
import {RecoveryWorkers} from '../../src/express/recovery/recoveryWorkers';
import {compose} from '../../src/express/recovery/recoveryDelivery';

const SESSION_HASH_KEY='s'.repeat(64),keys=deriveRecoveryKeys('ef'.repeat(32));
const SESS='22222222-2222-4222-8222-222222222222',ENR='33333333-3333-4333-8333-333333333333',CH='44444444-4444-4444-8444-444444444444';
const H=(v:string)=>crypto.createHmac('sha256',SESSION_HASH_KEY).update(v).digest();
const pgErr=(code:string,msg:string)=>Object.assign(new Error(msg),{code});

function world(){
  const w:any={calls:[] as string[],started:null,settleMatch:null as boolean|null,status:'NONE',active:null as any,sent:[] as any[],startError:null,otp:null};
  const q=async(sql:string,p:any[]=[])=>{
    const f=(sql.match(/warehouse_identity\.(\w+)/)||[])[1]??sql.trim().split(' ')[0];w.calls.push(f);
    switch(f){
      case 'BEGIN':case 'COMMIT':case 'ROLLBACK':return {rows:[]};
      case 'runtime_session_envelope_by_token_v1':return {rows:Buffer.compare(p[0],H('emp-token'))===0?[{auth_session_id:SESS,user_id:'u1'}]:[]};
      case 'recovery_contact_overview_v645':{
        const rows:any[]=[];
        if(w.active)rows.push({kind:'ACTIVE',since:new Date('2026-11-20T10:00:00Z'),ciphertext:w.active.ciphertext,iv:w.active.iv,tag:w.active.tag});
        if(w.status!=='NONE')rows.push({kind:'PENDING',contact_hint:w.hint,status:w.status,since:new Date('2026-11-23T08:00:00Z'),expires_at:new Date('2026-11-30T08:00:00Z'),approvals:0,required:1});
        return {rows};}
      case 'recovery_contact_start_v645':{if(w.startError)throw w.startError;w.started=p;w.status='AWAITING_CODE';w.hint=p[5];
        w.otp={hash:p[6],salt:p[7]};return {rows:[{enrollment_id:ENR,delivery_id:'d'}]};}
      case 'recovery_contact_code_load_v645':return {rows:[{enrollment_id:ENR,challenge_id:CH,otp_hash:w.otp.hash,otp_salt:w.otp.salt}]};
      case 'recovery_contact_code_settle_v645':w.settleMatch=p[2];if(p[2])w.status='AWAITING_APPROVAL';return {rows:[{r:p[2]?'AWAITING_APPROVAL':'INVALID'}]};
      case 'recovery_contact_pending_id_v645':return {rows:[{id:w.status==='AWAITING_APPROVAL'?ENR:null}]};
      case 'recovery_contact_cancel_v645':w.status='NONE';return {rows:[{ok:true}]};
      default:throw new Error('unexpected SQL '+f);
    }};
  w.pool={query:q,connect:async()=>({query:q,release(){}})};
  w.transport={name:'test',sendEmail:async(m:any)=>{w.sent.push(m);return 'ACCEPTED';}};
  return w;
}
let w:any,server:any,base:string;
function start(cfgExtra:Record<string,unknown>={}){
  const app=express();app.use(express.json());
  app.use((req,_res,next)=>{(req as any).requestId=crypto.randomUUID();(req as any).correlationId=crypto.randomUUID();next();});
  app.use('/r',recoveryEnrollmentRouter({pool:w.pool,env:{SESSION_HASH_KEY} as any,limits:{check:async()=>{},success:async()=>{},failure:async()=>{}} as any,
    cfg:{RECOVERY_APPROVER_EMAILS:'anthony@example.test',RECOVERY_APPROVAL_LINK_BASE:'https://login-stg.example.test/approve/recovery/',...cfgExtra} as any,
    keys,transport:w.transport}));
  server=app.listen(0);base=`http://127.0.0.1:${(server.address() as AddressInfo).port}/r`;
}
beforeEach(()=>{w=world();start();});
afterEach(()=>server.close());
const emp={cookie:'__Host-tcds_session=emp-token'};
const post=(p:string,body:unknown,h:Record<string,string>=emp)=>fetch(base+p,{method:'POST',headers:{'content-type':'application/json',...h},body:JSON.stringify(body)});

describe('recovery-email enrollment routes',()=>{
  it('needs a signed-in session',async()=>{
    expect((await fetch(base+'/')).status).toBe(401);
    expect((await post('/',{email:'a@b.co'},{cookie:'__Host-tcds_session=someone-else'})).status).toBe(401);
  });
  it('overview: decrypts the active email only to mask it; pending shows the stored hint',async()=>{
    w.active=seal('remi@gmail.com',keys.contact);w.status='AWAITING_APPROVAL';w.hint='s•••@example.test';
    const j=await (await fetch(base+'/',{headers:emp})).json();
    expect(j.active).toEqual({email:'r•••@gmail.com',since:'2026-11-20T10:00:00.000Z'});
    expect(j.pending).toMatchObject({email:'s•••@example.test',status:'AWAITING_APPROVAL',approvals:0,required:1});
  });
  it('start: refuses a malformed address; stores ciphertext + keyed fingerprint + masked hint; queues an encrypted code',async()=>{
    expect((await post('/',{email:'not-an-email'})).status).toBe(400);
    const r=await post('/',{email:'  Remi.Ader@Gmail.com '});
    expect(r.status).toBe(202);expect((await r.json()).pending.status).toBe('AWAITING_CODE');
    const [session,ct,iv,tag,fp,hint,otpHash,salt,pl,piv,ptag]=w.started;
    expect(session).toBe(SESS);
    expect(unseal({ciphertext:ct,iv,tag},keys.contact).toString()).toBe('remi.ader@gmail.com');
    expect(Buffer.compare(fp,hmac(keys.contactFp,'contact','remi.ader@gmail.com'))).toBe(0);
    expect(hint).toBe('r•••@gmail.com');
    const payload=JSON.parse(unseal({ciphertext:pl,iv:piv,tag:ptag},keys.outbox).toString());
    expect(payload.kind).toBe('CONTACT_CODE');expect(Buffer.compare(otpDigest(payload.code,salt,keys.otp),otpHash)).toBe(0);
    expect(w.sent).toHaveLength(0);                       // the code goes out through the delivery worker, not inline
  });
  it('maps database refusals: too many attempts -> 429, already active -> 409',async()=>{
    w.startError=pgErr('54000','RECOVERY_CONTACT_TOO_MANY_ATTEMPTS');
    let r=await post('/',{email:'a@example.test'});expect(r.status).toBe(429);expect((await r.json()).error.code).toBe('RECOVERY_CONTACT_TOO_MANY_ATTEMPTS');
    w.startError=pgErr('23505','RECOVERY_CONTACT_ALREADY_ACTIVE');
    r=await post('/',{email:'a@example.test'});expect(r.status).toBe(409);
  });
  async function startAndCode(){await post('/',{email:'remi@gmail.com'});
    return JSON.parse(unseal({ciphertext:w.started[8],iv:w.started[9],tag:w.started[10]},keys.outbox).toString()).code as string;}
  it('verify: wrong code -> 403, nobody notified; right code -> waiting for approval and the approver gets the link',async()=>{
    const code=await startAndCode();
    expect((await post('/verify',{code:'123'})).status).toBe(400);
    let r=await post('/verify',{code:code==='00000000'?'11111111':'00000000'});
    expect(r.status).toBe(403);expect((await r.json()).error.code).toBe('RECOVERY_CODE_INVALID');expect(w.sent).toHaveLength(0);
    r=await post('/verify',{code:code.slice(0,4)+' '+code.slice(4)});
    expect(r.status).toBe(200);expect((await r.json()).pending.status).toBe('AWAITING_APPROVAL');
    expect(w.sent).toEqual([{kind:'APPROVAL_NEEDED',to:'anthony@example.test',link:`https://login-stg.example.test/approve/recovery/?e=${ENR}`,hint:'r•••@gmail.com'}]);
  });
  it('without approver settings the enrollment still waits for approval (no email sent)',async()=>{
    server.close();w=world();start({RECOVERY_APPROVER_EMAILS:undefined});
    const code=await startAndCode();
    expect((await post('/verify',{code})).status).toBe(200);expect(w.sent).toHaveLength(0);
  });
  it('cancel',async()=>{await startAndCode();const j=await (await post('/cancel',{})).json();expect(j.pending).toBeNull();});
  it('maskEmail keeps one character and the domain',()=>{expect(maskEmail('anthony@tcdsolutionsgroup.com')).toBe('a•••@tcdsolutionsgroup.com');});
});

describe('emails',()=>{
  it('the worker sends an enrollment code as CONTACT_CODE without a reset link',async()=>{
    const sent:any[]=[];const p=seal(JSON.stringify({kind:'CONTACT_CODE',code:'12345678'}),keys.outbox),dest=seal('remi@gmail.com',keys.contact);
    let delivery:any={delivery_id:'d1',challenge_id:'c1',channel:'EMAIL',encrypted_payload:p.ciphertext,payload_iv:p.iv,payload_tag:p.tag,
      destination_ciphertext:dest.ciphertext,destination_iv:dest.iv,destination_tag:dest.tag};
    const pool:any={query:async(sql:string)=>{if(/delivery_claim/.test(sql)){const d=delivery;delivery=null;return {rows:d?[d]:[]};}return {rows:[]};}};
    const wk=new RecoveryWorkers(pool,keys,{name:'t',sendEmail:async m=>{sent.push(m);return 'ACCEPTED';}},'https://app.test/x',5000);
    expect(await wk.deliverOne()).toBe('ACCEPTED');
    expect(sent[0]).toMatchObject({kind:'CONTACT_CODE',to:'remi@gmail.com',code:'12345678'});expect(sent[0].link).toBeUndefined();
  });
  it('each kind has its own subject; codes and links appear only where they belong',()=>{
    const c=compose({kind:'CONTACT_CODE',to:'a@b.co',code:'12345678'});expect(c.subject).toMatch(/Confirm your/);expect(c.text).toContain('12345678');
    const a=compose({kind:'APPROVAL_NEEDED',to:'x@y.co',link:'https://l/approve/recovery/?e=1',hint:'r•••@gmail.com'});
    expect(a.subject).toMatch(/needs your approval/);expect(a.text).toContain('https://l/approve/recovery/?e=1');expect(a.text).not.toMatch(/\d{8}/);
    const r=compose({kind:'RESET_CODE',to:'a@b.co',code:'87654321',link:'https://app/x?ref=R'});expect(r.subject).toMatch(/password recovery code/);expect(r.text).toContain('?ref=R');
  });
});
