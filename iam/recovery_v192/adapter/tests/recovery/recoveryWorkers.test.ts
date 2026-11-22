import {describe,it,expect} from 'vitest';
import crypto from 'node:crypto';
import {RecoveryWorkers} from '../../src/express/recovery/recoveryWorkers';
import {deriveRecoveryKeys} from '../../src/express/recovery/recoveryConfig';
import {hmac,otpDigest,seal} from '../../src/express/recovery/recoveryCrypto';

const keys=deriveRecoveryKeys('cd'.repeat(32));
const REQ='11111111-1111-4111-8111-111111111111';

function fakeDb(){
  const db:any={lease:null as any,settled:[] as string[][],issued:null as any,invitation:null as any,delivery:null as any,deliverySettled:[] as string[][],issueError:null as any};
  db.pool={query:async(sql:string,p:any[]=[])=>{
    const f=(sql.match(/warehouse_identity\.(\w+)/)||[])[1];
    if(f==='recovery_delivery_quarantine_v192')return {rows:[{n:0}]};
    if(f==='recovery_issuance_lease_v192'){const l=db.lease;db.lease=null;return {rows:l?[l]:[]};}
    if(f==='recovery_issuance_settle_v192'){db.settled.push(p);return {rows:[]};}
    if(f==='recovery_invitation_issue_v192'){db.invitation=p[1];return {rows:[{x:1}]};}
    if(f==='recovery_otp_issue_v192'){if(db.issueError){const e:any=new Error(db.issueError);e.code='55000';throw e;}db.issued=p;return {rows:[{challenge_id:'c',delivery_id:'d'}]};}
    if(f==='recovery_delivery_claim_v192'){const d=db.delivery;db.delivery=null;return {rows:d?[d]:[]};}
    if(f==='recovery_delivery_settle_v192'){db.deliverySettled.push(p);return {rows:[]};}
    throw new Error('unexpected '+f);
  }};
  return db;
}

describe('recovery workers',()=>{
  it('issues an invitation + code for an approved reset, then delivers it with the link and the contact address',async()=>{
    const db=fakeDb(),sent:any[]=[];
    const w=new RecoveryWorkers(db.pool,keys,{name:'test',sendEmail:async m=>{sent.push(m);return 'ACCEPTED';}},'https://app.test/auth/recovery/new-password',5000);
    db.lease={reset_request_id:REQ,correlation_id:crypto.randomUUID(),code_status:'NONE'};
    expect(await w.issueOne()).toBe('PREPARED');
    expect(db.settled).toEqual([[REQ,'PREPARED']]);
    const [,channel,digest,salt,payload,iv,tag]=db.issued;expect(channel).toBe('EMAIL');
    // feed the queued payload + an encrypted contact back through a delivery claim
    const dest=seal('employee@example.test',keys.contact);
    db.delivery={delivery_id:'d1',challenge_id:'c1',channel:'EMAIL',encrypted_payload:payload,payload_iv:iv,payload_tag:tag,
      destination_ciphertext:dest.ciphertext,destination_iv:dest.iv,destination_tag:dest.tag};
    expect(await w.deliverOne()).toBe('ACCEPTED');
    expect(db.deliverySettled).toEqual([['d1','ACCEPTED']]);
    const m=sent[0];expect(m.to).toBe('employee@example.test');expect(m.code).toMatch(/^\d{8}$/);
    expect(Buffer.compare(otpDigest(m.code,salt,keys.otp),digest)).toBe(0);
    const ref=new URL(m.link).searchParams.get('ref')!;expect(m.link.startsWith('https://app.test/auth/recovery/new-password?ref=')).toBe(true);
    expect(Buffer.compare(hmac(keys.ref,'invitation',ref),db.invitation)).toBe(0);
  });
  it('a live code is not re-issued; a code needing review is blocked for an operator',async()=>{
    const db=fakeDb();const w=new RecoveryWorkers(db.pool,keys,{name:'t',sendEmail:async()=>'ACCEPTED'},'https://a.test/x',5000);
    db.lease={reset_request_id:REQ,correlation_id:crypto.randomUUID(),code_status:'LIVE'};expect(await w.issueOne()).toBe('PREPARED');expect(db.issued).toBeNull();
    db.lease={reset_request_id:REQ,correlation_id:crypto.randomUUID(),code_status:'REVIEW'};expect(await w.issueOne()).toBe('REVIEW');
    expect(db.settled.at(-1)).toEqual([REQ,'POLICY_BLOCKED']);
  });
  it('policy refusals are not retried; infrastructure errors are',async()=>{
    const db=fakeDb();const w=new RecoveryWorkers(db.pool,keys,{name:'t',sendEmail:async()=>'ACCEPTED'},'https://a.test/x',5000);
    db.issueError='VERIFIED_RECOVERY_DESTINATION_REQUIRED';db.lease={reset_request_id:REQ,correlation_id:crypto.randomUUID(),code_status:'NONE'};
    expect(await w.issueOne()).toBe('POLICY_BLOCKED');
    db.issueError='connection reset';db.lease={reset_request_id:REQ,correlation_id:crypto.randomUUID(),code_status:'NONE'};
    expect(await w.issueOne()).toBe('TRANSIENT');expect(db.settled.at(-1)).toEqual([REQ,'TRANSIENT']);
  });
  it('a send that throws settles as UNKNOWN (never retried automatically)',async()=>{
    const db=fakeDb();const w=new RecoveryWorkers(db.pool,keys,{name:'t',sendEmail:async()=>{throw new Error('timeout');}},'https://a.test/x',5000);
    const p=seal(JSON.stringify({code:'12345678',ref:'R'.repeat(43)}),keys.outbox),dest=seal('a@b.test',keys.contact);
    db.delivery={delivery_id:'d2',challenge_id:'c',channel:'EMAIL',encrypted_payload:p.ciphertext,payload_iv:p.iv,payload_tag:p.tag,
      destination_ciphertext:dest.ciphertext,destination_iv:dest.iv,destination_tag:dest.tag};
    expect(await w.deliverOne()).toBe('UNKNOWN');expect(db.deliverySettled).toEqual([['d2','UNKNOWN']]);
  });
});
