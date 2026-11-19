// End to end: the real 6.1C app (central routes mounted) against a PostgreSQL with 626 applied, real WebAuthn
// signatures from a software authenticator. Needs CENTRAL_TEST_DB_URL (verifier/admin test login) and
// CENTRAL_TEST_ADMIN_DB_URL (fixture writer). Skipped when they are not set.
import crypto from 'node:crypto';
import type {AddressInfo} from 'node:net';
import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {Pool} from 'pg';
import {SoftAuthenticator} from './softAuthenticator';

const DB=process.env.CENTRAL_TEST_DB_URL,ADMIN_DB=process.env.CENTRAL_TEST_ADMIN_DB_URL;
const RP='login-stg.tcdsolutionsgroup.com',ORIGIN=`https://${RP}`,ISS='https://login-stg.tcdsolutionsgroup.com';
const SECRET='c'.repeat(48);
const {privateKey,publicKey}=crypto.generateKeyPairSync('ed25519');
Object.assign(process.env,{ORCHESTRATOR_DATABASE_URL:DB??'postgres://x@127.0.0.1:1/x',WEBAUTHN_DATABASE_URL:DB??'postgres://x@127.0.0.1:1/x',
  DEVICE_VERIFIER_DATABASE_URL:DB??'postgres://x@127.0.0.1:1/x',RP_ID:'warehouse-app.tcdsolutionsgroup.com',
  EXPECTED_ORIGIN:'https://warehouse-app.tcdsolutionsgroup.com',CHALLENGE_HASH_KEY:'h'.repeat(48),CLAIM_HASH_KEY:'k'.repeat(48),
  WEBAUTHN_WORKLOAD_SECRET:'w'.repeat(48),DEVICE_WORKLOAD_SECRET:'d'.repeat(48),
  RESULT_SIGNING_PRIVATE_KEY_PEM:privateKey.export({type:'pkcs8',format:'pem'}).toString(),VERIFIER_INSTANCE:'central-e2e',
  CENTRAL_RP_ID:RP,CENTRAL_ORIGIN:ORIGIN,CENTRAL_DATABASE_URL:DB??'',CENTRAL_WORKLOAD_SECRET:SECRET});

const d=DB&&ADMIN_DB?describe:describe.skip;
let base='',server:any,admin:Pool,verifierDb:Pool,leader='',approverAdmin='';

function signed(path:string,body:unknown,o:{secret?:string;scope?:string;nonce?:string}={}){
  const raw=JSON.stringify(body),hash=crypto.createHash('sha256').update(raw).digest('hex');
  const ts=String(Date.now()),nonce=o.nonce??crypto.randomUUID(),rid=crypto.randomUUID();
  const sig=crypto.createHmac('sha256',o.secret??SECRET).update(`${ts}.${nonce}.${hash}.${rid}`).digest('base64url');
  return fetch(base+path,{method:'POST',body:raw,headers:{'content-type':'application/json','x-tcds-timestamp':ts,'x-tcds-nonce':nonce,
    'x-request-id':rid,'x-correlation-id':crypto.randomUUID(),'x-tcds-body-sha256':hash,'x-tcds-request-signature':sig,
    'x-tcds-workload':o.scope??'central'}});
}
const post=async(path:string,body:unknown)=>{const r=await signed(path,body);return {status:r.status,body:await r.json() as any}};
async function invite(user:string){
  const token=crypto.randomBytes(32).toString('base64url');
  await verifierDb.query(`SELECT warehouse_identity.central_issue_invite_v1($1,$2,$3,$4,60,'e2e enrollment',gen_random_uuid())`,
    [user,approverAdmin,crypto.createHash('sha256').update(token).digest(),RP]);
  return token;
}
async function enroll(auth:SoftAuthenticator,user:string){
  const o=await post('/internal/v1/central/enrollment/options',{inviteToken:await invite(user)});
  const v=await post('/internal/v1/central/enrollment/verify',{challengeId:o.body.challengeId,response:auth.create(o.body.options),friendlyName:'Laptop'});
  return {o,v};
}
const interaction=()=>({issuer:ISS,interactionId:'int-'+crypto.randomBytes(8).toString('hex'),issuerRequestId:crypto.randomUUID()});
async function login(auth:SoftAuthenticator,get:any={},bind=interaction(),verifyBind?:any){
  const o=await post('/internal/v1/central/login/options',bind);
  const v=await post('/internal/v1/central/login/verify',{challengeId:o.body.challengeId,...(verifyBind??bind),response:auth.get(o.body.options,get)});
  return {o,v,bind};
}
const state=async(cred:string)=>(await admin.query(`SELECT security_state FROM warehouse_identity.central_passkeys WHERE credential_id=$1`,[cred])).rows[0]?.security_state;

d('central issuer passkey ceremony (626 + 6.1C central routes)',()=>{
  beforeAll(async()=>{
    admin=new Pool({connectionString:ADMIN_DB});verifierDb=new Pool({connectionString:DB});
    const mk=async(n:string,s='ACTIVE')=>(await admin.query(`INSERT INTO warehouse_identity.users(username,display_name,status) VALUES($1,$2,$3) RETURNING user_id`,
      [n+'_'+crypto.randomBytes(4).toString('hex'),n,s])).rows[0].user_id;
    leader=await mk('E2E Leader');approverAdmin=await mk('E2E Identity Admin');
    const {buildApp}=await import('../../src/app');
    server=buildApp().listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
    base=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async()=>{server?.close();await admin?.end();await verifierDb?.end()});

  it('ready/central reports the central RP, never the Warehouse RP',async()=>{
    const r=await (await fetch(base+'/ready/central')).json() as any;
    expect(r).toEqual({status:'ready',rpId:RP,origin:ORIGIN});
  });
  it('enrollment: an unknown invite is refused',async()=>{
    const r=await post('/internal/v1/central/enrollment/options',{inviteToken:crypto.randomBytes(32).toString('base64url')});
    expect(r.status).toBe(403);expect(r.body.error.code).toBe('CENTRAL_INVITE_INVALID');
  });
  it('enrollment: options are for the central RP, resident key + user verification required; verify returns a signed central result',async()=>{
    const a=new SoftAuthenticator(RP,ORIGIN);const {o,v}=await enroll(a,leader);
    expect(o.status).toBe(200);
    expect(o.body.options.rp.id).toBe(RP);expect(o.body.options.authenticatorSelection).toMatchObject({residentKey:'required',userVerification:'required'});
    expect(v.status).toBe(200);
    expect(v.body).toMatchObject({contractVersion:'central-1.0',ceremony:'CENTRAL_PASSKEY_ENROLLMENT',userId:leader,rpId:RP});
    const {signature,...unsigned}=v.body;
    expect(crypto.verify(null,Buffer.from(JSON.stringify(unsigned,Object.keys(unsigned).sort())),publicKey,Buffer.from(signature,'base64url'))).toBe(true);
    const ev=(await admin.query(`SELECT ceremony_type,passkey_id,verified_rp_id,user_verified FROM warehouse_identity.webauthn_verification_evidence WHERE webauthn_verification_evidence_id=$1`,[v.body.evidenceId])).rows[0];
    expect(ev).toEqual({ceremony_type:'PASSKEY_REGISTRATION',passkey_id:null,verified_rp_id:RP,user_verified:true});
  });
  it('enrollment: an invite works once',async()=>{
    const token=await invite(leader);
    const a=new SoftAuthenticator(RP,ORIGIN);
    const o=await post('/internal/v1/central/enrollment/options',{inviteToken:token});
    await post('/internal/v1/central/enrollment/verify',{challengeId:o.body.challengeId,response:a.create(o.body.options)});
    const again=await post('/internal/v1/central/enrollment/options',{inviteToken:token});
    expect(again.status).toBe(403);
  });
  it('enrollment: an authenticator without user verification is refused',async()=>{
    const a=new SoftAuthenticator(RP,ORIGIN);
    const o=await post('/internal/v1/central/enrollment/options',{inviteToken:await invite(leader)});
    const v=await post('/internal/v1/central/enrollment/verify',{challengeId:o.body.challengeId,response:a.create(o.body.options,{uv:false})});
    expect(v.status).toBe(403);
  });

  it('login: discoverable (no allowCredentials), UV required; result carries the user, auth time and the issuer binding',async()=>{
    const a=new SoftAuthenticator(RP,ORIGIN);await enroll(a,leader);
    const {o,v,bind}=await login(a);
    expect(o.body.options.allowCredentials??[]).toEqual([]);expect(o.body.options.userVerification).toBe('required');expect(o.body.options.rpId).toBe(RP);
    expect(v.status).toBe(200);
    expect(v.body).toMatchObject({ceremony:'EOC_OIDC_LOGIN',userId:leader,issuer:bind.issuer,interactionId:bind.interactionId,
      issuerRequestId:bind.issuerRequestId,userVerified:true});
    expect(Math.abs(Date.now()/1000-v.body.authTime)).toBeLessThan(10);
  });
  it('login: the same assertion cannot be replayed',async()=>{
    const a=new SoftAuthenticator(RP,ORIGIN);await enroll(a,leader);
    const bind=interaction();
    const o=await post('/internal/v1/central/login/options',bind);
    const assertion=a.get(o.body.options);
    expect((await post('/internal/v1/central/login/verify',{challengeId:o.body.challengeId,...bind,response:assertion})).status).toBe(200);
    const replay=await post('/internal/v1/central/login/verify',{challengeId:o.body.challengeId,...bind,response:assertion});
    expect(replay.status).toBe(403);expect(replay.body.error.code).toBe('CHALLENGE_CONSUMED');
  });
  it('login: a challenge issued for one issuer interaction cannot finish another',async()=>{
    const a=new SoftAuthenticator(RP,ORIGIN);await enroll(a,leader);
    const {v}=await login(a,{},interaction(),interaction());
    expect(v.status).toBe(403);expect(v.body.error.code).toBe('ISSUER_BINDING_MISMATCH');
  });
  it.each([
    ['no user verification',{uv:false}],
    ['an assertion made for the Warehouse origin',{origin:'https://warehouse-app.tcdsolutionsgroup.com'}],
    ['a bad signature',{badSignature:true}],
    ['another user handle',{userHandle:crypto.randomBytes(32).toString('base64url')}],
  ])('login refused: %s (the passkey stays usable)',async(_n,get)=>{
    const a=new SoftAuthenticator(RP,ORIGIN);await enroll(a,leader);
    const {v}=await login(a,get);
    expect(v.status).toBe(403);
    expect(await state([...a.credentials.keys()][0])).toBe('ACTIVE');
    expect((await login(a)).v.status).toBe(200);
  });
  it('login: a VERIFIED assertion with a counter going back suspends the passkey (clone signal); a forged one does not',async()=>{
    const a=new SoftAuthenticator(RP,ORIGIN);await enroll(a,leader);
    const cred=[...a.credentials.keys()][0];
    expect((await login(a,{counter:5})).v.status).toBe(200);
    const forged=await login(a,{counter:2,badSignature:true});
    expect(forged.v.status).toBe(403);expect(await state(cred)).toBe('ACTIVE');
    const clone=await login(a,{counter:3});
    expect(clone.v.status).toBe(403);expect(clone.v.body.error.code).toBe('COUNTER_REGRESSION');expect(await state(cred)).toBe('SUSPENDED');
    const after=await login(a,{counter:9});
    expect(after.v.status).toBe(403);expect(after.v.body.error.code).toBe('CREDENTIAL_NOT_ACTIVE');
  });
  it('login: a second challenge for a live interaction is refused',async()=>{
    const bind=interaction();
    expect((await post('/internal/v1/central/login/options',bind)).status).toBe(200);
    const again=await post('/internal/v1/central/login/options',bind);
    expect(again.status).toBe(409);expect(again.body.error.code).toBe('CENTRAL_LOGIN_ALREADY_STARTED');
  });

  it('workload: wrong secret, wrong scope and a replayed nonce are refused; the Warehouse routes do not accept the central signature',async()=>{
    expect((await signed('/internal/v1/central/login/options',interaction(),{secret:'x'.repeat(48)})).status).toBe(401);
    expect((await signed('/internal/v1/central/login/options',interaction(),{scope:'webauthn'})).status).toBe(401);
    const nonce=crypto.randomUUID();
    expect((await signed('/internal/v1/central/login/options',interaction(),{nonce})).status).toBe(200);
    expect((await signed('/internal/v1/central/login/options',interaction(),{nonce})).status).toBe(409);
    expect((await signed('/internal/v1/webauthn/authentication/options',{identifier:'x',deviceId:crypto.randomUUID()},{scope:'webauthn'})).status).toBe(401);
  });
});
