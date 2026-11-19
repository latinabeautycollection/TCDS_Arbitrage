// EOC module-grant approval (630), whole chain, locally: approval page API (login-v2-api) -> 6.1C grant routes -> 630 on
// the IAM DB -> grant admission service (vendor approvalAdmission.mjs, unchanged) -> retail EOC DB with the vendor's
// 064/071/072 -> eoc_iam.grants_for_subject_v12, read back through the vendor's own policy.mjs. Real WebAuthn
// (software authenticator), real Ed25519 V13 attestations, real 072 writer.
import crypto from 'node:crypto';
import http from 'node:http';
import type {AddressInfo} from 'node:net';
import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {Pool} from 'pg';
import {SoftAuthenticator} from './softAuthenticator';

const DB=process.env.CENTRAL_TEST_DB_URL,ADMIN_DB=process.env.CENTRAL_TEST_ADMIN_DB_URL,EOC_DB=process.env.EOC_TEST_DB_HOSTPORT;
const ADMISSION=process.env.GRANT_ADMISSION_MODULE,POLICY=process.env.EOC_POLICY_MODULE;
const RP='login-stg.tcdsolutionsgroup.com',ORIGIN=`https://${RP}`,ISS='https://login-stg.tcdsolutionsgroup.com';
const CENTRAL_SECRET='c'.repeat(48),ADMISSION_SECRET='g'.repeat(48);
const APPROVAL_ISSUER='urn:tcds:iam:central-verifier:test',APPROVAL_AUDIENCE='urn:tcds:eoc:retail:test';
const result=crypto.generateKeyPairSync('ed25519'),approval=crypto.generateKeyPairSync('ed25519');
const MODULES=['executive','capital','acquisition','market','retail','pqp','purchasing','warehouse','shipping','returns','identity','hardware',
  'governance','forensic','ai','administration','decisions','agents','knowledge','scenarios'];
Object.assign(process.env,{ORCHESTRATOR_DATABASE_URL:DB??'',WEBAUTHN_DATABASE_URL:DB??'',DEVICE_VERIFIER_DATABASE_URL:DB??'',
  RP_ID:'warehouse-app.tcdsolutionsgroup.com',EXPECTED_ORIGIN:'https://warehouse-app.tcdsolutionsgroup.com',CHALLENGE_HASH_KEY:'h'.repeat(48),
  CLAIM_HASH_KEY:'k'.repeat(48),WEBAUTHN_WORKLOAD_SECRET:'w'.repeat(48),DEVICE_WORKLOAD_SECRET:'d'.repeat(48),
  RESULT_SIGNING_PRIVATE_KEY_PEM:result.privateKey.export({type:'pkcs8',format:'pem'}).toString(),VERIFIER_INSTANCE:'grants-e2e',
  CENTRAL_RP_ID:RP,CENTRAL_ORIGIN:ORIGIN,CENTRAL_DATABASE_URL:DB??'',CENTRAL_WORKLOAD_SECRET:CENTRAL_SECRET,
  CENTRAL_GRANT_ADMISSION_SECRET:ADMISSION_SECRET,CENTRAL_APPROVAL_ISSUER:APPROVAL_ISSUER,CENTRAL_APPROVAL_AUDIENCE:APPROVAL_AUDIENCE,
  CENTRAL_APPROVAL_SIGNING_KEY_PEM:approval.privateKey.export({type:'pkcs8',format:'pem'}).toString()});

const d=DB&&ADMIN_DB&&EOC_DB&&ADMISSION&&POLICY?describe:describe.skip;
let verifierServer:http.Server,admissionServer:http.Server,enroll:any,enrollBase='',admissionBase='',admin:Pool,vdb:Pool,eoc:Pool,
  writer:Pool,grantAdmin:Pool,idAdmin='';

const mk=async(n:string)=>(await admin.query(`INSERT INTO warehouse_identity.users(username,display_name,status) VALUES($1,$2,'ACTIVE') RETURNING user_id`,
  [n.toLowerCase().replace(/ /g,'.')+'.'+crypto.randomBytes(3).toString('hex'),n])).rows[0].user_id as string;
async function enrollUser(auth:SoftAuthenticator,user:string){
  const token=crypto.randomBytes(32).toString('base64url');
  await vdb.query(`SELECT warehouse_identity.central_issue_invite_v1($1,$2,$3,$4,60,'grant test',gen_random_uuid())`,
    [user,idAdmin,crypto.createHash('sha256').update(token).digest(),RP]);
  const h={'content-type':'application/json',origin:ORIGIN,'sec-fetch-site':'same-origin'};
  const o=await (await fetch(enrollBase+'/enroll/api/options',{method:'POST',headers:h,body:JSON.stringify({token})})).json() as any;
  await fetch(enrollBase+'/enroll/api/verify',{method:'POST',headers:h,body:JSON.stringify({challengeId:o.challengeId,response:auth.create(o.options)})});
}
const bindDirect=(user:string)=>admin.query(`INSERT INTO warehouse_identity.eoc_federated_subject_bindings_v12(issuer,subject_hash,user_id,binding_status,
    evidence_reference,approved_by,secondary_approved_by,verified_at) VALUES($1,$2,$3,'VERIFIED','GRANT_TEST_DIRECT',gen_random_uuid(),gen_random_uuid(),clock_timestamp())`,
  [ISS,crypto.randomBytes(32).toString('hex'),user]);
const viewAll=()=>JSON.stringify(MODULES.map(m=>({moduleId:m,operation:'VIEW',scopeKind:'ENTERPRISE',scopeIds:[]})));

d('EOC grant approval: page API -> 6.1C -> 630 -> grant admission (vendor) -> retail EOC DB (vendor 072)',()=>{
  beforeAll(async()=>{
    admin=new Pool({connectionString:ADMIN_DB});vdb=new Pool({connectionString:DB});
    eoc=new Pool({connectionString:`postgres://postgres:localtest@${EOC_DB}/eoc_local`});
    writer=new Pool({connectionString:`postgres://eoc_attest_writer_t:localtest-only@${EOC_DB}/eoc_local`});
    grantAdmin=new Pool({connectionString:`postgres://eoc_grant_admin_t:localtest-only@${EOC_DB}/eoc_local`});
    idAdmin=await mk('Grant Identity Admin');
    const {createGrantAdmission}=await import(ADMISSION as string);
    admissionServer=http.createServer(createGrantAdmission({writerPool:writer,grantAdminPool:grantAdmin,
      publicKeyPem:approval.publicKey.export({type:'spki',format:'pem'}).toString(),issuer:APPROVAL_ISSUER,audience:APPROVAL_AUDIENCE,secret:ADMISSION_SECRET}));
    admissionServer.listen(0,'127.0.0.1');await new Promise(r=>admissionServer.once('listening',r));
    admissionBase=`http://127.0.0.1:${(admissionServer.address() as AddressInfo).port}`;
    process.env.CENTRAL_GRANT_ADMISSION_URL=admissionBase;
    const {buildApp}=await import('../../src/app');
    verifierServer=buildApp().listen(0,'127.0.0.1') as unknown as http.Server;await new Promise(r=>verifierServer.once('listening',r));
    const vBase=`http://127.0.0.1:${(verifierServer.address() as AddressInfo).port}`;
    const verifier={baseUrl:vBase,workloadSecret:CENTRAL_SECRET,resultPublicKeyPem:result.publicKey.export({type:'spki',format:'pem'}).toString(),rpId:RP};
    const s=http.createServer();s.listen(0,'127.0.0.1');await new Promise(r=>s.once('listening',r));const p=(s.address() as AddressInfo).port;s.close();
    const en=await import('../../lv2/centralEnrollment');
    enroll=en.startCentralEnrollment({host:'127.0.0.1',port:p,publicOrigin:ORIGIN+'/',assetsDir:__dirname+'/../../lv2/assets',verifier,rateLimitPerMinute:1000});
    await new Promise(r=>setTimeout(r,200));
    enrollBase=`http://127.0.0.1:${p}`;
  });
  afterAll(async()=>{verifierServer?.close();admissionServer?.close();await enroll?.close();
    for(const p of [admin,vdb,eoc,writer,grantAdmin])await p?.end()});

  it('the verifier reports grant approval as configured',async()=>{
    const port=(verifierServer.address() as AddressInfo).port;
    expect(await (await fetch(`http://127.0.0.1:${port}/ready/central`)).json()).toMatchObject({status:'ready',grantApproval:true});
  });

  it('two approvers approve the whole set once each; 20 vendor grants exist; the EOC policy grants exactly VIEW on 20 modules',async()=>{
    const target=await mk('Grant Target CTO'),apA=await mk('Grant Approver VP'),apB=await mk('Grant Approver IT'),bindOnly=await mk('Binding Approver Only');
    const role=(await admin.query(`SELECT role_id FROM warehouse_identity.roles WHERE role_code='EOC_MODULE_GRANT_APPROVER'`)).rows[0].role_id;
    const brole=(await admin.query(`SELECT role_id FROM warehouse_identity.roles WHERE role_code='EOC_IDENTITY_BINDING_APPROVER'`)).rows[0].role_id;
    await admin.query(`INSERT INTO warehouse_identity.user_role_assignments(user_id,role_id) VALUES($1,$3),($2,$3),($4,$5)`,[apA,apB,role,bindOnly,brole]);
    const tA=new SoftAuthenticator(RP,ORIGIN),aA=new SoftAuthenticator(RP,ORIGIN),aB=new SoftAuthenticator(RP,ORIGIN),aO=new SoftAuthenticator(RP,ORIGIN);
    for(const [a,u] of [[tA,target],[aA,apA],[aB,apB],[aO,bindOnly]] as const)await enrollUser(a,u);
    await bindDirect(target);
    const rq=(await vdb.query(`SELECT warehouse_identity.central_request_grants_v1($1,$2::jsonb,90,'EOC pilot: CTO module view',$3,72) id`,
      [target,viewAll(),idAdmin])).rows[0].id as string;

    const h={'content-type':'application/json',origin:ORIGIN,'sec-fetch-site':'same-origin'};
    const api=async(path:string,body:object)=>{const r=await fetch(enrollBase+'/approve/api/grant/'+path,{method:'POST',headers:h,body:JSON.stringify(body)});return {status:r.status,body:await r.json() as any}};
    const approveWith=async(auth:SoftAuthenticator)=>{const o=await api('options',{grantRequestId:rq});if(!o.body.options)return o;
      return api('verify',{challengeId:o.body.challengeId,grantRequestId:rq,response:auth.get(o.body.options)})};

    expect((await fetch(enrollBase+'/approve/?g='+rq)).status).toBe(200);
    expect(await (await fetch(enrollBase+'/approve/assets/approve.js')).text()).toContain('EOC access.');
    const info=await api('info',{grantRequestId:rq});
    expect(info.body).toMatchObject({status:'OPEN',purpose:'EOC pilot: CTO module view',targetDisplayName:'Grant Target CTO',validDays:90,approvals:0,
      required:2,firstApprovalExpiresAt:null});
    expect(info.body.items).toHaveLength(20);expect(info.body.setFingerprint).toMatch(/^[0-9a-f]{16}$/);
    expect(info.body.targetUserId).toBeUndefined();expect(info.body.setSha256).toBeUndefined();

    expect((await approveWith(aO)).body.error).toBe('APPROVER_NOT_AUTHORIZED');     // binding approver, not a grant approver
    expect((await approveWith(tA)).body.error).toBe('APPROVER_IS_THE_TARGET');
    expect((await approveWith(aA)).body).toEqual({approved:true,approvals:1,granted:false,grants:0});
    const mid=(await api('info',{grantRequestId:rq})).body;
    expect(mid.approvals).toBe(1);
    expect(Date.parse(mid.firstApprovalExpiresAt)-Date.now()).toBeGreaterThan(4*60_000);
    expect((await eoc.query(`SELECT count(*)::int n FROM eoc_iam.module_grants WHERE subject_id=$1`,[target])).rows[0].n).toBe(0);

    expect((await approveWith(aB)).body).toEqual({approved:true,approvals:2,granted:true,grants:20});
    expect((await api('info',{grantRequestId:rq})).body).toMatchObject({status:'GRANTED',approvals:2});
    expect((await approveWith(aO)).body.error).toBe('CENTRAL_GRANT_REQUEST_NOT_OPEN');

    // retail EOC DB: what the EOC BFF reads (vendor 071 reader) and decides (vendor policy.mjs)
    const rows=(await eoc.query(`SELECT * FROM eoc_iam.grants_for_subject_v12($1)`,[target])).rows;
    expect(rows).toHaveLength(20);
    expect(new Set(rows.map(r=>r.approved_by+'/'+r.secondary_approved_by))).toEqual(new Set([apA+'/'+apB]));
    expect(rows.every(r=>r.approval_reference.startsWith('IAM_ATTESTED:'+rq+':'))).toBe(true);
    const days=(Date.parse(rows[0].valid_until)-Date.parse(rows[0].valid_from))/86_400_000;expect(days).toBe(90);
    const policy=await import(POLICY as string);
    const ent=policy.effectiveGrants('DIRECTOR',rows);
    expect(ent).toHaveLength(20);
    expect(MODULES.every(m=>policy.isAuthorized(ent,m,'VIEW'))).toBe(true);
    expect(policy.isAuthorized(ent,'executive','MANAGE')).toBe(false);
    // every attestation the admission wrote was consumed by the vendor writer; the IAM request records the grant ids
    const att=(await eoc.query(`SELECT count(*)::int n,count(consumed_at)::int c FROM eoc_iam.grant_verified_attestations_v12 WHERE request_id=$1`,[rq])).rows[0];
    expect(att).toEqual({n:40,c:40});
    const ids=(await admin.query(`SELECT eoc_grant_ids FROM warehouse_identity.central_grant_requests WHERE central_grant_request_id=$1`,[rq])).rows[0].eoc_grant_ids;
    expect(new Set(ids)).toEqual(new Set(rows.map(r=>r.grant_id)));
  });

  it('the admission service refuses unsigned, tampered or unauthenticated input; nothing is written',async()=>{
    const post=async(body:any,secret=ADMISSION_SECRET)=>{const raw=JSON.stringify(body),ts=String(Date.now());
      const sig=crypto.createHmac('sha256',secret).update(ts+'.'+crypto.createHash('sha256').update(raw).digest('hex')).digest('base64url');
      const r=await fetch(admissionBase+'/internal/v1/eoc/grants/admit',{method:'POST',headers:{'content-type':'application/json','x-tcds-timestamp':ts,'x-tcds-signature':sig},body:raw});
      return {status:r.status,body:await r.json() as any}};
    expect((await post({},'x'.repeat(48))).status).toBe(401);
    const t=crypto.randomUUID(),a=crypto.randomUUID(),b=crypto.randomUUID(),rq=crypto.randomUUID(),sha='a'.repeat(64);
    const item={moduleId:'executive',operation:'VIEW',scopeKind:'ENTERPRISE',scopeIds:[]};
    const {canonicalApproval}=await import('../../src/central/centralGrants');
    const env=(ap:string,over:any={})=>{const ev=crypto.randomUUID(),now=new Date();
      const e={version:13,issuer:APPROVAL_ISSUER,audience:APPROVAL_AUDIENCE,purpose:'EOC_MODULE_GRANT_APPROVE',evidenceId:crypto.randomUUID(),requestId:rq,
        approverUserId:ap,approverSessionId:crypto.randomUUID(),webAuthnEvidenceId:ev,targetUserId:t,bindingId:null,oidcIssuer:null,subjectHash:null,...item,
        verifiedAt:now.toISOString(),expiresAt:new Date(now.getTime()+240_000).toISOString(),ceremonyId:crypto.randomUUID(),verifierReference:`central-1.0:${sha}:${ev}`};
      const signature=crypto.sign(null,Buffer.from(canonicalApproval(e)),approval.privateKey).toString('base64url');
      return {envelope:{...e,...over},signature}};
    const body=(x:any,y:any)=>({grantRequestId:rq,targetUserId:t,validDays:30,setSha256:sha,items:[item],
      approvals:[{approverUserId:a,attestations:[x]},{approverUserId:b,attestations:[y]}]});
    // a signed attestation whose scope was changed after signing: the vendor signature check refuses it
    const tampered=env(a,{scopeKind:'FACILITY',scopeIds:['F1']});
    expect((await post({...body(tampered,env(b,{scopeKind:'FACILITY',scopeIds:['F1']})),items:[{moduleId:'executive',operation:'VIEW',scopeKind:'FACILITY',scopeIds:['F1']}]})).body.error.code)
      .toBe('APPROVAL_SIGNATURE_INVALID');
    // an attestation signed by another key
    const other=crypto.generateKeyPairSync('ed25519');const forged=env(a);
    forged.signature=crypto.sign(null,Buffer.from(canonicalApproval(forged.envelope)),other.privateKey).toString('base64url');
    expect((await post(body(forged,env(b)))).body.error.code).toBe('APPROVAL_SIGNATURE_INVALID');
    // the same approver twice, and the person approving themselves
    expect((await post({...body(env(a),env(a)),approvals:[{approverUserId:a,attestations:[env(a)]},{approverUserId:a,attestations:[env(a)]}]})).body.error.code).toBe('GRANT_APPROVERS_INVALID');
    expect((await eoc.query(`SELECT count(*)::int n FROM eoc_iam.module_grants WHERE subject_id=$1`,[t])).rows[0].n).toBe(0);
  });
});
