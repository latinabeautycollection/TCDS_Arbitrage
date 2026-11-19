// Whole chain, locally: issuer r4's OWN iam-verifier-client (signing + assertPasskeyProof, unmodified) ->
// login-v2-api internalIamApi passkey routes -> 6.1C central routes -> PostgreSQL with 626. Enrollment through the
// login-v2-api enrollment page API, as a browser on https://login-stg would. Real WebAuthn (software authenticator).
import crypto from 'node:crypto';
import http from 'node:http';
import type {AddressInfo} from 'node:net';
import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {Pool} from 'pg';
import {SoftAuthenticator} from './softAuthenticator';

const DB=process.env.CENTRAL_TEST_DB_URL,ADMIN_DB=process.env.CENTRAL_TEST_ADMIN_DB_URL,R4=process.env.ISSUER_R4_DIR;
const RP='login-stg.tcdsolutionsgroup.com',ORIGIN=`https://${RP}`,ISS='https://login-stg.tcdsolutionsgroup.com';
const CENTRAL_SECRET='c'.repeat(48),PASSKEY_KEY='p'.repeat(48),BRIDGE_KEY='b'.repeat(48),SUBJECT_KEY='s'.repeat(48);
const {privateKey,publicKey}=crypto.generateKeyPairSync('ed25519');
Object.assign(process.env,{ORCHESTRATOR_DATABASE_URL:DB??'',WEBAUTHN_DATABASE_URL:DB??'',DEVICE_VERIFIER_DATABASE_URL:DB??'',
  RP_ID:'warehouse-app.tcdsolutionsgroup.com',EXPECTED_ORIGIN:'https://warehouse-app.tcdsolutionsgroup.com',CHALLENGE_HASH_KEY:'h'.repeat(48),
  CLAIM_HASH_KEY:'k'.repeat(48),WEBAUTHN_WORKLOAD_SECRET:'w'.repeat(48),DEVICE_WORKLOAD_SECRET:'d'.repeat(48),
  RESULT_SIGNING_PRIVATE_KEY_PEM:privateKey.export({type:'pkcs8',format:'pem'}).toString(),VERIFIER_INSTANCE:'chain-e2e',
  CENTRAL_RP_ID:RP,CENTRAL_ORIGIN:ORIGIN,CENTRAL_DATABASE_URL:DB??'',CENTRAL_WORKLOAD_SECRET:CENTRAL_SECRET});

const d=DB&&ADMIN_DB&&R4?describe:describe.skip;
const listen=async(s:http.Server)=>{s.listen(0,'127.0.0.1');await new Promise(r=>s.once('listening',r));return `http://127.0.0.1:${(s.address() as AddressInfo).port}`};
let verifierServer:http.Server,iam:any,enroll:any,iamBase='',enrollBase='',admin:Pool,vdb:Pool,leader='',idAdmin='',issuer:any,centralSubject:any;

// The issuer's own transport (securePost) is mTLS; here the same request goes over loopback HTTP to the listener,
// exactly as the 9444 proxy forwards it (with the verified caller name).
function loopbackPost(base:string,caller='oidc-issuer'){
  return (url:URL,{raw,headers,method='POST'}:any)=>new Promise((resolve,reject)=>{
    const req=http.request(new URL(url.pathname,base),{method,headers:{...headers,'x-tcds-workload-caller':caller}},res=>{
      let s='';res.on('data',x=>s+=x);res.on('end',()=>{if(res.statusCode!==200)return reject(Object.assign(new Error('IAM_VERIFIER_DENIED'),{status:res.statusCode,body:s}));
        try{resolve(JSON.parse(s))}catch{reject(new Error('IAM_INVALID_RESPONSE'))}})});
    req.on('error',reject);req.end(raw);
  });
}
const issuerEnv={IAM_PASSKEY_API_URL:'https://iam-issuer-stg.tcds.internal:9444',IAM_WORKLOAD_KEY:PASSKEY_KEY,IAM_EOC_BRIDGE_KEY:BRIDGE_KEY,
  IAM_CA_FILE:'-',IAM_CLIENT_CERT:'-',IAM_CLIENT_KEY:'-'};

async function enrollLeader(auth:SoftAuthenticator,user=leader){
  const token=crypto.randomBytes(32).toString('base64url');
  await vdb.query(`SELECT warehouse_identity.central_issue_invite_v1($1,$2,$3,$4,60,'chain test',gen_random_uuid())`,
    [user,idAdmin,crypto.createHash('sha256').update(token).digest(),RP]);
  const h={'content-type':'application/json',origin:ORIGIN,'sec-fetch-site':'same-origin'};
  const o=await (await fetch(enrollBase+'/enroll/api/options',{method:'POST',headers:h,body:JSON.stringify({token})})).json() as any;
  const v=await fetch(enrollBase+'/enroll/api/verify',{method:'POST',headers:h,body:JSON.stringify({challengeId:o.challengeId,response:auth.create(o.options),friendlyName:'Work laptop'})});
  return {o,v:{status:v.status,body:await v.json() as any}};
}
async function bind(user:string){
  const sub=centralSubject(SUBJECT_KEY,ISS,user);
  await admin.query(`INSERT INTO warehouse_identity.eoc_federated_subject_bindings_v12(issuer,subject_hash,user_id,binding_status,evidence_reference,
      approved_by,secondary_approved_by,verified_at) VALUES($1,$2,$3,'VERIFIED','CHAIN_TEST_DIRECT',$4,$5,clock_timestamp())`,
    [ISS,crypto.createHash('sha256').update(sub).digest('hex'),user,idAdmin,leader]);
  return sub;
}
async function issuerLogin(auth:SoftAuthenticator,post=loopbackPost(iamBase),key=PASSKEY_KEY){
  const v=issuer({...issuerEnv,IAM_WORKLOAD_KEY:key},post);
  const interactionId='uid_'+crypto.randomBytes(12).toString('base64url'),requestId=crypto.randomUUID();
  const begun:any=await v.begin({interactionId,requestId,issuer:ISS});
  return v.finish({interactionId,requestId,issuer:ISS,challengeId:begun.challengeId,credential:auth.get(begun.options)});
}

d('central passkey chain: issuer r4 client -> login-v2-api -> 6.1C -> 626',()=>{
  beforeAll(async()=>{
    admin=new Pool({connectionString:ADMIN_DB});vdb=new Pool({connectionString:DB});
    const mk=async(n:string)=>(await admin.query(`INSERT INTO warehouse_identity.users(username,display_name,status) VALUES($1,$2,'ACTIVE') RETURNING user_id`,
      [n.toLowerCase().replace(/ /g,'.')+'.'+crypto.randomBytes(3).toString('hex'),n])).rows[0].user_id;
    leader=await mk('Chain Leader');idAdmin=await mk('Chain Identity Admin');
    const {buildApp}=await import('../../src/app');
    verifierServer=buildApp().listen(0,'127.0.0.1') as unknown as http.Server;await new Promise(r=>verifierServer.once('listening',r));
    const vBase=`http://127.0.0.1:${(verifierServer.address() as AddressInfo).port}`;
    const verifier={baseUrl:vBase,workloadSecret:CENTRAL_SECRET,resultPublicKeyPem:publicKey.export({type:'spki',format:'pem'}).toString(),rpId:RP};
    const api=await import('../../lv2/internalIamApi');centralSubject=api.centralSubject;
    const port=async()=>{const s=http.createServer();s.listen(0,'127.0.0.1');await new Promise(r=>s.once('listening',r));const p=(s.address() as AddressInfo).port;s.close();return p};
    const p1=await port(),p2=await port();
    iam=api.startInternalIamApi(admin as any,{host:'127.0.0.1',port:p1,secret:'i'.repeat(48),eocIssuerSecret:BRIDGE_KEY,
      centralPasskey:{issuerPasskeySecret:PASSKEY_KEY,allowedIssuer:ISS,subjectKey:SUBJECT_KEY,verifier}});
    const en=await import('../../lv2/centralEnrollment');
    enroll=en.startCentralEnrollment({host:'127.0.0.1',port:p2,publicOrigin:ORIGIN+'/',assetsDir:__dirname+'/../../lv2/assets',verifier,rateLimitPerMinute:1000});
    await new Promise(r=>setTimeout(r,200));
    iamBase=`http://127.0.0.1:${p1}`;enrollBase=`http://127.0.0.1:${p2}`;
    issuer=(await import(R4+'/src/iam-verifier-client.mjs')).createIamVerifier;
  });
  afterAll(async()=>{verifierServer?.close();await iam?.close();await enroll?.close();await admin?.end();await vdb?.end()});

  it('enrollment page: served with a strict CSP, the invite never in the URL path; assets same-origin',async()=>{
    const r=await fetch(enrollBase+'/enroll/');
    expect(r.status).toBe(200);
    expect(r.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect(r.headers.get('referrer-policy')).toBe('no-referrer');
    expect(await r.text()).toContain('Register this laptop');
    expect((await fetch(enrollBase+'/enroll/assets/tcds-logo-wide.jpg')).headers.get('content-type')).toBe('image/jpeg');
    expect((await fetch(enrollBase+'/enroll/assets/../internal')).status).toBe(404);
  });
  it('enrollment API: another origin, a cross-site fetch or an unknown invite is refused',async()=>{
    const body=JSON.stringify({token:crypto.randomBytes(32).toString('base64url')});
    expect((await fetch(enrollBase+'/enroll/api/options',{method:'POST',headers:{'content-type':'application/json',origin:'https://evil.example'},body})).status).toBe(403);
    expect((await fetch(enrollBase+'/enroll/api/options',{method:'POST',headers:{'content-type':'application/json',origin:ORIGIN,'sec-fetch-site':'cross-site'},body})).status).toBe(403);
    const r=await fetch(enrollBase+'/enroll/api/options',{method:'POST',headers:{'content-type':'application/json',origin:ORIGIN},body});
    expect(r.status).toBe(403);expect((await r.json() as any).error).toBe('CENTRAL_INVITE_INVALID');
  });
  it('enrollment through the page API: options name the invited person; the passkey is registered',async()=>{
    const {o,v}=await enrollLeader(new SoftAuthenticator(RP,ORIGIN));
    expect(o.options.user.displayName).toBe('Chain Leader');expect(o.options.rp.id).toBe(RP);
    expect(v).toEqual({status:200,body:{enrolled:true}});
  });

  it('login without a 623 binding: the issuer gets no proof',async()=>{
    const a=new SoftAuthenticator(RP,ORIGIN);await enrollLeader(a);
    await expect(issuerLogin(a)).rejects.toMatchObject({message:'IAM_VERIFIER_DENIED',status:403});
  });
  it('login with a binding: the issuer\'s own assertPasskeyProof accepts it; subject is opaque and stable',async()=>{
    const user=(await admin.query(`INSERT INTO warehouse_identity.users(username,display_name,status) VALUES($1,'Chain Bound Leader','ACTIVE') RETURNING user_id`,
      ['bound.'+crypto.randomBytes(3).toString('hex')])).rows[0].user_id;
    const a=new SoftAuthenticator(RP,ORIGIN);await enrollLeader(a,user);
    const sub=await bind(user);
    const login=await issuerLogin(a);
    expect(login).toMatchObject({accountId:sub,iamUserId:user,acr:'urn:tcds:acr:phishing-resistant:uv',amr:['webauthn','user_verification'],remember:false});
    expect(login.accountId).not.toContain(user.replace(/-/g,''));expect(sub).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Math.abs(Date.now()/1000-login.ts)).toBeLessThan(10);
    expect((await issuerLogin(a)).accountId).toBe(sub);
    // a suspended account loses access immediately
    await admin.query(`UPDATE warehouse_identity.users SET status='DISABLED' WHERE user_id=$1`,[user]);
    await expect(issuerLogin(a)).rejects.toMatchObject({message:'IAM_VERIFIER_DENIED',status:403});
  });
  it('the issuer\'s BRIDGE key, a call naming another caller, and a replayed nonce are refused',async()=>{
    const a=new SoftAuthenticator(RP,ORIGIN);
    await expect(issuerLogin(a,loopbackPost(iamBase),BRIDGE_KEY)).rejects.toMatchObject({status:401});
    await expect(issuerLogin(a,loopbackPost(iamBase,'eoc-bff'))).rejects.toMatchObject({status:401});
    const raw=Buffer.from(JSON.stringify({interactionId:'uid_replay_'+crypto.randomBytes(6).toString('hex'),requestId:crypto.randomUUID(),issuer:ISS,purpose:'EOC_OIDC_LOGIN'}));
    const path='/internal/v1/iam/oidc/passkey/begin',ts=String(Math.floor(Date.now()/1000)),nonce=crypto.randomUUID();
    const sig=crypto.createHmac('sha256',PASSKEY_KEY).update(['POST',path,ts,nonce,crypto.createHash('sha256').update(raw).digest('hex')].join('\n')).digest('hex');
    const h={'content-type':'application/json','x-eoc-workload-timestamp':ts,'x-eoc-workload-nonce':nonce,'x-eoc-workload-signature':sig};
    expect((await fetch(iamBase+path,{method:'POST',headers:h,body:raw})).status).toBe(200);
    expect((await fetch(iamBase+path,{method:'POST',headers:h,body:raw})).status).toBe(401);
  });
  it('binding approval through the approval page API: two approvers with their own passkeys, then the person signs in',async()=>{
    const mk=async(n:string)=>(await admin.query(`INSERT INTO warehouse_identity.users(username,display_name,status) VALUES($1,$2,'ACTIVE') RETURNING user_id`,
      [n.toLowerCase().replace(/ /g,'.')+'.'+crypto.randomBytes(3).toString('hex'),n])).rows[0].user_id;
    const target=await mk('Approval Target CTO'),apA=await mk('Approver VP'),apB=await mk('Approver IT'),outsider=await mk('Not An Approver');
    const role=(await admin.query(`SELECT role_id FROM warehouse_identity.roles WHERE role_code='EOC_IDENTITY_BINDING_APPROVER'`)).rows[0].role_id;
    await admin.query(`INSERT INTO warehouse_identity.user_role_assignments(user_id,role_id) VALUES($1,$3),($2,$3)`,[apA,apB,role]);
    // each person has their own authenticator, like their own laptop
    const tA=new SoftAuthenticator(RP,ORIGIN),aA=new SoftAuthenticator(RP,ORIGIN),aB=new SoftAuthenticator(RP,ORIGIN),aO=new SoftAuthenticator(RP,ORIGIN);
    await enrollLeader(tA,target);await enrollLeader(aA,apA);await enrollLeader(aB,apB);await enrollLeader(aO,outsider);
    const sub=centralSubject(SUBJECT_KEY,ISS,target),sh=crypto.createHash('sha256').update(sub).digest('hex');
    const rq=(await vdb.query(`SELECT warehouse_identity.central_request_binding_v1($1,$2,$3,'EOC pilot: CTO',$4,24) id`,[target,ISS,sh,idAdmin])).rows[0].id;
    await expect(issuerLogin(tA)).rejects.toMatchObject({status:403});     // not bound yet

    const h={'content-type':'application/json',origin:ORIGIN,'sec-fetch-site':'same-origin'};
    const api=async(path:string,body:object)=>{const r=await fetch(enrollBase+'/approve/api/'+path,{method:'POST',headers:h,body:JSON.stringify(body)});return {status:r.status,body:await r.json() as any}};
    const approveWith=async(auth:SoftAuthenticator)=>{const o=await api("options",{bindingRequestId:rq});if(!o.body.options)return o;
      return api('verify',{challengeId:o.body.challengeId,bindingRequestId:rq,response:auth.get(o.body.options)})};
    const page=await fetch(enrollBase+'/approve/?r='+rq);
    expect(page.status).toBe(200);expect(await page.text()).toContain('Approve binding');
    const info=await api('info',{bindingRequestId:rq});
    expect(info.body).toMatchObject({status:'OPEN',purpose:'EOC pilot: CTO',targetDisplayName:'Approval Target CTO',approvals:0,required:2});
    expect(info.body.subjectHash).toBeUndefined();

    expect((await approveWith(aO)).body.error).toBe('APPROVER_NOT_AUTHORIZED');
    expect((await approveWith(tA)).body.error).toBe('APPROVER_IS_THE_TARGET');
    expect((await approveWith(aA)).body).toEqual({approved:true,approvals:1,bound:false});
    expect((await approveWith(aA)).body.error).toBe('APPROVER_ALREADY_APPROVED');
    await expect(issuerLogin(tA)).rejects.toMatchObject({status:403});     // one approval is not enough
    expect((await approveWith(aB)).body).toEqual({approved:true,approvals:2,bound:true});
    expect((await api('info',{bindingRequestId:rq})).body.status).toBe('BOUND');
    expect((await approveWith(aO)).body.error).toBe('CENTRAL_BINDING_REQUEST_NOT_OPEN');

    const login=await issuerLogin(tA);                                     // now bound: the issuer's own proof check accepts
    expect(login).toMatchObject({accountId:sub,iamUserId:target});
    const b=(await admin.query(`SELECT binding_status,approved_by,secondary_approved_by FROM warehouse_identity.eoc_federated_subject_bindings_v12 WHERE user_id=$1`,[target])).rows[0];
    expect(b).toEqual({binding_status:'VERIFIED',approved_by:apA,secondary_approved_by:apB});
  });
  it('another issuer is refused before any challenge is issued',async()=>{
    const v=issuer(issuerEnv,loopbackPost(iamBase));
    await expect(v.begin({interactionId:'uid_otherissuer01',requestId:crypto.randomUUID(),issuer:'https://login.evil.example'})).rejects.toMatchObject({status:400});
  });
});
