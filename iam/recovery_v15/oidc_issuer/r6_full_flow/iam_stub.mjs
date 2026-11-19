// Local stand-in for the IAM side the issuer calls over mTLS (passkey begin/finish + the EOC bridge), answering the
// issuer's real contract (src/iam-verifier-client.mjs). Test only: it does not verify a real WebAuthn assertion.
import https from 'node:https';
import fs from 'node:fs';
import crypto from 'node:crypto';
const C = new URL('./certs/', import.meta.url);
const USER = '3e63e202-0000-4000-8000-000000000001';
const SUBJECT = crypto.createHash('sha256').update('flow-subject').digest('base64url');   // 43 chars, opaque
const calls = [];
const json = (res, s, o) => { res.writeHead(s, {'content-type': 'application/json'}); res.end(JSON.stringify(o)); };
https.createServer({key: fs.readFileSync(new URL('server.key', C)), cert: fs.readFileSync(new URL('server.pem', C)),
  ca: fs.readFileSync(new URL('ca.pem', C)), requestCert: true, rejectUnauthorized: true}, (req, res) => {
  let b = ''; req.on('data', x => b += x); req.on('end', () => {
    const body = b ? JSON.parse(b) : {}; calls.push(req.method + ' ' + req.url);
    if (req.url === '/calls') return json(res, 200, calls);
    if (req.url === '/internal/v1/iam/eoc/ready') return json(res, 200, {ready: true, epochAuthority: true, federationAuthority: true});
    if (req.url === '/internal/v1/iam/oidc/passkey/begin')
      return json(res, 200, {challengeId: crypto.randomUUID(), options: {challenge: crypto.randomBytes(32).toString('base64url'),
        rpId: 'login-stg.tcdsolutionsgroup.com', userVerification: 'required', allowCredentials: [], timeout: 120000}});
    if (req.url === '/internal/v1/iam/oidc/passkey/finish') {
      if (process.env.STUB_DENY === '1') return json(res, 403, {error: {code: 'CENTRAL_FEDERATION_DENIED'}});   // e.g. a passkey with no EOC binding
      const now = Math.floor(Date.now() / 1000);
      return json(res, 200, {verifier: 'TCDS_CENTRAL_IAM_WEBAUTHN', action: 'EOC_OIDC_LOGIN', issuer: body.issuer, requestId: body.requestId,
        challengeId: body.challengeId, interactionId: body.interactionId, subject: SUBJECT, userVerified: true, rpVerified: true,
        originVerified: true, counterOrBackupPolicyPassed: true, credentialActive: true, accountActive: true, bindingVerified: true,
        acr: 'urn:tcds:acr:phishing-resistant:uv', amr: ['webauthn', 'user_verification'], authTime: now, expiresAt: now + 60,
        evidenceId: crypto.randomUUID(), iamUserId: USER});
    }
    if (req.url === '/internal/v1/iam/eoc/federation/resolve') return json(res, 200, {verified: body.providerSubject === SUBJECT, userId: USER});
    if (req.url === '/internal/v1/iam/eoc/subject/' + USER) return json(res, 200, {userId: USER, active: true, epoch: 0, appointments: []});
    json(res, 404, {error: 'NOT_FOUND'});
  });
}).listen(9555, '127.0.0.1', () => console.log('iam stub on 9555'));
