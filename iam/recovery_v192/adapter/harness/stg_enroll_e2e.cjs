#!/usr/bin/env node
// STAGING ONLY end-to-end test of recovery-email enrollment (TCDS 645) through the REAL services:
//   employee (login-v2-api-staging :8195, /api/v1/auth/recovery-email): add email -> code email (delivery worker) ->
//   wrong code -> right code -> approver notice; approver (login-stg approval page API :8198 -> 6.1C verifier ->
//   645): page info -> passkey options -> software central passkey assertion -> approved -> email active.
// Fixtures (as postgres on the staging DB): an AAL1 session for stg_employee_1 on a test device, and a test approver
// user with the recovery-email approver role and a software central passkey (registered through the 626 functions).
// Delivery: capture mode reads the code from RECOVERY_CAPTURE_FILE; graph mode asks you to type the code from the email.
// Leaves stg_employee_1 with the approved recovery email TO (so the reset harness can use it: USE_EXISTING_CONTACT=1).
'use strict';
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), readline = require('node:readline');
const CFG = JSON.parse(fs.readFileSync(process.env.LOGINV2_CONFIG, 'utf8')), API = CFG.api, VER = CFG.verifier;
const APP = process.env.LOGINV2_6_1B;
const { Pool } = require(path.join(APP, 'node_modules', 'pg'));
const soft = require('./softPasskey.cjs');
const TO = (process.env.TO || 'recovery-e2e@invalid.test').toLowerCase();
const RP = VER.CENTRAL_RP_ID, ORIGIN = VER.CENTRAL_ORIGIN, PAGE = `http://127.0.0.1:${API.CENTRAL_ENROLL_PORT}`;
const H = (v, k) => crypto.createHmac('sha256', k).update(v).digest();
const h32 = s => crypto.createHash('sha256').update(s).digest();
const db = new Pool({ ssl: { rejectUnauthorized: false }, max: 2 });
let pass = 0, fail = 0; const ok = (c, m, d = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'} ${m}${d ? ' | ' + d : ''}`); };
const HUMAN = process.env.HUMAN_APPROVAL === '1';   // stop at "waiting for approval": a real approver uses the page
const q1 = async (sql, p) => (await db.query(sql, p)).rows[0];
const ask = q => new Promise(res => { const rl = readline.createInterface({ input: process.stdin, output: process.stdout }); rl.question(q, a => { rl.close(); res(a.trim()); }); });

async function call(base, method, p, body, h = {}) {
  const r = await fetch(base + p, { method, headers: { 'content-type': 'application/json', 'x-request-id': crypto.randomUUID(), 'x-correlation-id': crypto.randomUUID(), ...h },
    body: body === undefined ? undefined : JSON.stringify(body) });
  let j = {}; try { j = await r.json(); } catch {}
  return { s: r.status, j, code: j.error ? (j.error.code || j.error) : '' };
}
async function codeFor(kind, t0) {
  if (API.RECOVERY_DELIVERY_MODE !== 'capture') {
    const at = new Date(t0).toISOString().slice(11, 16);
    console.log(`   Gmail puts emails with the same subject in one thread: open the thread and use the LAST (newest) message, sent after ${at} UTC.`);
    return ask(`   type the 8-digit code from the "${kind === 'CONTACT_CODE' ? 'Confirm your TCDS Warehouse recovery email' : 'recovery'}" email sent to ${TO}: `);
  }
  for (let i = 0; i < 40; i++) {
    await new Promise(r => setTimeout(r, 1000));
    const lines = fs.existsSync(API.RECOVERY_CAPTURE_FILE) ? fs.readFileSync(API.RECOVERY_CAPTURE_FILE, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
    const m = lines.reverse().find(x => x.to === TO && x.kind === kind && Date.parse(x.at) >= t0 - 2000);
    if (m) return m.code;
  }
  return null;
}

(async () => {
  const fx = {};
  try {
    console.log(`== employee API :${API.PORT} | approval page ${PAGE} (RP ${RP}) | delivery ${API.RECOVERY_DELIVERY_MODE} | email ${TO}`);
    const emp = await q1(`SELECT u.user_id, e.employee_id, e.facility_id FROM warehouse_identity.users u JOIN warehouse_identity.employees e USING(user_id) WHERE u.normalized_username='stg_employee_1'`);
    const admin = await q1(`SELECT user_id FROM warehouse_identity.users WHERE normalized_username='stg_approver_1'`);
    if (!emp || !admin) throw new Error('stg_employee_1 / stg_approver_1 missing on staging');
    fx.admin = admin.user_id;
    // ---- start clean: revoke the employee's current email contacts and close open enrollments (so the test can rerun)
    const reset = await db.query(`WITH e AS (UPDATE warehouse_identity.recovery_contact_enrollments_v645 SET status='CANCELLED',closed_at=clock_timestamp()
        WHERE user_id=$1 AND status IN ('AWAITING_CODE','AWAITING_APPROVAL') RETURNING 1)
      UPDATE warehouse_identity.user_recovery_contacts SET status='REVOKED',revoked_at=clock_timestamp(),updated_at=clock_timestamp(),row_version=row_version+1
        WHERE user_id=$1 AND contact_type='EMAIL' AND status IN ('VERIFIED','PENDING') RETURNING contact_id`, [emp.user_id]);
    if (reset.rowCount) console.log(`   revoked ${reset.rowCount} earlier recovery email(s) of stg_employee_1`);
    await db.query(`UPDATE warehouse_identity.recovery_contact_enrollments_v645 SET created_at=created_at-interval '25 hours',expires_at=expires_at-interval '25 hours'
      WHERE user_id=$1 AND created_at>clock_timestamp()-interval '24 hours'`, [emp.user_id]);   // lift the 5-per-day limit for test reruns
    // ---- fixtures: employee session
    fx.dev = (await q1(`INSERT INTO warehouse.devices(facility_id,device_type,status,device_name,serial_number,hardware_fingerprint)
      VALUES($1,'PWA_DESKTOP','ACTIVE','enroll-e2e-device','enroll-e2e-'||gen_random_uuid(),'enroll-e2e-'||gen_random_uuid()) RETURNING device_id`, [emp.facility_id])).device_id;
    const token = crypto.randomBytes(32).toString('base64url'), csrf = crypto.randomBytes(32).toString('base64url');
    fx.session = (await q1(`WITH ds AS (INSERT INTO warehouse.device_sessions(device_id,user_id,employee_number,started_at,last_activity_at,network_state)
        SELECT $1,$2,e.employee_number,statement_timestamp(),statement_timestamp(),'{"fixture":"enroll-e2e"}'::jsonb FROM warehouse_identity.employees e WHERE e.user_id=$2 RETURNING session_id)
      INSERT INTO warehouse_identity.auth_sessions(user_id,employee_id,device_id,warehouse_device_session_id,authentication_method,assurance_level,token_hash,
        csrf_token_hash,issued_at,last_activity_at,idle_expires_at,absolute_expires_at,request_id,correlation_id)
      SELECT $2,$3,$1,ds.session_id,'PASSWORD','AAL1',$4,$5,statement_timestamp(),statement_timestamp(),statement_timestamp()+interval '29 minutes',
        statement_timestamp()+interval '7 hours',gen_random_uuid(),gen_random_uuid() FROM ds RETURNING auth_session_id`,
      [fx.dev, emp.user_id, emp.employee_id, H(token, API.SESSION_HASH_KEY), H(csrf, API.CSRF_HASH_KEY)])).auth_session_id;
    // ---- fixtures: test approver (global role) + software central passkey through the 626 functions
    if (!HUMAN) {
    fx.approver = (await q1(`INSERT INTO warehouse_identity.users(username,display_name,status) VALUES('e2e.recovery.approver.'||substr(md5(random()::text),1,6),'E2E Recovery Approver','ACTIVE') RETURNING user_id`)).user_id;
    await db.query(`INSERT INTO warehouse_identity.user_role_assignments(user_id,role_id) SELECT $1,role_id FROM warehouse_identity.roles
      WHERE role_code='IAM_RECOVERY_DESTINATION_APPROVER'`, [fx.approver]);
    const pk = soft.create(), k = crypto.randomUUID(); fx.pk = pk;
    await db.query(`SELECT warehouse_identity.central_issue_invite_v1($1,$2,$3,$4,60,'enroll e2e test approver',gen_random_uuid())`, [fx.approver, admin.user_id, h32('tok' + k), RP]);
    const b = await q1(`SELECT * FROM warehouse_identity.central_enrollment_begin_v1($1,$2,$3,$4,gen_random_uuid(),gen_random_uuid())`, [h32('tok' + k), RP, ORIGIN, h32('ch' + k)]);
    const c = await q1(`SELECT * FROM warehouse_identity.central_claim_challenge_v1($1,$2,$3,'CENTRAL_PASSKEY_ENROLLMENT',$4,NULL,NULL,NULL)`, [b.auth_challenge_id, h32('ch' + k), h32('cl' + k), RP]);
    const f = await q1(`SELECT * FROM warehouse_identity.central_finalize_enrollment_v1($1,$2,$3,$4,$5,-7,ARRAY['internal'],NULL,'multiDevice',true,true,'e2e',$6,$7,true,
      repeat('a',64),repeat('b',64),repeat('c',64),'e2e','1','enroll-e2e',gen_random_uuid(),gen_random_uuid())`,
      [b.auth_challenge_id, h32('cl' + k), c.claim_generation, pk.credentialId, pk.cosePublicKey, ORIGIN, RP]);
    if (f.outcome !== 'SUCCEEDED') throw new Error('central passkey fixture failed: ' + f.outcome);
    fx.passkey = f.central_passkey_id;
    const mat = await q1(`SELECT * FROM warehouse_identity.central_passkey_material_v1($1,$2)`, [pk.credentialId, RP]);
    fx.userHandle = Buffer.from(mat.user_handle).toString('base64url');
    console.log('   fixtures: employee session, test approver with role + software central passkey');
    }
    let pk, userHandle;
    if (!HUMAN) { pk = fx.pk; userHandle = fx.userHandle; }

    // ---- employee: add, code, confirm
    const E = `http://127.0.0.1:${API.PORT}/api/v1/auth/recovery-email`;
    const emph = { origin: API.PUBLIC_APP_ORIGIN, 'sec-fetch-site': 'same-origin', cookie: `__Host-tcds_session=${token}; __Host-tcds_csrf=${csrf}`, 'x-csrf-token': csrf };
    let r = await call(E, 'GET', '', undefined, emph);
    ok(r.s === 200, 'employee sees the recovery-email screen data', `${r.s} active=${!!r.j.active} pending=${!!(r.j.pending)}`);
    r = await call(E, 'POST', '', { email: TO }, { ...emph, 'x-csrf-token': 'wrong' });
    ok(r.s === 403, 'add without the right CSRF token is refused', `${r.s} ${r.code}`);
    const t0 = Date.now();
    r = await call(E, 'POST', '', { email: TO.toUpperCase() }, emph);
    ok(r.s === 202 && r.j.pending?.status === 'AWAITING_CODE', 'add email -> code sent, waiting for the code', `${r.s} ${r.code} ${r.j.pending?.email || ''}`);
    const code = await codeFor('CONTACT_CODE', t0);
    ok(/^\d{8}$/.test(code || ''), 'enrollment code delivered by the worker', code ? `after ${Math.round((Date.now() - t0) / 1000)}s` : 'none');
    if (!code) throw new Error('no enrollment code');
    r = await call(E, 'POST', '/verify', { code: code === '00000000' ? '11111111' : '00000000' }, emph);
    ok(r.s === 403 && r.code === 'RECOVERY_CODE_INVALID', 'wrong code refused', `${r.s} ${r.code}`);
    r = await call(E, 'POST', '/verify', { code }, emph);
    if (r.s === 403 && r.code === 'RECOVERY_CODE_INVALID' && API.RECOVERY_DELIVERY_MODE !== 'capture') {
      console.log('   that code was refused - most likely it came from an older email in the thread. One more try:');
      r = await call(E, 'POST', '/verify', { code: await ask('   code from the NEWEST email: ') }, emph);
    }
    ok(r.s === 200 && r.j.pending?.status === 'AWAITING_APPROVAL', 'right code -> waiting for approval', `${r.s} ${r.code}`);
    const eid = (await q1(`SELECT enrollment_id FROM warehouse_identity.recovery_contact_enrollments_v645 WHERE user_id=$1 AND status='AWAITING_APPROVAL'`, [emp.user_id]))?.enrollment_id;
    ok(!!eid, 'enrollment recorded as awaiting approval');
    if (!eid) throw new Error('the code was not accepted, so there is nothing to approve - run e2e-enroll again');
    const usable = await q1(`SELECT count(*)::int n FROM warehouse_identity.user_recovery_contacts c JOIN warehouse_identity.recovery_contact_enrollments_v645 e USING(contact_id)
      WHERE e.enrollment_id=$1 AND c.status='VERIFIED'`, [eid]);
    ok(usable.n === 0, 'not usable for recovery before approval');
    if (API.RECOVERY_DELIVERY_MODE === 'capture') {
      const lines = fs.readFileSync(API.RECOVERY_CAPTURE_FILE, 'utf8').trim().split('\n').map(l => JSON.parse(l));
      const n = lines.reverse().find(x => x.kind === 'APPROVAL_NEEDED' && Date.parse(x.at) >= t0 - 2000);
      ok(!!n && n.link.endsWith('?e=' + eid) && !/\d{8}/.test(JSON.stringify({ ...n, at: '' })), 'approver notice carries the approval link and no code', n ? n.link : 'none');
    } else console.log(`   (graph mode: the approver notice went to ${API.RECOVERY_APPROVER_EMAILS}; its link ends ?e=${eid})`);

    if (HUMAN) {
      const link = `${ORIGIN}/approve/recovery/?e=${eid}`;
      console.log(`\n   READY FOR A REAL APPROVER. The notice went to ${API.RECOVERY_APPROVER_EMAILS || '(no approver email configured)'}.`);
      console.log(`   Approval link: ${link}`);
      console.log('   After the approval, check with: stg_anthony.sh status   (then e2e-reset to use the email)');
      return;
    }
    // ---- approver: login-stg page API -> verifier -> 645
    const ph = { origin: ORIGIN, 'sec-fetch-site': 'same-origin' };
    r = await call(PAGE, 'POST', '/approve/api/recovery/info', { enrollmentId: eid }, ph);
    ok(r.s === 200 && r.j.status === 'AWAITING_APPROVAL' && /•/.test(r.j.contactHint || '') && r.j.required >= 1, 'approval page shows the request (masked email)', `${r.s} ${r.j.contactHint} ${r.j.approvals}/${r.j.required}`);
    r = await call(PAGE, 'POST', '/approve/api/recovery/options', { enrollmentId: eid }, ph);
    ok(r.s === 200 && r.j.options?.rpId === RP, 'passkey options for the central RP', `${r.s} ${r.code}`);
    const opt = r.j;
    const bad = soft.assert(pk, { rpId: RP, origin: 'https://evil.example', challenge: opt.options.challenge, counter: 1, userHandle });
    r = await call(PAGE, 'POST', '/approve/api/recovery/verify', { enrollmentId: eid, challengeId: opt.challengeId, response: bad }, ph);
    ok(r.s >= 400, 'assertion for another origin refused', `${r.s} ${r.code}`);
    r = await call(PAGE, 'POST', '/approve/api/recovery/options', { enrollmentId: eid }, ph);
    const opt2 = r.j;
    const good = soft.assert(pk, { rpId: RP, origin: ORIGIN, challenge: opt2.options.challenge, counter: 1, userHandle });
    r = await call(PAGE, 'POST', '/approve/api/recovery/verify', { enrollmentId: eid, challengeId: opt2.challengeId, response: good }, ph);
    ok(r.s === 200 && r.j.approved === true, 'approver passkey -> recovery email approved', `${r.s} ${r.code} ${JSON.stringify(r.j)}`);
    r = await call(PAGE, 'POST', '/approve/api/recovery/verify', { enrollmentId: eid, challengeId: opt2.challengeId, response: good }, ph);
    ok(r.s >= 400, 'replayed approval refused', `${r.s} ${r.code}`);

    // ---- result
    const act = await q1(`SELECT c.status, c.recovery_eligible_at<=clock_timestamp() eligible, e.status est FROM warehouse_identity.recovery_contact_enrollments_v645 e
      JOIN warehouse_identity.user_recovery_contacts c USING(contact_id) WHERE e.enrollment_id=$1`, [eid]);
    ok(act.status === 'VERIFIED' && act.eligible && act.est === 'APPROVED', 'email VERIFIED, eligible, enrollment APPROVED', JSON.stringify(act));
    const ev = await q1(`SELECT count(*)::int n FROM warehouse_audit.security_events WHERE event_type='RECOVERY_CONTACT_APPROVED' AND details->>'enrollmentId'=$1`, [eid]);
    ok(ev.n === 1, 'security event written');
    r = await call(E, 'GET', '', undefined, emph);
    ok(r.s === 200 && r.j.active && /•/.test(r.j.active.email) && !r.j.pending, 'employee now sees the active recovery email (masked)', r.j.active?.email || '');
    const one = await q1(`SELECT count(*)::int n FROM warehouse_identity.user_recovery_contacts WHERE user_id=$1 AND contact_type='EMAIL' AND status='VERIFIED'`, [emp.user_id]);
    ok(one.n === 1, 'exactly one active recovery email for the employee', `count=${one.n}`);
  } catch (e) {
    fail++; console.log('FAIL stopped: ' + String(e && e.message || e).slice(0, 200));
  } finally {
    if (fx.session) await db.query(`UPDATE warehouse_identity.auth_sessions SET revoked_at=clock_timestamp() WHERE auth_session_id=$1 AND revoked_at IS NULL`, [fx.session]).catch(e => console.log('cleanup session: ' + e.message));
    if (fx.passkey) await db.query(`SELECT warehouse_identity.central_revoke_passkey_v1($1,$2,'enroll e2e test approver: test finished')`, [fx.passkey, fx.approver]).catch(e => console.log('cleanup passkey: ' + e.message));
    if (fx.approver) await db.query(`UPDATE warehouse_identity.user_role_assignments SET revoked_at=clock_timestamp(),revoked_by=$2 WHERE user_id=$1 AND revoked_at IS NULL`, [fx.approver, fx.admin]).catch(e => console.log('cleanup role: ' + e.message));
    if (fx.approver) await db.query(`UPDATE warehouse_identity.users SET status='DISABLED' WHERE user_id=$1`, [fx.approver]).catch(e => console.log('cleanup user: ' + e.message));
    if (fx.dev) await db.query(`UPDATE warehouse.devices SET status='RETIRED' WHERE device_id=$1`, [fx.dev]).catch(() => {});
    // earlier runs (before this fix) left a role assignment on disabled test approvers: revoke those too
    if (fx.admin) await db.query(`UPDATE warehouse_identity.user_role_assignments a SET revoked_at=clock_timestamp(),revoked_by=$1 FROM warehouse_identity.users u
      WHERE u.user_id=a.user_id AND u.username LIKE 'e2e.recovery.approver.%' AND a.revoked_at IS NULL`, [fx.admin]).catch(e => console.log('cleanup old roles: ' + e.message));
    console.log(`\nENROLL E2E RESULT: ${pass} passed, ${fail} failed${fx.session ? (fail ? ' (fixtures revoked)' : HUMAN ? ' (fixtures revoked; the email now waits for a real approver)' : ' (fixtures revoked; the approved recovery email stays on stg_employee_1)') : ''}`);
    await db.end(); process.exit(fail ? 1 : 0);
  }
})();
