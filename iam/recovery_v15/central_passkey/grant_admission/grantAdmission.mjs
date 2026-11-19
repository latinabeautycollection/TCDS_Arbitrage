// TCDS EOC grant admission (630). A separate loopback service holding the ONLY credentials that can write to the retail
// EOC database's grant path: the attestation writer (eoc_iam_verified_attestation_writer) and the grant admin
// (eoc_grant_admin_runtime). Neither the browser, login-v2-api nor the verifier holds them.
// Input: the attestations the central verifier signed after two approvers approved ONE grant set with their passkeys.
// 1. every attestation is admitted through the VENDOR's admission code, unchanged (vendor/approvalAdmission.mjs), which
//    verifies the Ed25519 envelope (issuer, audience, purpose, 5-minute window, ids, signature) before inserting it;
// 2. then, in ONE transaction, the VENDOR's 072 writer eoc_iam.create_governed_grant_v12 creates one grant per item from
//    the two approvers' attestations for that item (it checks them again and consumes them).
// Any failure leaves no grant (step 2 is one transaction); unconsumed attestations expire after 5 minutes by themselves.
import http from 'node:http';
import crypto from 'node:crypto';
import {makeApprovalAdmission} from './vendor/approvalAdmission.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HEX64 = /^[0-9a-f]{64}$/;
const MAX_BODY = 1024 * 1024;
const fail = (code, status = 400) => Object.assign(new Error(code), {code, status});
const sameItem = (e, i) => e.moduleId === i.moduleId && e.operation === i.operation && e.scopeKind === i.scopeKind
  && Array.isArray(e.scopeIds) && JSON.stringify(e.scopeIds) === JSON.stringify(i.scopeIds);

export function createGrantAdmission({writerPool, grantAdminPool, publicKeyPem, issuer, audience, secret, log = () => {}}) {
  if (!writerPool || !grantAdminPool || !publicKeyPem || !issuer || !audience || typeof secret !== 'string' || secret.length < 32)
    throw new Error('GRANT_ADMISSION_NOT_CONFIGURED');
  crypto.createPublicKey(publicKeyPem);

  function authenticate(req, raw) {
    const ts = req.headers['x-tcds-timestamp'], sig = req.headers['x-tcds-signature'];
    if (typeof ts !== 'string' || !/^\d{13}$/.test(ts) || Math.abs(Date.now() - Number(ts)) > 30_000 || typeof sig !== 'string') return false;
    const want = Buffer.from(crypto.createHmac('sha256', secret).update(ts + '.' + crypto.createHash('sha256').update(raw).digest('hex')).digest('base64url'));
    const got = Buffer.from(sig);
    return want.length === got.length && crypto.timingSafeEqual(want, got);
  }

  async function admitSet(b) {
    if (!b || !UUID.test(b.grantRequestId ?? '') || !UUID.test(b.targetUserId ?? '') || !HEX64.test(b.setSha256 ?? '')
      || !Number.isInteger(b.validDays) || b.validDays < 1 || b.validDays > 366
      || !Array.isArray(b.items) || b.items.length < 1 || b.items.length > 40 || !Array.isArray(b.approvals) || b.approvals.length !== 2)
      throw fail('GRANT_SET_INVALID');
    const [first, second] = b.approvals;
    const approvers = [first?.approverUserId, second?.approverUserId];
    if (!approvers.every(a => UUID.test(a ?? '')) || approvers[0] === approvers[1] || approvers.includes(b.targetUserId))
      throw fail('GRANT_APPROVERS_INVALID');
    for (const a of b.approvals) {
      if (!Array.isArray(a.attestations) || a.attestations.length !== b.items.length) throw fail('GRANT_ATTESTATIONS_INCOMPLETE');
      a.attestations.forEach((x, n) => {
        const e = x?.envelope;
        if (!e || e.approverUserId !== a.approverUserId || e.targetUserId !== b.targetUserId || e.requestId !== b.grantRequestId
          || e.purpose !== 'EOC_MODULE_GRANT_APPROVE' || !sameItem(e, b.items[n]) || e.verifierReference !== `central-1.0:${b.setSha256}:${e.webAuthnEvidenceId}`)
          throw fail('GRANT_ATTESTATION_MISMATCH');
      });
    }
    // The verifier already required the grant-approver role for both people (630 finalize); the vendor hook is held to
    // exactly these two approvers, this purpose and this person.
    const admit = makeApprovalAdmission({iamPool: null, retailPool: writerPool, publicKeyPem, issuer, audience,
      authorizeApprover: async (approver, purpose, target) => approvers.includes(approver) && purpose === 'EOC_MODULE_GRANT_APPROVE' && target === b.targetUserId});
    for (const a of b.approvals) for (const x of a.attestations) {
      try { await admit({envelope: x.envelope, signature: x.signature}); }
      catch (e) { throw fail(/^[A-Z_]{3,64}$/.test(String(e?.message)) ? e.message : 'ATTESTATION_NOT_ADMITTED', 403); }
    }
    const from = new Date(), until = new Date(from.getTime() + b.validDays * 86_400_000);
    const ref = `IAM_ATTESTED:${b.grantRequestId}:${b.setSha256}`;
    const c = await grantAdminPool.connect();
    try {
      await c.query('BEGIN');
      const ids = [];
      for (let n = 0; n < b.items.length; n++) {
        const i = b.items[n];
        const r = await c.query(`SELECT eoc_iam.create_governed_grant_v12($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) AS id`,
          [b.targetUserId, i.moduleId, i.operation, i.scopeKind, i.scopeIds, first.approverUserId, second.approverUserId,
           first.attestations[n].envelope.evidenceId, second.attestations[n].envelope.evidenceId, from, until, b.grantRequestId, ref]);
        ids.push(r.rows[0].id);
      }
      await c.query('COMMIT');
      return {grantIds: ids, validFrom: from.toISOString(), validUntil: until.toISOString()};
    } catch (e) {
      await c.query('ROLLBACK').catch(() => {});
      throw fail(/^[A-Z_]{3,64}$/.test(String(e?.message)) ? e.message : 'GRANT_WRITE_FAILED', 403);
    } finally { c.release(); }
  }

  return (req, res) => {
    const send = (s, o) => { if (!res.headersSent) res.writeHead(s, {'content-type': 'application/json', 'cache-control': 'no-store'}).end(JSON.stringify(o)); };
    if (req.method === 'GET' && req.url === '/ready') {
      Promise.all([writerPool.query('SELECT 1'), grantAdminPool.query('SELECT 1')]).then(() => send(200, {status: 'ready'}), () => send(503, {status: 'unavailable'}));
      return;
    }
    if (req.method !== 'POST' || req.url !== '/internal/v1/eoc/grants/admit') return send(404, {error: {code: 'NOT_FOUND'}});
    let raw = '', size = 0;
    req.setEncoding('utf8');
    req.on('data', x => { size += Buffer.byteLength(x); if (size > MAX_BODY) { send(413, {error: {code: 'REQUEST_TOO_LARGE'}}); req.destroy(); } else raw += x; });
    req.on('end', async () => {
      if (size > MAX_BODY) return;
      if (!authenticate(req, raw)) return send(401, {error: {code: 'WORKLOAD_AUTH_FAILED'}});
      let b; try { b = JSON.parse(raw); } catch { return send(400, {error: {code: 'REQUEST_INVALID'}}); }
      try {
        const out = await admitSet(b);
        log({level: 'info', msg: 'eoc grants created', grantRequestId: b.grantRequestId, grants: out.grantIds.length});
        send(200, out);
      } catch (e) {
        log({level: 'warn', msg: 'eoc grant admission refused', grantRequestId: b?.grantRequestId, code: e.code ?? 'FAILED'});
        send(e.status ?? 503, {error: {code: e.code ?? 'GRANT_ADMISSION_FAILED'}});
      }
    });
  };
}

// Service entry (start.cjs under PM2, or run directly): configuration from the environment, loopback only.
export async function main() {
  const {default: pg} = await import('pg');
  const fs = await import('node:fs');
  const e = process.env;
  const need = ['GRANT_ADMISSION_SECRET', 'APPROVAL_PUBLIC_KEY_PEM_FILE', 'APPROVAL_ISSUER', 'APPROVAL_AUDIENCE', 'EOC_DB_HOST', 'EOC_DB_CA_FILE',
    'ATTESTATION_WRITER_USER', 'ATTESTATION_WRITER_PASSWORD', 'GRANT_ADMIN_USER', 'GRANT_ADMIN_PASSWORD'];
  const missing = need.filter(k => !e[k]);
  if (missing.length) { console.error(JSON.stringify({level: 'fatal', msg: 'config incomplete', missing})); process.exit(1); }
  const ssl = {ca: fs.readFileSync(e.EOC_DB_CA_FILE, 'utf8'), rejectUnauthorized: true};
  const pool = (user, password) => new pg.Pool({host: e.EOC_DB_HOST, port: Number(e.EOC_DB_PORT ?? 5432), database: e.EOC_DB_NAME ?? 'postgres',
    user, password, ssl, max: 2, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 8_000, application_name: 'tcds-eoc-grant-admission'});
  const handler = createGrantAdmission({writerPool: pool(e.ATTESTATION_WRITER_USER, e.ATTESTATION_WRITER_PASSWORD),
    grantAdminPool: pool(e.GRANT_ADMIN_USER, e.GRANT_ADMIN_PASSWORD), publicKeyPem: fs.readFileSync(e.APPROVAL_PUBLIC_KEY_PEM_FILE, 'utf8'),
    issuer: e.APPROVAL_ISSUER, audience: e.APPROVAL_AUDIENCE, secret: e.GRANT_ADMISSION_SECRET, log: o => console.log(JSON.stringify(o))});
  const port = Number(e.GRANT_ADMISSION_PORT ?? 8403);
  http.createServer(handler).listen(port, '127.0.0.1', () => console.log(JSON.stringify({level: 'info', msg: 'eoc grant admission listening', port})));
}
if (import.meta.url === `file://${process.argv[1]}`) await main();
