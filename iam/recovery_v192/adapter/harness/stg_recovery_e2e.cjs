#!/usr/bin/env node
// STAGING ONLY end-to-end test of warehouse password recovery V1.9.2 against login-v2-api-staging (127.0.0.1:8195).
// Fixtures (as postgres on the staging DB): a test device + AAL2 session + software passkey for stg_approver_1, and a
// verified recovery email for stg_employee_1. Then the real HTTP flow:
//   request -> admin queue/review -> passkey step-up -> approve -> worker issues + delivers the code -> invitation ->
//   binding -> wrong code -> weak password -> new password -> replay checks -> database checks.
// Delivery: capture mode reads the code from RECOVERY_CAPTURE_FILE; graph mode asks you to paste the link and code.
// Prints no secrets except the test code it just used. The new stg_employee_1 password goes to a 0600 file.
'use strict';
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), readline = require('node:readline');
const CFG = JSON.parse(fs.readFileSync(process.env.LOGINV2_CONFIG, 'utf8')).api;
const APP = process.env.LOGINV2_6_1B, STATE = process.env.RECOVERY_STATE;
const { Pool } = require(path.join(APP, 'node_modules', 'pg'));
const soft = require('./softPasskey.cjs');
const BASE = 'http://127.0.0.1:' + CFG.PORT + '/api/v1/auth';
const ORIGIN = CFG.PUBLIC_APP_ORIGIN, RP = CFG.PASSKEY_RP_ID;
const TO = process.env.TO || 'recovery-e2e@invalid.test';
const H = (v, k) => crypto.createHmac('sha256', k).update(v).digest();
const ikm = Buffer.from(CFG.RECOVERY_MASTER_KEY, 'hex');
const key = l => Buffer.from(crypto.hkdfSync('sha256', ikm, Buffer.from('tcds-warehouse-recovery-v192'), Buffer.from(l), 32));
const hmacL = (k, label, v) => crypto.createHmac('sha256', k).update(label).update('\0').update(v).digest();
const db = new Pool({ ssl: { rejectUnauthorized: false }, max: 2 });   // PG* env = staging postgres (test fixtures only)
let pass = 0, fail = 0; const ok = (c, m, d = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'} ${m}${d ? ' | ' + d : ''}`); };
const q1 = async (sql, p) => (await db.query(sql, p)).rows[0];

async function http(method, p, body, h = {}) {
  const r = await fetch(BASE + p, { method, headers: { origin: ORIGIN, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json',
    'x-request-id': crypto.randomUUID(), 'x-correlation-id': crypto.randomUUID(), ...h }, body: body === undefined ? undefined : JSON.stringify(body) });
  let j = {}; try { j = await r.json(); } catch {}
  return { s: r.status, j, code: j.error ? j.error.code : '', cookie: r.headers.get('set-cookie') };
}
const ask = q => new Promise(res => { const rl = readline.createInterface({ input: process.stdin, output: process.stdout }); rl.question(q, a => { rl.close(); res(a.trim()); }); });

(async () => {
  const fx = {};
  try {
    console.log(`== target ${BASE} | delivery ${CFG.RECOVERY_DELIVERY_MODE} | recovery enabled ${CFG.RECOVERY_ENABLED}/${CFG.RECOVERY_WORKERS_ENABLED}`);
    if (String(CFG.RECOVERY_ENABLED) !== 'true' || String(CFG.RECOVERY_WORKERS_ENABLED) !== 'true') throw new Error('enable recovery + workers first');
    const emp = await q1(`SELECT u.user_id, e.facility_id FROM warehouse_identity.users u JOIN warehouse_identity.employees e USING(user_id) WHERE u.normalized_username='stg_employee_1'`);
    const apr = await q1(`SELECT u.user_id, e.employee_id FROM warehouse_identity.users u JOIN warehouse_identity.employees e USING(user_id) WHERE u.normalized_username='stg_approver_1'`);
    if (!emp || !apr) throw new Error('stg_employee_1 / stg_approver_1 missing on staging');
    const perm = await q1(`SELECT EXISTS(SELECT 1 FROM warehouse_identity.user_role_assignments a JOIN warehouse_identity.roles r ON r.role_id=a.role_id
      WHERE a.user_id=$1 AND a.facility_id=$2 AND a.revoked_at IS NULL AND (a.valid_until IS NULL OR a.valid_until>now()) AND r.active
        AND 'warehouse:identity:password:reset_approve'=ANY(r.permissions)) ok`, [apr.user_id, emp.facility_id]);
    ok(perm.ok, 'approver holds reset_approve at the employee facility');

    // ---- fixtures (first revoke anything an earlier run left behind)
    fx.approver = apr.user_id;
    const stale = await db.query(`UPDATE warehouse_identity.passkeys p SET security_state='REVOKED',revoked_at=clock_timestamp(),revoked_by=$1
      FROM warehouse.devices d WHERE d.device_id=p.enrolled_device_id AND d.device_name='recov192-e2e-device' AND p.revoked_at IS NULL RETURNING p.passkey_id`, [apr.user_id]);
    if (stale.rowCount) console.log(`   revoked ${stale.rowCount} test passkey(s) left by an earlier run`);
    await db.query(`UPDATE warehouse_identity.password_reset_requests SET created_at=created_at-interval '25 hours'
      WHERE user_id=$1 AND request_type='SELF_SERVICE' AND created_at>now()-interval '24 hours'`, [emp.user_id]);
    fx.dev = (await q1(`INSERT INTO warehouse.devices(facility_id,device_type,status,device_name,serial_number,hardware_fingerprint)
      VALUES($1,'PWA_DESKTOP','ACTIVE','recov192-e2e-device','recov192-e2e-'||gen_random_uuid(),'recov192-e2e-'||gen_random_uuid()) RETURNING device_id`, [emp.facility_id])).device_id;
    const token = crypto.randomBytes(32).toString('base64url'), csrf = crypto.randomBytes(32).toString('base64url');
    fx.session = (await q1(`WITH ds AS (INSERT INTO warehouse.device_sessions(device_id,user_id,employee_number,started_at,last_activity_at,network_state)
        SELECT $1,$2,e.employee_number,statement_timestamp(),statement_timestamp(),'{"fixture":"recov192"}'::jsonb FROM warehouse_identity.employees e WHERE e.user_id=$2 RETURNING session_id)
      INSERT INTO warehouse_identity.auth_sessions(user_id,employee_id,device_id,warehouse_device_session_id,authentication_method,assurance_level,token_hash,
        csrf_token_hash,issued_at,last_activity_at,idle_expires_at,absolute_expires_at,request_id,correlation_id)
      SELECT $2,$3,$1,ds.session_id,'PASSKEY','AAL2',$4,$5,statement_timestamp(),statement_timestamp(),statement_timestamp()+interval '29 minutes',
        statement_timestamp()+interval '7 hours',gen_random_uuid(),gen_random_uuid() FROM ds RETURNING auth_session_id`,
      [fx.dev, apr.user_id, apr.employee_id, H(token, CFG.SESSION_HASH_KEY), H(csrf, CFG.CSRF_HASH_KEY)])).auth_session_id;
    const pk = soft.create();
    fx.passkey = (await q1(`INSERT INTO warehouse_identity.passkeys(user_id,credential_id,public_key,public_key_algorithm,enrolled_device_id,security_state)
      VALUES($1,$2,$3,-7,$4,'ACTIVE') RETURNING passkey_id`, [apr.user_id, pk.credentialId, pk.cosePublicKey, fx.dev])).passkey_id;
    if (process.env.USE_EXISTING_CONTACT === '1') {
      // Use the recovery email the employee enrolled and an approver approved (645), instead of planting one.
      const ex = await q1(`SELECT count(*)::int n FROM warehouse_identity.user_recovery_contacts WHERE user_id=$1 AND contact_type='EMAIL'
        AND status='VERIFIED' AND revoked_at IS NULL AND recovery_eligible_at<=clock_timestamp()`, [emp.user_id]);
      ok(ex.n === 1, 'employee has exactly one approved, eligible recovery email (enrolled through 645)', `count=${ex.n}`);
      if (ex.n !== 1) throw new Error('no enrolled recovery email - run e2e-enroll first');
      console.log('   fixtures: device, AAL2 session, software passkey (approver); recovery email = the one enrolled through 645');
    } else {
    const c = (() => { const iv = crypto.randomBytes(12), ci = crypto.createCipheriv('aes-256-gcm', key('contact'), iv);
      const ct = Buffer.concat([ci.update(TO), ci.final()]); return { ct, iv, tag: ci.getAuthTag() }; })();
    fx.contact = (await q1(`INSERT INTO warehouse_identity.user_recovery_contacts(user_id,contact_type,ciphertext,iv,tag,value_fingerprint,status,
        verification_method,verified_at,recovery_eligible_at,created_at)
      VALUES($1,'EMAIL',$2,$3,$4,$5,'VERIFIED','SUPERVISED',clock_timestamp(),clock_timestamp()-interval '1 minute',clock_timestamp()-interval '2 minutes') RETURNING contact_id`,
      [emp.user_id, c.ct, c.iv, c.tag, hmacL(key('contact-fingerprint'), 'contact', TO.toLowerCase())])).contact_id;
    console.log('   fixtures: device, AAL2 session, software passkey (approver), verified recovery email (employee)');
    }
    const admin = { cookie: `__Host-tcds_session=${token}; __Host-tcds_csrf=${csrf}`, 'x-csrf-token': csrf };
    const before = await q1(`SELECT password_hash h FROM warehouse_identity.password_credentials WHERE user_id=$1`, [emp.user_id]);
    const epochBefore = (await q1(`SELECT epoch FROM warehouse_identity.iam_session_epoch_status_v15($1)`, [emp.user_id]))?.epoch;

    // ---- employee asks for help
    let r = await http('POST', '/password-recovery/request', { identifier: 'stg_employee_1', reason: 'FORGOT_PASSWORD', details: 'recov192 e2e' });
    ok(r.s === 202, 'request -> 202', `${r.s} ${r.code}`);
    const reqRow = await q1(`SELECT password_reset_request_id id, row_version::text rv FROM warehouse_identity.password_reset_requests
      WHERE user_id=$1 AND status='REQUESTED' ORDER BY created_at DESC LIMIT 1`, [emp.user_id]);
    ok(!!reqRow, 'request row REQUESTED in the database');
    const unknown = await http('POST', '/password-recovery/request', { identifier: 'no_such_user_e2e', reason: 'FORGOT_PASSWORD' });
    ok(unknown.s === 202 && JSON.stringify(unknown.j) === JSON.stringify(r.j), 'unknown account gets the identical 202');

    // ---- administrator
    r = await http('GET', '/password-recovery/admin/pending?limit=50', undefined, admin);
    const item = (r.j.items || []).find(x => x.requestId === reqRow.id);
    ok(r.s === 200 && item && item.expectedRowVersion === reqRow.rv, 'admin queue lists the request with expectedRowVersion', `${r.s} ${r.code}`);
    r = await http('GET', `/password-recovery/admin/review/${reqRow.id}`, undefined, admin);
    ok(r.s === 200 && r.j.requestId === reqRow.id, 'admin review', `${r.s} ${r.code}`);
    r = await http('POST', '/password-recovery/admin/approve', { requestId: reqRow.id, expectedRowVersion: reqRow.rv, decision: 'APPROVE_RESET' }, admin);
    ok(r.s === 403 && r.code === 'FRESH_STEP_UP_REQUIRED', 'approve without passkey -> FRESH_STEP_UP_REQUIRED', `${r.s} ${r.code}`);
    r = await http('POST', '/password-recovery/admin/approve', { requestId: reqRow.id, expectedRowVersion: reqRow.rv, decision: 'REJECT' }, admin);
    ok(r.s === 422, 'REJECT is not turned into an approval -> 422', `${r.s} ${r.code}`);
    const noCsrf = await http('POST', `/password-recovery/admin/step-up/${reqRow.id}`, {}, { cookie: admin.cookie });
    ok(noCsrf.s === 403 && noCsrf.code === 'CSRF_REJECTED', 'admin POST without CSRF header -> CSRF_REJECTED', `${noCsrf.s} ${noCsrf.code}`);
    r = await http('POST', `/password-recovery/admin/step-up/${reqRow.id}`, {}, admin);
    ok(r.s === 200 && r.j.options && r.j.options.challenge, 'passkey step-up options', `${r.s} ${r.code}`);
    const stepup = r.j;
    const bad = soft.assert(pk, { rpId: RP, origin: 'https://evil.example', challenge: stepup.options.challenge, counter: 1 });
    r = await http('POST', '/password-recovery/admin/approve', { requestId: reqRow.id, expectedRowVersion: reqRow.rv, decision: 'APPROVE_RESET', challengeId: stepup.challengeId, passkeyResponse: bad }, admin);
    ok(r.s === 403 && r.code === 'STEPUP_SIGNATURE_INVALID', 'assertion for another origin refused', `${r.s} ${r.code}`);
    const good = soft.assert(pk, { rpId: RP, origin: ORIGIN, challenge: stepup.options.challenge, counter: 1 });
    r = await http('POST', '/password-recovery/admin/approve', { requestId: reqRow.id, expectedRowVersion: reqRow.rv, decision: 'APPROVE_RESET', challengeId: stepup.challengeId, passkeyResponse: good }, admin);
    ok(r.s === 200 && r.j.status === 'TOKEN_ISSUED', 'approve with passkey -> TOKEN_ISSUED', `${r.s} ${r.code}`);
    const t0 = Date.now();
    r = await http('POST', '/password-recovery/admin/approve', { requestId: reqRow.id, expectedRowVersion: reqRow.rv, decision: 'APPROVE_RESET', challengeId: stepup.challengeId, passkeyResponse: good }, admin);
    ok(r.s >= 400, 'replayed passkey assertion refused', `${r.s} ${r.code}`);

    // ---- worker: code issued + delivered
    let msg = null;
    if (CFG.RECOVERY_DELIVERY_MODE === 'capture') {
      for (let i = 0; i < 40 && !msg; i++) {
        await new Promise(res => setTimeout(res, 1000));
        const lines = fs.existsSync(CFG.RECOVERY_CAPTURE_FILE) ? fs.readFileSync(CFG.RECOVERY_CAPTURE_FILE, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
        msg = lines.reverse().find(m => m.to === TO && (m.kind === undefined || m.kind === 'RESET_CODE') && Date.parse(m.at) >= t0 - 2000) || null;
      }
    } else {
      console.log(`   an email was sent to ${TO}.`);
      // Several emails can sit in the same inbox (enrollment code, approver notice, reset code): only the reset link fits here.
      let link = '';
      for (let i = 0; i < 3; i++) {
        link = await ask('   paste the link from the "TCDS Warehouse password recovery code" email (it contains /auth/recovery/new-password?ref=): ');
        if (link.startsWith(CFG.RECOVERY_LINK_BASE + '?ref=')) break;
        console.log('   that is not the reset link (an approval link has /approve/recovery/?e=); try again');
      }
      const code = await ask('   type the 8-digit code from the same email: ');
      msg = { link, code };
    }
    ok(!!msg && /^\d{8}$/.test(msg.code), 'code delivered by the worker', msg ? `after ${Math.round((Date.now() - t0) / 1000)}s` : 'none within 40s');
    if (!msg) throw new Error('no code delivered');
    const out = await q1(`SELECT o.status, o.encrypted_payload IS NULL scrubbed, r.status req FROM warehouse_identity.recovery_secret_outbox_v18 o
      JOIN warehouse_identity.recovery_contact_challenges_v1 c ON c.challenge_id=o.challenge_id JOIN warehouse_identity.password_reset_requests r
      ON r.password_reset_request_id=c.reset_request_id WHERE c.reset_request_id=$1 ORDER BY o.created_at DESC LIMIT 1`, [reqRow.id]);
    ok(out && out.status === 'ACCEPTED' && out.scrubbed && out.req === 'TOKEN_ISSUED', 'outbox ACCEPTED + payload scrubbed; reset TOKEN_ISSUED', JSON.stringify(out));
    const ref = new URL(msg.link).searchParams.get('ref');
    ok(msg.link.startsWith(CFG.RECOVERY_LINK_BASE + '?ref='), 'link points at the PWA new-password page');

    // ---- employee completes
    r = await http('GET', `/password-recovery/invitation/context?ref=${encodeURIComponent(ref)}`);
    ok(r.s === 200 && r.j.publicReference === ref && !r.j.requestId, 'invitation resolves (no internal id exposed)', `${r.s}`);
    r = await http('POST', '/password-recovery/binding', { reference: ref });
    const rc = (r.cookie || '').split(';')[0];
    ok(r.s === 204 && /^__Host-tcds_recovery=/.test(rc) && /HttpOnly/i.test(r.cookie) && /SameSite=Strict/i.test(r.cookie), 'browser binding cookie set', `${r.s}`);
    const wrong = msg.code === '00000000' ? '11111111' : '00000000';
    r = await http('POST', '/password-recovery/complete', { reference: ref, code: wrong, newPassword: 'x' }, { cookie: rc });
    ok(r.s === 403 && r.code === 'OTP_INVALID', 'wrong code refused', `${r.s} ${r.code}`);
    r = await http('POST', '/password-recovery/complete', { reference: ref, code: msg.code, newPassword: 'password' }, { cookie: rc });
    ok(r.s === 400, 'weak password refused by the 6.1B policy (code already verified)', `${r.s} ${r.code}`);
    const newPassword = crypto.randomBytes(18).toString('base64url') + 'Aa9!';
    r = await http('POST', '/password-recovery/complete', { reference: ref, newPassword }, { cookie: rc });
    ok(r.s === 200 && r.j.completed === true, 'new password accepted without re-entering the code', `${r.s} ${r.code}`);
    if (r.s === 200) { fs.writeFileSync(path.join(STATE, 'stg_employee_1.password'), newPassword + '\n', { mode: 0o600 }); }

    // ---- replay + database truth
    r = await http('POST', '/password-recovery/complete', { reference: ref, newPassword: newPassword + 'x' }, { cookie: rc });
    ok(r.s >= 400, 'replay of the finished recovery refused', `${r.s} ${r.code}`);
    r = await http('GET', `/password-recovery/invitation/context?ref=${encodeURIComponent(ref)}`);
    ok(r.s === 404, 'invitation link dead after use', `${r.s}`);
    const after = await q1(`SELECT r.status, (SELECT password_hash FROM warehouse_identity.password_credentials WHERE user_id=$2) h,
      (SELECT count(*) FROM warehouse_identity.recovery_proofs_v1 p WHERE p.reset_request_id=$1 AND p.consumed_at IS NOT NULL) used
      FROM warehouse_identity.password_reset_requests r WHERE r.password_reset_request_id=$1`, [reqRow.id, emp.user_id]);
    ok(after.status === 'COMPLETED', 'reset COMPLETED', after.status);
    ok(before && after.h && before.h !== after.h, 'password hash changed');
    ok(Number(after.used) === 1, 'exactly one OTP proof consumed');
    const epochAfter = (await q1(`SELECT epoch FROM warehouse_identity.iam_session_epoch_status_v15($1)`, [emp.user_id]))?.epoch;
    ok(Number(epochAfter) === Number(epochBefore) + 1, 'session epoch advanced by one (EOC/session invalidation)', `${epochBefore} -> ${epochAfter}`);
    r = await http('POST', '/password-recovery/request', { identifier: 'stg_employee_1', reason: 'FORGOT_PASSWORD' });
    const again = await q1(`SELECT count(*) n FROM warehouse_identity.password_reset_requests WHERE user_id=$1 AND status='REQUESTED'`, [emp.user_id]);
    ok(r.s === 202 && Number(again.n) === 0, 'second request within 24h: same 202, no new request (limit hidden)', `${r.s} requested=${again.n}`);
  } catch (e) {
    fail++; console.log('FAIL stopped: ' + String(e && e.message || e).slice(0, 200));
  } finally {
    // revoke (not delete) the fixtures; recovery rows stay as the audit trail
    if (fx.session) await db.query(`UPDATE warehouse_identity.auth_sessions SET revoked_at=clock_timestamp() WHERE auth_session_id=$1 AND revoked_at IS NULL`, [fx.session]).catch(e => console.log('cleanup session: ' + e.message));
    if (fx.passkey) await db.query(`UPDATE warehouse_identity.passkeys SET security_state='REVOKED',revoked_at=clock_timestamp(),revoked_by=$2 WHERE passkey_id=$1`, [fx.passkey, fx.approver]).catch(e => console.log('cleanup passkey: ' + e.message));
    if (fx.contact) await db.query(`UPDATE warehouse_identity.user_recovery_contacts SET status='REVOKED',revoked_at=clock_timestamp() WHERE contact_id=$1`, [fx.contact]).catch(e => console.log('cleanup contact: ' + e.message));
    if (fx.dev) await db.query(`UPDATE warehouse.devices SET status='RETIRED' WHERE device_id=$1`, [fx.dev]).catch(() => {});
    console.log(`\nE2E RESULT: ${pass} passed, ${fail} failed${fx.session ? ' (fixtures revoked)' : ''}`);
    await db.end(); process.exit(fail ? 1 : 0);
  }
})();
