// Drives one complete EOC sign-in through the REAL issuer (src/server.mjs + oidc-provider), as the browser and the EOC
// BFF would: /auth -> interaction page -> options -> complete (form POST) -> resume -> callback code -> /token.
import crypto from 'node:crypto';
import fs from 'node:fs';
const BASE = 'http://127.0.0.1:18401', HOST = 'login-stg.tcdsolutionsgroup.com', ISS = 'https://' + HOST;
const env = JSON.parse(fs.readFileSync(new URL('./secrets/env.json', import.meta.url), 'utf8'));
import http from 'node:http';
const jar = new Map();
const keep = h => { for (const c of [].concat(h['set-cookie'] ?? [])) { const [nv] = c.split(';'); const i = nv.indexOf('=');
  const n = nv.slice(0, i), v = nv.slice(i + 1); if (/max-age=0|expires=thu, 01 jan 1970/i.test(c) || v === '') jar.delete(n); else jar.set(n, v); } };
const cookie = () => [...jar].map(([n, v]) => n + '=' + v).join('; ');
function go(path, {method = 'GET', body, headers = {}, cookies = true} = {}) {
  return new Promise((resolve, reject) => {
    const h = {host: HOST, 'x-forwarded-proto': 'https', 'x-forwarded-for': '127.0.0.1', ...(cookies && jar.size ? {cookie: cookie()} : {}), ...headers};
    if (body) h['content-length'] = Buffer.byteLength(body);
    const req = http.request(BASE + path, {method, headers: h}, res => { let t = ''; res.setEncoding('utf8'); res.on('data', x => t += x);
      res.on('end', () => { keep(res.headers); resolve({status: res.statusCode, location: res.headers.location ?? null, text: t, rp: res.headers['referrer-policy'] ?? '', csp: res.headers['content-security-policy'] ?? ''}); }); });
    req.on('error', reject); req.end(body);
  });
}
const local = loc => { const u = new URL(loc, ISS); if (u.host !== HOST) return null; return u.pathname + u.search; };
const step = (n, r) => console.log(`${n}: ${r.status}${r.location ? ' -> ' + r.location.replace(/(code|state|nonce|code_challenge)=[^&]+/g, '$1=…') : ''}${r.status >= 400 ? '  ' + r.text.slice(0, 160) : ''}`);

const verifier = crypto.randomBytes(32).toString('base64url');
const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
const state = crypto.randomBytes(16).toString('base64url'), nonce = crypto.randomBytes(16).toString('base64url');
const q = new URLSearchParams({client_id: env.OIDC_CLIENT_ID, redirect_uri: env.OIDC_REDIRECT_URI, response_type: 'code', scope: 'openid',
  code_challenge: challenge, code_challenge_method: 'S256', state, nonce, acr_values: 'urn:tcds:acr:phishing-resistant:uv', max_age: '0', prompt: 'login'});

let r = await go('/auth?' + q); step('1 /auth', r);
let path = local(r.location); if (!path?.startsWith('/interaction/')) process.exit(1);
const uid = path.split('/')[2];
r = await go(path); step('2 interaction page', r); if (r.status !== 200) process.exit(1);
const csp = r.csp;
const fa = (/form-action ([^;]+)/.exec(csp)?.[1] ?? '').trim().split(/\s+/).filter(Boolean);
const formActionAllows = url => { const o = new URL(url, ISS).origin; return fa.some(x => x === "'self'" ? o === ISS : x === o); };
console.log('  page form-action:', fa.join(' ') || '(none)');
const formOrigin = /(^|,)\s*no-referrer\s*$/.test(r.rp) ? 'null' : ISS;   // what a real browser sends on the page's form POST
console.log('  page Referrer-Policy:', r.rp, '-> browser form POST sends Origin:', formOrigin);
r = await go(`/interaction/${uid}/options`, {headers: {'sec-fetch-site': 'same-origin'}}); step('3 options', r); if (r.status !== 200) process.exit(1);
const {csrf} = JSON.parse(r.text);
const form = new URLSearchParams({credential: JSON.stringify({id: 'test-credential-id-0001', type: 'public-key', rawId: 'test-credential-id-0001',
  response: {clientDataJSON: 'e30', authenticatorData: 'AA', signature: 'AA', userHandle: null}}), csrf});
r = await go(`/interaction/${uid}/complete`, {method: 'POST', body: form.toString(), headers: {'content-type': 'application/x-www-form-urlencoded',
  origin: formOrigin, 'sec-fetch-site': 'same-origin'}}); step('4 complete', r); if (r.status >= 400) process.exit(1);
const chain = [];
for (let i = 5; i < 9 && r.location; i++) {          // follow the provider's own redirects on the issuer host
  chain.push(r.location);
  path = local(r.location); if (!path) break;
  r = await go(path); step(`${i} follow`, r);
  if (path.startsWith('/interaction/')) { console.log('!! the provider opened ANOTHER interaction (prompt not finished)'); process.exit(1); }
}
if (r.location) chain.push(r.location);
const blocked = fa.length ? chain.filter(u => !formActionAllows(u)) : [];   // Chrome applies form-action to the redirects after a submit
if (blocked.length) { console.log('!! the browser would BLOCK this redirect after the form POST (CSP form-action):', blocked.map(u => new URL(u).origin)); process.exit(1); }
console.log('  form-action allows every redirect after the POST:', chain.map(u => new URL(u).origin).join(' -> '));
const back = r.location && new URL(r.location);
if (!back || back.origin + back.pathname !== env.OIDC_REDIRECT_URI || !back.searchParams.get('code')) { console.log('!! no code returned to the EOC callback'); process.exit(1); }
console.log('callback: code returned, state matches =', back.searchParams.get('state') === state);
const tokr = await go('/token', {method: 'POST', cookies: false, headers: {'content-type': 'application/x-www-form-urlencoded'},
  body: new URLSearchParams({grant_type: 'authorization_code', code: back.searchParams.get('code'), redirect_uri: env.OIDC_REDIRECT_URI,
    code_verifier: verifier, client_id: env.OIDC_CLIENT_ID, client_secret: env.OIDC_CLIENT_SECRET}).toString()});
const tok = {status: tokr.status, json: async () => JSON.parse(tokr.text)};
const t = await tok.json();
if (tok.status !== 200) { console.log('token:', tok.status, JSON.stringify(t)); process.exit(1); }
const claims = JSON.parse(Buffer.from(t.id_token.split('.')[1], 'base64url').toString());
console.log('token: 200; id_token claims:', JSON.stringify({iss: claims.iss, aud: claims.aud, sub: claims.sub.length + ' chars', acr: claims.acr,
  amr: claims.amr, nonceOk: claims.nonce === nonce, authTimeAgeS: Math.floor(Date.now() / 1000) - claims.auth_time}));
// what the EOC BFF does with it (vendor server/policy.mjs normalizeClaims) + V1.4's amr rule
const {normalizeClaims} = await import(process.env.EOC_POLICY);
const n = normalizeClaims(claims, ISS, env.OIDC_CLIENT_ID, 'urn:tcds:acr:phishing-resistant:uv');
if (!n.methods.includes('webauthn') || !n.methods.includes('user_verification')) { console.log('!! amr lacks webauthn/user_verification:', n.methods); process.exit(1); }
console.log('EOC BFF normalizeClaims accepts it:', JSON.stringify({methods: n.methods, authenticatedAt: n.authenticatedAt}));
console.log('FULL SIGN-IN FLOW PASSED');
