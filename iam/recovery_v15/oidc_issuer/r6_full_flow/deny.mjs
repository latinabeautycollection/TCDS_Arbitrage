// What a PERSON sees when sign-in is refused or a link is stale (r8): readable HTML for browser navigations,
// JSON kept for the page's own fetch() calls. Run with STUB_DENY=1 (the IAM side refuses the passkey, as for Yahaira).
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
const BASE = 'http://127.0.0.1:18401', HOST = 'login-stg.tcdsolutionsgroup.com', ISS = 'https://' + HOST;
const env = JSON.parse(fs.readFileSync(new URL('./secrets/env.json', import.meta.url), 'utf8'));
const jar = new Map();
const keep = h => { for (const c of [].concat(h['set-cookie'] ?? [])) { const [nv] = c.split(';'); const i = nv.indexOf('='); jar.set(nv.slice(0, i), nv.slice(i + 1)); } };
const NAV = {'sec-fetch-mode': 'navigate', 'sec-fetch-site': 'same-origin', accept: 'text/html,application/xhtml+xml'};
function go(path, {method = 'GET', body, headers = {}, cookies = true} = {}) {
  return new Promise((resolve, reject) => {
    const h = {host: HOST, 'x-forwarded-proto': 'https', ...(cookies && jar.size ? {cookie: [...jar].map(([n, v]) => n + '=' + v).join('; ')} : {}), ...headers};
    if (body) h['content-length'] = Buffer.byteLength(body);
    const req = http.request(BASE + path, {method, headers: h}, res => { let t = ''; res.setEncoding('utf8'); res.on('data', x => t += x);
      res.on('end', () => { keep(res.headers); resolve({status: res.statusCode, type: res.headers['content-type'] ?? '', csp: res.headers['content-security-policy'] ?? '', location: res.headers.location, text: t}); }); });
    req.on('error', reject); req.end(body);
  });
}
let fails = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  ' + detail}`); if (!ok) fails++; };
const page = r => /text\/html/.test(r.type) && /<h2>/.test(r.text);
const h2 = r => (/<h2>([^<]+)<\/h2>/.exec(r.text) ?? [])[1];

const q = new URLSearchParams({client_id: env.OIDC_CLIENT_ID, redirect_uri: env.OIDC_REDIRECT_URI, response_type: 'code', scope: 'openid',
  code_challenge: crypto.createHash('sha256').update('v'.repeat(43)).digest('base64url'), code_challenge_method: 'S256', state: 's'.repeat(22),
  nonce: 'n'.repeat(22), acr_values: 'urn:tcds:acr:phishing-resistant:uv', max_age: '0', prompt: 'login'});
let r = await go('/auth?' + q, {headers: NAV});
const uid = new URL(r.location, ISS).pathname.split('/')[2];
r = await go(`/interaction/${uid}`, {headers: NAV});
r = await go(`/interaction/${uid}/options`, {headers: {'sec-fetch-mode': 'cors', 'sec-fetch-site': 'same-origin'}});
const {csrf} = JSON.parse(r.text);
const form = new URLSearchParams({credential: JSON.stringify({id: 'x'.repeat(20), type: 'public-key', rawId: 'x'.repeat(20), response: {clientDataJSON: 'e30', authenticatorData: 'AA', signature: 'AA', userHandle: null}}), csrf});
r = await go(`/interaction/${uid}/complete`, {method: 'POST', body: form.toString(), headers: {...NAV, origin: ISS, 'content-type': 'application/x-www-form-urlencoded'}});
if (process.env.SAVE) fs.writeFileSync(process.env.SAVE, r.text);
check('refused passkey (no EOC access): readable page, not JSON', page(r) && r.status === 401, r.type + ' ' + r.text.slice(0, 80));
check('  title says why', h2(r) === "This passkey can't open the EOC", h2(r));
check('  Return to the EOC link points at the EOC', r.text.includes(`href="${new URL(env.OIDC_REDIRECT_URI).origin}/"`));
check('  a support reference is shown', /Reference [0-9A-F]{8}/.test(r.text));
check('  same strict CSP as the sign-in page, no request data echoed', /default-src 'none'/.test(r.csp) && !r.text.includes(uid) && !r.text.includes(csrf));

r = await go('/interaction/doesnotexist0000', {headers: NAV, cookies: false});
check('stale / unknown sign-in link: readable "expired" page', page(r) && h2(r) === 'This sign-in has expired', `${r.status} ${r.type} ${h2(r) ?? r.text.slice(0, 80)}`);
r = await go(`/auth/${uid}`, {headers: NAV, cookies: false});
check('provider error (resume without its session): readable page', page(r), `${r.status} ${r.type} ${r.text.slice(0, 80)}`);
r = await go('/auth?client_id=not-a-client&response_type=code', {headers: NAV});
check('bad sign-in request: readable page', page(r) && r.status >= 400, `${r.status} ${r.type} ${r.text.slice(0, 80)}`);
r = await go('/interaction/doesnotexist0000/options', {headers: {'sec-fetch-mode': 'cors', 'sec-fetch-site': 'same-origin'}, cookies: false});
check("the page's own fetch() keeps JSON", /application\/json/.test(r.type) && /"error"/.test(r.text), `${r.status} ${r.type}`);
r = await go('/internal/health/live', {headers: {accept: '*/*'}});
check('health check unchanged (JSON)', /application\/json/.test(r.type) && r.status === 200);
console.log(fails ? `${fails} FAILED` : 'ALL REFUSAL-PAGE CHECKS PASSED');
process.exit(fails ? 1 : 0);
