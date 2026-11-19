// STAGING end-to-end check for the central passkey ceremony, run by stg_central.sh test. Synthetic accounts only.
// Real path: enrollment page API (127.0.0.1:8198) -> 6.1C central routes -> 626; then the ISSUER's own code
// (iam-verifier-client.mjs from /srv/arb-system/oidc_issuer/current, its real env, keys and client certificate) ->
// https://iam-issuer-stg.tcds.internal:9444 (mTLS proxy) -> login-v2-api internal IAM API -> 6.1C -> 626 + 622/623.
// A synthetic 623 binding is written for the login step and revoked again at the end. Prints no secret.
import crypto from 'node:crypto';
import fs from 'node:fs';
import {createRequire} from 'node:module';
const [,, cfgPath, issuerEnvPath, issuerSrc, softAuthPath, pgModules] = process.argv;
const require = createRequire(pgModules + '/');
const {Client} = require('pg');
const {SoftAuthenticator} = await import(softAuthPath);
const {createIamVerifier} = await import(issuerSrc + '/iam-verifier-client.mjs');
const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
const ienv = Object.fromEntries(fs.readFileSync(issuerEnvPath, 'utf8').split('\n').filter(l => /^[A-Z0-9_]+=/.test(l))
  .map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const RP = cfg.api.CENTRAL_RP_ID, ORIGIN = `https://${RP}`, ISS = cfg.api.CENTRAL_OIDC_ISSUER.replace(/\/$/, '');
const ENROLL = `http://127.0.0.1:${cfg.api.CENTRAL_ENROLL_PORT}`;
let fail = 0;
const ck = (name, pass, detail = '') => { if (!pass) fail++; console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail && !pass ? '  [' + detail + ']' : ''}`); };

const db = new Client({connectionString: process.env.STG_ADMIN_DB_URL, ssl: {rejectUnauthorized: false}});
await db.connect();
const tag = crypto.randomBytes(3).toString('hex');
const mk = async n => (await db.query(`INSERT INTO warehouse_identity.users(username,display_name,status) VALUES($1,$2,'ACTIVE') RETURNING user_id`,
  [`stg.central.e2e.${n}.${tag}`, `STAGING E2E ${n}`])).rows[0].user_id;
const leader = await mk('leader'), a1 = await mk('approver1'), a2 = await mk('approver2');
const auth = new SoftAuthenticator({rpId: RP, origin: ORIGIN});
let bindingId = null, passkeyRevoked = false;
try {
  // invite (the admin function, through its role, inside one transaction)
  const token = crypto.randomBytes(32).toString('base64url');
  await db.query('BEGIN');
  await db.query(`GRANT tcds_identity_central_admin TO current_user WITH INHERIT TRUE`);
  await db.query(`SELECT warehouse_identity.central_issue_invite_v1($1,$2,$3,$4,15,'staging e2e synthetic',gen_random_uuid())`,
    [leader, a1, crypto.createHash('sha256').update(token).digest(), RP]);
  await db.query(`REVOKE tcds_identity_central_admin FROM current_user`);
  await db.query('COMMIT');

  const page = await fetch(ENROLL + '/enroll/');
  ck('E1 enrollment page served with a strict CSP', page.status === 200 && (page.headers.get('content-security-policy') || '').includes("default-src 'none'"));
  const h = {'content-type': 'application/json', origin: ORIGIN, 'sec-fetch-site': 'same-origin'};
  const o = await (await fetch(ENROLL + '/enroll/api/options', {method: 'POST', headers: h, body: JSON.stringify({token})})).json();
  ck('E2 options name the invited account, RP login-stg, resident key + UV required',
    o.options?.user?.displayName === 'STAGING E2E leader' && o.options?.rp?.id === RP && o.options?.authenticatorSelection?.userVerification === 'required', JSON.stringify(o).slice(0, 120));
  const v = await fetch(ENROLL + '/enroll/api/verify', {method: 'POST', headers: h, body: JSON.stringify({challengeId: o.challengeId, response: auth.create(o.options)})});
  ck('E3 passkey enrolled', v.status === 200, String(v.status));
  const again = await fetch(ENROLL + '/enroll/api/options', {method: 'POST', headers: h, body: JSON.stringify({token})});
  ck('E4 the invite cannot be used twice', again.status === 403, String(again.status));

  const login = async (env = ienv) => {
    const iv = createIamVerifier(env);
    const interactionId = 'stg_' + crypto.randomBytes(12).toString('base64url'), requestId = crypto.randomUUID();
    const b = await iv.begin({interactionId, requestId, issuer: ISS});
    return iv.finish({interactionId, requestId, issuer: ISS, challengeId: b.challengeId, credential: auth.get(b.options)});
  };
  const err = async f => { try { await f(); return 'NO_ERROR'; } catch (e) { return e.message; } };
  ck('L1 login without a 623 binding: no proof for the issuer', (await err(() => login())) === 'IAM_VERIFIER_DENIED');

  const sub = crypto.createHmac('sha256', cfg.api.CENTRAL_SUBJECT_KEY).update(`${ISS}\n${leader}`, 'utf8').digest('base64url');
  bindingId = (await db.query(`INSERT INTO warehouse_identity.eoc_federated_subject_bindings_v12
      (issuer,subject_hash,user_id,binding_status,evidence_reference,approved_by,secondary_approved_by,verified_at)
      VALUES($1,$2,$3,'VERIFIED','STAGING_E2E_SYNTHETIC_TEST',$4,$5,clock_timestamp()) RETURNING binding_id`,
    [ISS, crypto.createHash('sha256').update(sub).digest('hex'), leader, a1, a2])).rows[0].binding_id;
  let proof = null, e1 = 'NO_ERROR';
  try { proof = await login(); } catch (e) { e1 = e.message; }
  ck('L2 login with a binding: the issuer\'s own client + assertPasskeyProof accept it (via 9444 mTLS)',
    proof?.iamUserId === leader && proof?.accountId === sub && proof?.acr === 'urn:tcds:acr:phishing-resistant:uv', e1);
  ck('L3 the subject is opaque (not the IAM user id)', !!proof && !proof.accountId.includes(leader.replace(/-/g, '')) && /^[A-Za-z0-9_-]{43}$/.test(proof.accountId));
  ck('L4 the issuer\'s bridge key is refused on the passkey path',
    (await err(() => login({...ienv, IAM_WORKLOAD_KEY: ienv.IAM_EOC_BRIDGE_KEY}))) === 'IAM_VERIFIER_DENIED');
  ck('L5 the 9443 bridge proxy does not forward passkey calls',
    (await err(() => login({...ienv, IAM_PASSKEY_API_URL: ienv.IAM_EOC_BRIDGE_API_URL}))) === 'IAM_VERIFIER_DENIED');
  const evidence = (await db.query(`SELECT count(*)::int n FROM warehouse_identity.webauthn_verification_evidence
      WHERE user_id=$1 AND verified_rp_id=$2 AND details->>'purpose'='EOC_OIDC_LOGIN'`, [leader, RP])).rows[0].n;
  // L1's passkey was verified (evidence written) before the missing binding refused the sign-in; L2 signed in.
  ck('L6 each verified passkey ceremony left evidence in the shared evidence table (L1 + L2)', evidence === 2, String(evidence));
  const denied = (await db.query(`SELECT count(*)::int n FROM warehouse_identity.eoc_bridge_audit_v12
      WHERE event_type='EOC_FEDERATION_DENIED' AND occurred_at > clock_timestamp() - interval '10 minutes'`).catch(() => ({rows: [{n: -1}]}))).rows[0].n;
  ck('L6b the refused binding lookup (L1) is in the 623 audit', denied >= 1, String(denied));
  const wh = (await db.query(`SELECT count(*)::int n FROM warehouse_identity.passkeys WHERE user_id IN ($1,$2,$3)`, [leader, a1, a2])).rows[0].n;
  ck('L7 no Warehouse passkey was created', wh === 0, String(wh));

  // account suspended -> refused immediately
  await db.query(`UPDATE warehouse_identity.users SET status='DISABLED' WHERE user_id=$1`, [leader]);
  ck('L8 a suspended account is refused at once', (await err(() => login())) === 'IAM_VERIFIER_DENIED');
} finally {
  if (bindingId) await db.query(`UPDATE warehouse_identity.eoc_federated_subject_bindings_v12 SET binding_status='REVOKED', revoked_at=clock_timestamp()
      WHERE binding_id=$1`, [bindingId]).catch(() => {});
  const pk = (await db.query(`SELECT central_passkey_id FROM warehouse_identity.central_passkeys WHERE user_id=$1`, [leader]).catch(() => ({rows: []}))).rows;
  if (pk.length) {
    await db.query('BEGIN'); await db.query(`GRANT tcds_identity_central_admin TO current_user WITH INHERIT TRUE`);
    for (const r of pk) await db.query(`SELECT warehouse_identity.central_revoke_passkey_v1($1,$2,'staging e2e cleanup')`, [r.central_passkey_id, a1]);
    await db.query(`REVOKE tcds_identity_central_admin FROM current_user`); await db.query('COMMIT'); passkeyRevoked = true;
  }
  await db.query(`UPDATE warehouse_identity.users SET status='DISABLED', archived_at=clock_timestamp() WHERE user_id IN ($1,$2,$3)`, [leader, a1, a2]);
  console.log(`cleanup: binding revoked=${!!bindingId}, passkey revoked=${passkeyRevoked}, 3 synthetic users disabled + archived (rows kept for audit)`);
  await db.end();
}
console.log(`E2E: ${fail === 0 ? 'ALL PASSED' : fail + ' FAILED'}`);
process.exit(fail ? 1 : 0);
