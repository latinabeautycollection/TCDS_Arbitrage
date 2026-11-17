#!/usr/bin/env node
// identity-api-host.cjs — runs the 6.1B Login V2 API as its own process (not inside arb-api).
//   LOGINV2_CONFIG=/path/config.json LOGINV2_6_1B=/path/to/built/6.1B node identity-api-host.cjs
// nginx sends /api/v1/auth and /api/v1/iam to it; it listens on 127.0.0.1 only.
// packship_routes_v16: also /api/v1/packing and /api/v1/shipments, mounted ONLY when config.json has packship.DATABASE_URL.
const fs = require('node:fs'), path = require('node:path');
const cfg = JSON.parse(fs.readFileSync(process.env.LOGINV2_CONFIG, 'utf8'));
Object.assign(process.env, cfg.api);
const B = process.env.LOGINV2_6_1B;
const req = m => require(path.join(B, 'node_modules', m));
const express = req('express'), { Pool } = req('pg');
const { loadEnv } = require(path.join(B, 'dist/config/env'));
const { installWarehouseIdentity } = require(path.join(B, 'dist/express/integration'));
const { IdentityError, RateLimitError } = require(path.join(B, 'dist/errors/errors'));

(async () => {
  const env = loadEnv();
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', env.TRUSTED_PROXY_CIDRS.split(',').map(s => s.trim()));   // client IP from nginx only
  app.use(express.json({ limit: '64kb' }));
  const pool = new Pool({ connectionString: env.DATABASE_URL, max: 10, idleTimeoutMillis: 30000 });
  pool.on('error', e => console.error(JSON.stringify({ level: 'error', msg: 'pg pool error', error: e.message })));

  const handle = await installWarehouseIdentity(app, {
    pool, env,
    verifier: {
      webauthnBaseUrl: env.WEBAUTHN_VERIFIER_URL, deviceBaseUrl: env.DEVICE_VERIFIER_URL,
      webauthnSecret: cfg.hostVerifierClient.webauthnSecret, deviceSecret: cfg.hostVerifierClient.deviceSecret,
      resultPublicKeyPem: cfg.hostVerifierClient.resultPublicKeyPem
    }
  });

  // Pack/Ship routes (packship_routes_v16). Same guards as /api/v1/auth (6.1B security.ts), own pool on
  // tcds_login_packship (member of tcds_packship_api only). Off unless config.json has packship.DATABASE_URL.
  let packShipPool = null;
  if (cfg.packship && cfg.packship.DATABASE_URL) {
    const { mountPackShipOnLoginV2 } = require(path.join(__dirname, '..', 'packship', 'dist', 'mount', 'loginV2PackShipMount.js'));
    packShipPool = new Pool({ connectionString: cfg.packship.DATABASE_URL, max: 5, idleTimeoutMillis: 30000 });
    packShipPool.on('error', e => console.error(JSON.stringify({ level: 'error', msg: 'packship pg pool error', error: e.message })));
    mountPackShipOnLoginV2(app, {
      identityPool: pool, packShipPool,
      sessionHashKey: env.SESSION_HASH_KEY, csrfHashKey: env.CSRF_HASH_KEY, publicOrigin: env.PUBLIC_APP_ORIGIN,
      security: require(path.join(B, 'dist/express/security'))
    });
    console.log(JSON.stringify({ level: 'info', msg: 'packship routes mounted', paths: ['/api/v1/packing', '/api/v1/shipments'] }));
  }

  app.use((_req, res) => res.status(404).json({ error: { code: 'NOT_FOUND' } }));
  // 6.1B throws typed errors but ships no handler; without this every rejection would be Express's HTML page.
  app.use((err, req, res, _next) => {
    if (res.headersSent) return;
    if (err && err.name === 'ZodError') return res.status(400).json({ error: { code: 'REQUEST_INVALID' } });
    if (err && err.type === 'entity.parse.failed') return res.status(400).json({ error: { code: 'REQUEST_INVALID' } });
    if (err instanceof RateLimitError) {
      res.set('Retry-After', String(Math.max(1, Math.ceil((err.retryAfterMs || 1000) / 1000))));
      return res.status(429).json({ error: { code: 'RATE_LIMITED' } });
    }
    if (err instanceof IdentityError) return res.status(err.statusCode).json({ error: { code: err.code } });
    // Verifier outcomes (patched 6.1B verifierClient, R11-16): refusal 403, outage 503, untrustworthy result 502.
    const VERIFIER = { VERIFIER_REJECTED: 403, VERIFIER_UNAVAILABLE: 503, VERIFIER_RESULT_INVALID: 502, VERIFIER_RESULT_SIGNATURE_INVALID: 502 };
    if (err && VERIFIER[err.message]) return res.status(VERIFIER[err.message]).json({ error: { code: err.message } });
    // Deliberate rejections raised by the Login V2 database functions carry an UPPER_CASE code as their message.
    const pgCode = err && typeof err.code === 'string' && /^[0-9A-Z]{5}$/.test(err.code) ? err.code : null;
    const token = err && typeof err.message === 'string' && /^[A-Z][A-Z0-9_]{2,63}(:[A-Z0-9_]{1,63})?$/.test(err.message)
      ? err.message.split(':')[0] : null;
    if (pgCode && token) {
      const status = pgCode === '28000' ? 401 : pgCode === '42501' ? 403 : pgCode === '40001' || pgCode === '55P03' ? 409
                   : pgCode.startsWith('22') || pgCode.startsWith('23') ? 400 : pgCode === 'P0002' ? 404 : 409;
      return res.status(status).json({ error: { code: token } });
    }
    console.error(JSON.stringify({ level: 'error', msg: 'unhandled', route: req.path, requestId: req.requestId,
                                   error: err && err.message }));
    return res.status(500).json({ error: { code: 'INTERNAL_ERROR' } });
  });

  const server = app.listen(Number(env.PORT), env.HOST,
    () => console.log(JSON.stringify({ level: 'info', msg: 'login v2 identity api listening', port: env.PORT })));
  const stop = async () => {
    server.close(); await handle.close().catch(() => {}); await pool.end().catch(() => {});
    if (packShipPool) await packShipPool.end().catch(() => {});
    process.exit(0);
  };
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
})().catch(e => { console.error(JSON.stringify({ level: 'fatal', msg: 'startup failed', error: e.message })); process.exit(1); });
