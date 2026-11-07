'use strict';
// STAGING. EOC (acquisition server) -> Warehouse IAM mTLS proxy. TLS terminates here; only /internal/v1/iam/eoc/* is
// forwarded, unchanged, to the private internal IAM listener on 127.0.0.1 (the bridge still checks its own HMAC + nonce).
// A client is admitted only if ALL hold: source IP allowlisted, certificate chains to our private CA (checked in the
// handshake), EKU clientAuth, exact CN + single SAN URI identity, and its SHA-256 fingerprint is listed in
// allowed_clients.txt (re-read per request; deleting the line revokes the certificate without a restart).
const https = require('node:https');
const http = require('node:http');
const fs = require('node:fs');

const C = JSON.parse(fs.readFileSync(process.env.EOC_MTLS_CONFIG, 'utf8'));
const PREFIX = '/internal/v1/iam/eoc/';
const MAX_BODY = 4096;
const FORWARD = ['content-type', 'content-length', 'accept', 'x-request-id',
  'x-eoc-workload-timestamp', 'x-eoc-workload-nonce', 'x-eoc-workload-signature'];
const CLIENT_AUTH = '1.3.6.1.5.5.7.3.2';

const log = o => console.log(JSON.stringify({ ts: new Date().toISOString(), ...o }));
const ipOf = s => (s.remoteAddress || '').replace(/^::ffff:/, '');
function allowed() {
  try {
    return new Set(fs.readFileSync(C.allowedClients, 'utf8').split('\n').map(l => l.trim().toUpperCase())
      .filter(l => /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(l)));
  } catch { return new Set(); }
}
function identityProblem(cert) {
  if (!cert || !cert.subject) return 'NO_CERT';
  if (cert.subject.CN !== C.identity.cn) return 'CN';
  if ((cert.subjectaltname || '') !== 'URI:' + C.identity.uri) return 'SAN';
  if (!(cert.ext_key_usage || []).includes(CLIENT_AUTH)) return 'EKU';
  if (!allowed().has(cert.fingerprint256)) return 'NOT_ALLOWLISTED';
  return null;
}

const server = https.createServer({
  key: fs.readFileSync(C.serverKey), cert: fs.readFileSync(C.serverCert), ca: fs.readFileSync(C.caCert),
  requestCert: true, rejectUnauthorized: true, minVersion: 'TLSv1.3',
}, (req, res) => {
  const sock = req.socket, ip = ipOf(sock);
  const deny = (status, code) => {
    if (!res.headersSent) res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
      .end(JSON.stringify({ error: code }));
  };
  const cert = sock.getPeerCertificate();
  const problem = identityProblem(cert);
  if (problem) { log({ event: 'CLIENT_DENIED', reason: problem, ip, cn: cert?.subject?.CN }); return deny(403, 'CLIENT_NOT_AUTHORIZED'); }
  if (!['GET', 'POST'].includes(req.method) || !req.url.startsWith(PREFIX)) return deny(404, 'NOT_FOUND');
  if (Number(req.headers['content-length'] || 0) > MAX_BODY) return deny(413, 'REQUEST_TOO_LARGE');
  const headers = {};
  for (const h of FORWARD) if (req.headers[h] !== undefined) headers[h] = req.headers[h];
  const started = Date.now();
  const up = http.request({ host: '127.0.0.1', port: C.upstreamPort, method: req.method, path: req.url, headers, timeout: 5000 }, r => {
    res.writeHead(r.statusCode, { 'content-type': r.headers['content-type'] || 'application/json', 'cache-control': 'no-store' });
    r.pipe(res);
    log({ event: 'FORWARDED', ip, method: req.method, path: req.url.split('?')[0], status: r.statusCode, ms: Date.now() - started });
  });
  up.on('timeout', () => up.destroy(new Error('UPSTREAM_TIMEOUT')));
  up.on('error', e => { log({ event: 'UPSTREAM_ERROR', error: e.message }); if (res.headersSent) res.destroy(); else deny(502, 'IAM_UPSTREAM_UNAVAILABLE'); });
  let size = 0;
  req.on('data', c => { size += c.length; if (size > MAX_BODY) { up.destroy(); deny(413, 'REQUEST_TOO_LARGE'); req.destroy(); } });
  req.pipe(up);
});
server.on('connection', s => { if (!C.allowIps.includes(ipOf(s))) { log({ event: 'IP_DENIED', ip: ipOf(s) }); s.destroy(); } });
server.on('tlsClientError', (e, s) => log({ event: 'TLS_REJECTED', ip: ipOf(s), error: e.code || e.message }));
server.headersTimeout = 10000;
server.requestTimeout = 15000;
server.listen(C.port, C.listenHost, () => log({ event: 'LISTENING', host: C.listenHost, port: C.port, upstream: C.upstreamPort }));
