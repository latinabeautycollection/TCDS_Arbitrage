import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {createCentralVerifierClient,CentralCallError,type CentralVerifierConfig} from './centralVerifierClient';

// Central passkey ENROLLMENT page (TCDS 626) for named leaders, served on the issuer's host so the passkey is created
// for its RP (staging https://login-stg.tcdsolutionsgroup.com/enroll/#<invite>). Own loopback listener, separate from
// the private internal IAM API; nginx forwards only /enroll/ here. The invite travels in the URL fragment, so it never
// reaches a server log or a Referer. Look and feel: the EOC portal's sign-in screen (auth.css, tokens.css, V0.6.6).
export type CentralEnrollmentConfig={host:string;port:number;publicOrigin:string;assetsDir:string;verifier:CentralVerifierConfig;
  /** Page API calls per client address per minute (default 20; a person needs about 4 per enrollment or approval). */
  rateLimitPerMinute?:number};

const SECURITY_HEADERS={'cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer','x-frame-options':'DENY',
  'cross-origin-opener-policy':'same-origin','cross-origin-resource-policy':'same-origin',
  'permissions-policy':'publickey-credentials-create=(self), publickey-credentials-get=(self), camera=(), microphone=(), geolocation=()',
  'content-security-policy':"default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"};
const MAX_BODY=65536;
const ASSETS:Record<string,string>={'tcds-logo-wide.jpg':'image/jpeg','tcds-shield.png':'image/png'};

const ICON={
  shield:'<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/></svg>',
  lock:'<svg viewBox="0 0 24 24" width="25" height="25" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="16" r="1"/><rect x="3" y="10" width="18" height="12" rx="2"/><path d="M7 10V7a5 5 0 0 1 10 0v3"/></svg>',
  key:'<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15.5 7.5 2.3 2.3a1 1 0 0 0 1.4 0l2.1-2.1a1 1 0 0 0 0-1.4L19 4"/><path d="m21 2-9.6 9.6"/><circle cx="7.5" cy="15.5" r="5.5"/></svg>',
  print:'<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 10a2 2 0 0 0-2 2c0 1.02-.1 2.51-.26 4"/><path d="M14 13.12c0 2.38 0 6.38-1 8.88"/><path d="M17.29 21.02c.12-.6.43-2.3.5-3.02"/><path d="M2 12a10 10 0 0 1 18-6"/><path d="M2 16h.01"/><path d="M21.8 16c.2-2 .131-5.354 0-6"/><path d="M5 19.5C5.5 18 6 15 6 12a6 6 0 0 1 .34-2"/><path d="M8.65 22c.21-.66.45-1.32.57-2"/><path d="M9 6.8a6 6 0 0 1 9 5.2v2"/></svg>',
};

const PAGE=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#071523">
<meta name="robots" content="noindex,nofollow"><title>TCDS · Passkey enrollment</title><link rel="icon" type="image/png" href="/enroll/assets/tcds-shield.png"><link rel="stylesheet" href="/enroll/assets/enroll.css"></head>
<body><main class="auth-page"><div class="auth-ambient" aria-hidden="true"></div>
<section class="auth-layout" aria-label="TCDS passkey enrollment">
 <div class="auth-showcase">
  <img class="auth-logo" src="/enroll/assets/tcds-logo-wide.jpg" width="830" height="380" alt="TCDS Total Coverage Database Solutions gold shield and wordmark">
  <span class="auth-overline">ENTERPRISE OPERATIONS CENTER</span>
  <h1>Set up your<br><em>enterprise passkey.</em></h1>
  <p>Your passkey stays on this laptop, unlocked by your fingerprint, face or device PIN. It replaces passwords for TCDS enterprise sign-in.</p>
  <div class="auth-claims">
   <span>${ICON.shield} Issued by TCDS central IAM</span>
   <span>${ICON.print} Unlocked only by you on this device</span>
   <span>${ICON.key} No password to remember or share</span>
  </div>
 </div>
 <div class="auth-card">
  <div class="auth-card-head"><div class="auth-lock">${ICON.lock}</div>
   <span>TCDS · SECURE ENROLLMENT</span><h2>Register this laptop</h2>
   <p id="lead">Checking your invitation…</p>
  </div>
  <div id="invitee" class="enroll-invitee" hidden><span>INVITED</span><strong id="invitee-name"></strong><small id="invitee-user"></small></div>
  <div id="name-field" hidden><label class="auth-label" for="friendly">Name this passkey <small>(optional)</small></label>
   <input id="friendly" maxlength="60" autocomplete="off" placeholder="e.g. Work MacBook"></div>
  <button id="start" class="auth-submit" type="button" hidden>Continue</button>
  <button id="create" class="auth-submit" type="button" hidden>Create passkey</button>
  <div id="status" class="auth-note" role="status" hidden></div>
  <div id="error" class="auth-error" role="alert" hidden></div>
  <p class="auth-help" id="help">When you select <b>Create passkey</b>, your laptop asks for your fingerprint, face or device PIN. Nothing is shared with TCDS except the passkey's public key.</p>
  <div class="auth-footer"><span>Encrypted transport required</span><span>Access is centrally governed</span></div>
 </div>
</section>
<footer class="auth-page-footer">© 2026 Total Coverage Database Solutions · Authorized personnel only</footer></main>
<script src="/enroll/assets/enroll.js"></script></body></html>`;

// The EOC portal's own auth styles (src/styles/auth.css + global.css base), plus the invitee box. Fonts: DM Sans /
// Manrope when installed; no third-party font request on a credential page (CSP self only).
const CSS=`:root{font-family:'DM Sans',system-ui,-apple-system,'Segoe UI',sans-serif;color:#dfeaf7;background:#081321;-webkit-font-smoothing:antialiased}*{box-sizing:border-box}body{margin:0}button,input{font:inherit}button{cursor:pointer;border:0}button:focus-visible,input:focus-visible{outline:2px solid #6bd7e3;outline-offset:2px}h1,h2,p{margin:0}h1,h2{font-family:Manrope,system-ui,sans-serif}[hidden]{display:none!important}
.auth-page{background:#080F1D;color:#EFF5FC;min-height:100vh;position:relative;overflow:hidden;display:flex;flex-direction:column;justify-content:center}.auth-ambient{pointer-events:none;position:absolute;inset:0;background:radial-gradient(ellipse at 20% 43%,#1c345060,transparent 48%),radial-gradient(ellipse at 85% 14%,#0c57602a,transparent 40%)}.auth-layout{position:relative;margin:auto;max-width:1320px;width:100%;display:grid;grid-template-columns:minmax(0,1.2fr) minmax(380px,480px);gap:clamp(30px,7vw,110px);padding:65px 46px;align-items:center}.auth-showcase{max-width:680px}.auth-logo{width:min(100%,400px);height:auto;display:block;mix-blend-mode:lighten;margin:0 0 44px}.auth-overline{font-size:11px;letter-spacing:2.4px;font-weight:800;color:#D8AE66}.auth-showcase h1{font:800 clamp(37px,4vw,56px)/1.12 Manrope,system-ui,sans-serif;letter-spacing:-2px;margin:16px 0 22px}.auth-showcase h1 em{font-style:normal;color:#33B9AC}.auth-showcase p{font-size:16px;line-height:1.8;color:#A9BBD1;max-width:580px}.auth-claims{display:grid;gap:15px;margin-top:36px}.auth-claims span{display:flex;align-items:center;gap:11px;color:#C3D6E9;font-size:14px}.auth-claims svg{color:#D8AE66;flex:none}
.auth-card{border:1px solid #30435D;background:linear-gradient(150deg,#14243a,#0d1b2d);box-shadow:0 36px 100px #020813ad;border-radius:22px;padding:38px;position:relative}.auth-card-head{margin-bottom:27px}.auth-lock{width:49px;height:49px;border-radius:14px;display:grid;place-items:center;background:#1f3c51;color:#E4BB76;margin-bottom:22px}.auth-card-head>span{font-size:10px;letter-spacing:2px;color:#D9B375;font-weight:800}.auth-card-head h2{font-size:29px;letter-spacing:-.7px;margin:12px 0}.auth-card-head p{color:#A9BBD1;font-size:14px;line-height:1.7}
.auth-label{display:block;color:#d5e4f4;font-size:13px;font-weight:700;margin:18px 0 8px}.auth-label small{color:#89a0b7;font-weight:500}.auth-card input{width:100%;border:1px solid #45617d;border-radius:10px;padding:14px 15px;background:#0d1a2a;color:#EFF5FC;font-size:15px;min-height:48px}.auth-card input::placeholder{color:#89a0b7}
.auth-submit{margin-top:25px;width:100%;border-radius:10px;background:linear-gradient(110deg,#c89a51,#efd39b);color:#0b1524;padding:15px 17px;min-height:50px;font-size:14px;font-weight:800;display:flex;align-items:center;justify-content:center;gap:10px}.auth-submit:disabled{opacity:.56;cursor:not-allowed}.auth-help{font-size:12px;color:#a9bbd1;line-height:1.7;margin:18px 0}.auth-footer{display:flex;gap:13px;justify-content:space-between;flex-wrap:wrap;padding-top:20px;margin-top:25px;border-top:1px solid #30435D;color:#849eb8;font-size:11px}.auth-error,.auth-note{margin-top:15px;padding:12px;border-radius:8px;font-size:13px;line-height:1.5}.auth-error{background:#42242c;color:#ffd7d7}.auth-note{background:#174036;color:#ccfff0}.auth-page-footer{position:relative;text-align:center;padding:20px;color:#7694ac;font-size:11px}
.approve-steps{list-style:none;margin:16px 0 0;padding:0;display:grid;grid-template-columns:1fr 1fr;gap:10px}.approve-steps li{display:flex;align-items:center;gap:11px;padding:12px 13px;border:1px solid #30435D;border-radius:12px;background:#0b1727;transition:border-color .2s}.approve-steps i{width:26px;height:26px;border-radius:50%;border:2px solid #4a6280;flex:none;display:grid;place-items:center;font-style:normal;font-size:12px;font-weight:800;color:#89a0b7}.approve-steps span{display:block;font-size:13px;font-weight:700;color:#EFF5FC}.approve-steps small{display:block;font-size:12px;color:#89a0b7;margin-top:2px}.approve-steps li.current{border-color:#c89a51}.approve-steps li.current i{border-color:#E4BB76;color:#E4BB76}.approve-steps li.current small{color:#E4BB76}.approve-steps li.done{border-color:#2b7f6f}.approve-steps li.done i{background:#33B9AC;border-color:#33B9AC;color:#071523}.approve-steps li.done small{color:#8fe3d6}
.approve-share{margin-top:18px;padding:14px 16px;border:1px solid #30435D;border-radius:12px;background:#0b1727}.approve-share p{font-size:13px;line-height:1.6;color:#A9BBD1}.approve-share p b{color:#EFF5FC}.approve-link{display:flex;gap:8px;margin-top:10px}.approve-link input{flex:1;min-width:0;min-height:42px!important;padding:10px 12px!important;font-size:12px!important;color:#C3D6E9!important}.approve-link button{flex:none;border-radius:10px;padding:0 14px;background:#1f3c51;color:#E4BB76;font-size:13px;font-weight:800}.approve-live{display:flex;align-items:center;gap:8px;margin-top:10px;font-size:12px;color:#89a0b7}.approve-live:not(:empty)::before{content:'';width:7px;height:7px;border-radius:50%;background:#33B9AC;animation:tcds-pulse 1.6s ease-in-out infinite}@keyframes tcds-pulse{50%{opacity:.25}}@media(prefers-reduced-motion:reduce){.approve-live::before{animation:none}}
@media(max-width:450px){.approve-steps{grid-template-columns:1fr}}
.approve-items{list-style:none;margin:12px 0 0;padding:12px 0 0;border-top:1px solid #30435D;display:flex;flex-wrap:wrap;gap:6px}.approve-items li{font-size:12px;font-weight:700;color:#C3D6E9;background:#14243a;border:1px solid #30435D;border-radius:999px;padding:4px 10px}
.approve-fp{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.3px;white-space:nowrap}.approve-window{margin-top:14px;padding:11px 13px;border-radius:10px;border:1px solid #c89a51;background:#2a2213;color:#F2D9A6;font-size:13px;line-height:1.5}.approve-window b{font-variant-numeric:tabular-nums;color:#FFE7B8}
.approve-rows{display:grid;gap:8px;margin-top:12px;padding-top:12px;border-top:1px solid #30435D}.approve-rows div{display:flex;justify-content:space-between;gap:12px}.approve-rows span{font-size:11px;letter-spacing:1.6px;color:#D9B375;font-weight:800}.approve-rows b{font-size:14px;color:#EFF5FC;text-align:right}
.enroll-invitee{display:grid;gap:4px;background:#0b1727;border:1px solid #30435D;border-radius:12px;padding:14px 16px}.enroll-invitee span{font-size:10px;letter-spacing:2px;color:#D9B375;font-weight:800}.enroll-invitee strong{font:700 18px Manrope,system-ui,sans-serif;color:#EFF5FC}.enroll-invitee small{color:#A9BBD1;font-size:12px}
@media(max-width:920px){.auth-layout{grid-template-columns:1fr;max-width:620px;gap:34px;padding:37px 22px}.auth-logo{width:300px;margin:0 0 28px}.auth-showcase h1{font-size:36px}.auth-claims{display:none}.auth-showcase p{font-size:14px}.auth-card{padding:27px}}@media(max-width:450px){.auth-showcase h1{font-size:29px;letter-spacing:-1px}.auth-card{padding:23px}.auth-logo{width:240px}}
/* Approval card, compact (2026-11-19): the whole decision and its button fit one laptop screen. */
.approve-layout{padding-top:28px;padding-bottom:24px}.approve-card{padding:28px 30px}
.approve-head{margin-bottom:16px}.approve-kicker{display:flex;align-items:center;gap:8px;font-size:10px;letter-spacing:2px;color:#D9B375;font-weight:800}.approve-kicker svg{width:16px;height:16px;flex:none;color:#E4BB76}
.approve-head h2{font-size:25px;letter-spacing:-.5px;margin:9px 0 4px}.approve-head p{color:#A9BBD1;font-size:14px;line-height:1.5}
.approve-summary{background:#0b1727;border:1px solid #30435D;border-radius:12px;padding:14px 16px}
.approve-person strong{display:block;font:700 17px Manrope,system-ui,sans-serif;color:#EFF5FC}.approve-person small{color:#A9BBD1;font-size:12px}
.approve-facts{display:grid;grid-template-columns:1fr 1fr;gap:10px 18px;margin:12px 0 0;padding-top:12px;border-top:1px solid #30435D}.approve-facts>div{min-width:0}.approve-facts .wide{grid-column:1/-1}
.approve-facts dt{font-size:10px;letter-spacing:1.5px;color:#D9B375;font-weight:800;text-transform:uppercase}.approve-facts dd{margin:3px 0 0;font-size:13.5px;line-height:1.35;font-weight:700;color:#EFF5FC;overflow-wrap:anywhere}
.approve-mods{margin-top:12px;padding-top:10px;border-top:1px solid #30435D}.approve-mods summary{cursor:pointer;list-style:none;display:flex;align-items:center;justify-content:space-between;gap:10px;font-size:13px;font-weight:700;color:#C3D6E9}
.approve-mods summary::-webkit-details-marker{display:none}.approve-mods summary::after{content:'Show';font-size:12px;font-weight:800;color:#E4BB76}.approve-mods[open] summary::after{content:'Hide'}
.approve-mods summary:focus-visible{outline:2px solid #6bd7e3;outline-offset:3px;border-radius:4px}.approve-mods .approve-items{border-top:0;padding-top:0;margin-top:10px}
.approve-card .approve-steps{margin-top:14px}.approve-card .approve-steps li{padding:9px 12px}.approve-card .auth-submit{margin-top:16px}
.approve-card .auth-help{margin:12px 0 0;font-size:12px;line-height:1.6}.approve-card .auth-footer{margin-top:16px;padding-top:14px}.approve-card .approve-share{margin-top:14px}
@media(max-width:450px){.approve-card{padding:22px 20px}.approve-facts{grid-template-columns:1fr}}
/* Wide screens: a two-pane decision panel (what is approved | progress and action), so nothing falls below the fold. */
@media(min-width:1180px){
 .approve-layout{grid-template-columns:minmax(330px,1fr) minmax(700px,800px);gap:clamp(28px,3.5vw,60px)}
 .approve-layout .auth-showcase h1{font-size:clamp(34px,3.2vw,48px)}.approve-layout .auth-logo{width:min(100%,340px);margin-bottom:34px}
 .approve-body{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:22px;align-items:start}
 .approve-card .approve-act .approve-steps{margin-top:0}
}
/* Top-aligned columns (2026-11-19): the logo starts level with the card however tall the card grows. */
.auth-layout{align-items:start}.auth-showcase{padding-top:6px}
/* Card legibility (2026-11-19): the device's own UI font at larger sizes and higher contrast. */
.auth-card{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,Roboto,'Helvetica Neue',sans-serif;-webkit-font-smoothing:antialiased}
.auth-card-head>span{font-size:13px;letter-spacing:1.8px;color:#E4C084;font-weight:800}.auth-card-head h2{font-size:31px;margin:12px 0 10px}.auth-card-head p{font-size:17px;line-height:1.6;color:#D6E2EE;font-weight:500}.auth-submit{font-size:16px;min-height:56px;letter-spacing:.2px}.auth-help{font-size:14.5px;line-height:1.65;color:#C2D0DE}.auth-help b{color:#EFF5FC}.auth-label{font-size:14.5px}.auth-card input{font-size:16px}.auth-error,.auth-note{font-size:14.5px;line-height:1.55}.auth-footer{font-size:12.5px;color:#9DB2C7}.enroll-invitee span{font-size:11.5px;letter-spacing:1.8px}.enroll-invitee strong{font-size:20px}.enroll-invitee small{font-size:13.5px;color:#B9C9DA}
@media(max-width:450px){.auth-card-head h2{font-size:27px}.auth-card-head p{font-size:16px}}`;

const JS=`(()=>{'use strict';
const $=id=>document.getElementById(id);
const dec=s=>{const b=s.replace(/-/g,'+').replace(/_/g,'/');const r=atob(b.padEnd(Math.ceil(b.length/4)*4,'='));return Uint8Array.from(r,c=>c.charCodeAt(0))};
const enc=b=>btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\\+/g,'-').replace(/\\//g,'_').replace(/=+$/,'');
const MESSAGES={CENTRAL_INVITE_INVALID:'This invitation is no longer valid. It may have been used, replaced or expired. Ask your identity administrator for a new one.',
 CHALLENGE_EXPIRED:'This step took too long. Select Continue to try again.',CHALLENGE_CONSUMED:'This step was already used. Select Continue to try again.',
 CREDENTIAL_ALREADY_REGISTERED:'This passkey is already registered.',REGISTRATION_NOT_VERIFIED:'The passkey could not be verified. Try again, using your fingerprint, face or device PIN.',
 ENROLLMENT_EVIDENCE_INVALID:'Your device did not confirm it was you (fingerprint, face or PIN). Try again.',RATE_LIMITED:'Too many attempts. Wait a minute and try again.'};
const show=(el,text)=>{el.textContent=text;el.hidden=!text};
const fail=code=>{show($('status'),'');show($('error'),MESSAGES[code]||'Enrollment could not be completed. Try again, or contact your identity administrator.');};
const KEY='tcds.enroll.invite';
let token=location.hash.slice(1);
try{if(token)sessionStorage.setItem(KEY,token);else token=sessionStorage.getItem(KEY)||''}catch{}
history.replaceState(null,'',location.pathname); // keep the invite out of history and screenshots of the address bar
const forget=()=>{try{sessionStorage.removeItem(KEY)}catch{}};
let current=null;
async function api(path,body){const r=await fetch('/enroll/api/'+path,{method:'POST',credentials:'same-origin',cache:'no-store',
 headers:{'content-type':'application/json'},body:JSON.stringify(body)});const j=await r.json().catch(()=>({}));if(!r.ok)throw Object.assign(new Error('x'),{code:j.error||'FAILED'});return j}
function ready(){
 if(!/^[A-Za-z0-9_-]{43}$/.test(token)){show($('lead'),'Open the full invitation link to continue.');
  show($('error'),'This page needs the complete link from your invitation. It ends with a long code after the # sign. Open that link again, in this browser.');
  $('help').hidden=true;return}
 if(!window.PublicKeyCredential||!navigator.credentials?.create){show($('lead'),'This browser cannot create passkeys.');show($('error'),'Open this link in a current version of Safari, Chrome or Edge on your laptop.');return}
 show($('lead'),'You were invited to set up a passkey for TCDS enterprise sign-in.');$('start').hidden=false;
}
$('start').onclick=async()=>{
 $('start').disabled=true;show($('error'),'');show($('status'),'Checking your invitation…');
 try{current=await api('options',{token});const u=current.options.user;
  show($('invitee-name'),u.displayName);show($('invitee-user'),u.name);$('invitee').hidden=false;$('name-field').hidden=false;
  $('start').hidden=true;$('create').hidden=false;show($('status'),'');show($('lead'),'Check that this is you, then create your passkey.');
 }catch(e){if(e.code==='CENTRAL_INVITE_INVALID')forget();fail(e.code);$('start').disabled=false}
};
$('create').onclick=async()=>{
 if(!current)return;$('create').disabled=true;show($('error'),'');show($('status'),'Follow your laptop\\'s prompt: fingerprint, face or device PIN.');
 const o=current.options;
 try{
  const cred=await navigator.credentials.create({publicKey:{...o,challenge:dec(o.challenge),user:{...o.user,id:dec(o.user.id)},
   excludeCredentials:(o.excludeCredentials||[]).map(x=>({...x,id:dec(x.id)}))}});
  const r=cred.response;
  const response={id:cred.id,rawId:enc(cred.rawId),type:cred.type,authenticatorAttachment:cred.authenticatorAttachment||undefined,
   clientExtensionResults:cred.getClientExtensionResults?cred.getClientExtensionResults():{},
   response:{clientDataJSON:enc(r.clientDataJSON),attestationObject:enc(r.attestationObject),transports:r.getTransports?r.getTransports():[]}};
  await api('verify',{challengeId:current.challengeId,response,friendlyName:$('friendly').value.trim()||undefined});
  current=null;forget();$('create').hidden=true;$('name-field').hidden=true;$('help').hidden=true;show($('error'),'');
  show($('lead'),'Your passkey is registered.');
  show($('status'),'Done. You can close this page. Your passkey can be used for sign-in once your enterprise access is approved.');
 }catch(e){
  if(e&&e.name==='NotAllowedError'){show($('status'),'');show($('error'),'Passkey creation was cancelled or timed out. Select Continue to try again.')}
  else if(e&&e.name==='InvalidStateError'){show($('status'),'');show($('error'),'This laptop already has a TCDS passkey for this account.')}
  else fail(e&&e.code);
  current=null;$('create').hidden=true;$('create').disabled=false;$('start').hidden=false;$('start').disabled=false;
 }
};
ready();
})();`;


// Binding APPROVAL page (628): https://login-stg.../approve/?r=<binding request id>. The id is not a secret: approving
// needs a passkey whose owner holds the approver role, is not the person or the requester, and has not approved yet.
const APPROVE_PAGE=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#071523">
<meta name="robots" content="noindex,nofollow"><title>TCDS · Identity binding approval</title><link rel="icon" type="image/png" href="/enroll/assets/tcds-shield.png"><link rel="stylesheet" href="/enroll/assets/enroll.css"></head>
<body><main class="auth-page"><div class="auth-ambient" aria-hidden="true"></div>
<section class="auth-layout approve-layout" aria-label="TCDS approval">
 <div class="auth-showcase">
  <img class="auth-logo" src="/enroll/assets/tcds-logo-wide.jpg" width="830" height="380" alt="TCDS Total Coverage Database Solutions gold shield and wordmark">
  <span class="auth-overline">ENTERPRISE OPERATIONS CENTER</span>
  <h1><span id="hl1">Approve an</span><br><em id="hl2">identity binding.</em></h1>
  <p id="intro">You are confirming that a TCDS enterprise sign-in belongs to this person. Approve only if you have verified their identity yourself.</p>
  <div class="auth-claims">
   <span>${ICON.shield} Two independent approvers are required</span>
   <span>${ICON.print} Signed with your own passkey</span>
   <span>${ICON.key} Valid for this request only</span>
  </div>
 </div>
 <div class="auth-card approve-card">
  <div class="approve-head"><span class="approve-kicker">${ICON.lock}<span id="kicker">TCDS · IDENTITY BINDING APPROVAL</span></span>
   <h2 id="title">Approve binding</h2><p id="lead">Loading the request…</p></div>
  <div class="approve-body"><div class="approve-what">
  <div id="request" class="approve-summary" hidden>
   <div class="approve-person"><strong id="r-name"></strong><small id="r-user"></small></div>
   <dl class="approve-facts">
    <div class="wide"><dt>Purpose</dt><dd id="r-purpose"></dd></div>
    <div class="g-only" hidden><dt>Access</dt><dd id="r-access"></dd></div>
    <div class="g-only" hidden><dt>Valid for</dt><dd id="r-valid"></dd></div>
    <div class="g-only" hidden><dt>Set fingerprint</dt><dd id="r-fp" class="approve-fp"></dd></div>
    <div><dt>Request expires</dt><dd id="r-expires"></dd></div>
   </dl>
   <details id="r-mods" class="approve-mods" hidden><summary id="r-mods-s"></summary><ul id="r-items" class="approve-items" aria-label="EOC modules in this request"></ul></details>
  </div>
  </div><div class="approve-act">
  <ol id="steps" class="approve-steps" aria-label="Approval progress" hidden>
   <li id="step1"><i aria-hidden="true">1</i><div><span>First approver</span><small id="step1-s"></small></div></li>
   <li id="step2"><i aria-hidden="true">2</i><div><span>Second approver</span><small id="step2-s"></small></div></li>
  </ol>
  <div id="window" class="approve-window" role="timer" aria-live="off" hidden></div>
  <div id="status" class="auth-note" role="status" aria-live="polite" hidden></div>
  <div id="error" class="auth-error" role="alert" hidden></div>
  <button id="start" class="auth-submit" type="button" hidden>Continue</button>
  <button id="approve" class="auth-submit" type="button" hidden>Approve with passkey</button>
  <p class="auth-help" id="help" hidden></p>
  <div id="share" class="approve-share" hidden>
   <p><b>Second approver on another device?</b> <span id="share-text">Send them this link. Only an authorized approver's own passkey can approve it.</span></p>
   <div class="approve-link"><input id="link" readonly aria-label="Approval link"><button id="copy" type="button">Copy link</button></div>
   <small id="live" class="approve-live"></small>
  </div>
  </div></div>
  <div class="auth-footer"><span>Encrypted transport required</span><span>Access is centrally governed</span></div>
 </div>
</section>
<footer class="auth-page-footer">© 2026 Total Coverage Database Solutions · Authorized personnel only</footer></main>
<script src="/approve/assets/approve.js"></script></body></html>`;

const APPROVE_JS=`(()=>{'use strict';
// One page, two kinds of request: ?r=<id> an identity BINDING (628), ?g=<id> an EOC module GRANT set (630).
// States: loading -> open (0 of 2) -> open (1 of 2, waiting; live) -> done (bound / granted) | expired | cancelled.
// The page never needs a reload: after each approval it re-reads the request, and while it waits for the second
// approver it checks the request every 10 s (tab visible only) so an approval given elsewhere updates this screen.
// Grant sets: an approval counts for 5 minutes (the EOC rule); the page shows that window as a countdown.
const $=id=>document.getElementById(id);
const dec=s=>{const b=s.replace(/-/g,'+').replace(/_/g,'/');const r=atob(b.padEnd(Math.ceil(b.length/4)*4,'='));return Uint8Array.from(r,c=>c.charCodeAt(0))};
const enc=b=>btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\\+/g,'-').replace(/\\//g,'_').replace(/=+$/,'');
const show=(el,text)=>{el.textContent=text;el.hidden=!text};
const qs=new URLSearchParams(location.search);
const GRANT=qs.has('g');
const rid=(GRANT?qs.get('g'):qs.get('r'))||'';
const K=GRANT?{api:'/approve/api/grant/',key:'grantRequestId',done:'GRANTED',param:'g'}:{api:'/approve/api/',key:'bindingRequestId',done:'BOUND',param:'r'};
const POLL_MS=10000,POLL_FOR_MS=30*60*1000;
const MODULE_NAMES={executive:'Executive',capital:'Capital',acquisition:'Acquisition',market:'Market',retail:'Retail',pqp:'PQP',purchasing:'Purchasing',
 warehouse:'Warehouse',shipping:'Shipping',returns:'Returns',identity:'Identity',hardware:'Hardware',governance:'Governance',forensic:'Forensic',ai:'AI',
 administration:'Administration',decisions:'Decisions',agents:'Agents',knowledge:'Knowledge',scenarios:'Scenarios'};
const OPS={VIEW:'View',INVESTIGATE:'Investigate',MANAGE:'Manage',APPROVE:'Approve',ADMINISTER:'Administer',EXPORT:'Export',EXECUTE:'Execute',CONFIGURE:'Configure'};
let retry=false,info=null,current=null,busy=false,abort=null,timer=null,pollUntil=0,clock=null,skew=0,lastLive=0;
const who=()=>info?info.targetDisplayName:'This person';
const what=()=>GRANT?'EOC access':'identity binding';
const MESSAGES={
 APPROVER_IS_THE_TARGET:()=>'That passkey belongs to '+who()+', the person this request is for. They cannot approve their own '+what()+'. Try again and choose an approver\\'s passkey.',
 APPROVER_IS_THE_REQUESTER:()=>'That passkey belongs to the person who made this request, so it cannot also approve it. Choose a different approver\\'s passkey.',
 APPROVER_NOT_AUTHORIZED:()=>'That passkey belongs to someone who is not an authorized '+(GRANT?'EOC access':'binding')+' approver. Choose an approver\\'s own passkey.',
 APPROVER_ALREADY_APPROVED:()=>'That approver has already approved this request. The second approval must come from a different approver: try again and choose their passkey.',
 CENTRAL_GRANT_ALREADY_APPROVED:()=>'Two approvals are already recorded for this request. Wait a moment: the page updates by itself.',
 CENTRAL_BINDING_REQUEST_NOT_OPEN:()=>'This request is no longer open. It may be complete, cancelled or expired.',
 CENTRAL_GRANT_REQUEST_NOT_OPEN:()=>'This request is no longer open. It may be complete, cancelled or expired.',
 CENTRAL_BINDING_REQUEST_NOT_FOUND:()=>'This approval request was not found. Check the link you received.',
 CENTRAL_GRANT_REQUEST_NOT_FOUND:()=>'This approval request was not found. Check the link you received.',
 CREDENTIAL_NOT_ACTIVE:()=>'That passkey is not active. Choose a different passkey, or contact your identity administrator.',
 USER_HANDLE_MISMATCH:()=>'The passkey could not be matched to an account. Try again with an approver\\'s own passkey.',
 CHALLENGE_EXPIRED:()=>'The passkey step took longer than 2 minutes. Try again.',CHALLENGE_CONSUMED:()=>'That step was already used. Try again.',
 USER_VERIFICATION_REQUIRED:()=>'The device did not confirm the approver (fingerprint, face or PIN). Try again.',
 COUNTER_REGRESSION:()=>'That passkey has been suspended for safety. Contact your identity administrator.',
 RATE_LIMITED:()=>'Too many attempts from this network. Wait a minute and try again.'};
const message=code=>{
 if(typeof code==='string'&&code.indexOf('CENTRAL_GRANT_ADMISSION')===0)return 'Both approvals were recorded, but the EOC did not accept the grants, so nothing was granted. Ask your identity administrator to issue a new request.';
 return (MESSAGES[code]||(()=>'The approval could not be completed. Try again, or contact your identity administrator.'))();
};
const fail=code=>{show($('status'),'');show($('error'),message(code))};
async function api(path,body){const r=await fetch(K.api+path,{method:'POST',credentials:'same-origin',cache:'no-store',
 headers:{'content-type':'application/json'},body:JSON.stringify(body)});const j=await r.json().catch(()=>({}));if(!r.ok)throw Object.assign(new Error('x'),{code:j.error||'FAILED'});return j}
const ask=()=>({[K.key]:rid});

function copy(){
 if(!GRANT)return;
 document.title='TCDS · EOC access approval';
 $('hl1').textContent='Approve';$('hl2').textContent='EOC access.';
 $('intro').textContent='You are confirming that this person may see these Enterprise Operations Center modules. Approve only if the access is right for their role.';
 $('kicker').textContent='TCDS · EOC ACCESS APPROVAL';$('title').textContent='Approve access';
 $('share-text').textContent='Send them this link now: both approvals must fall within 5 minutes. Only an approver\\'s own passkey can approve.';
 for(const e of document.querySelectorAll('.g-only'))e.hidden=false;
}
function summary(items){
 const ops=[...new Set(items.map(i=>OPS[i.operation]||i.operation))];
 const scopes=[...new Set(items.map(i=>i.scopeKind))];
 return ops.join(', ')+' \\u00b7 '+items.length+' module'+(items.length===1?'':'s')+(scopes.length===1&&scopes[0]==='ENTERPRISE'?' \\u00b7 company-wide':'');
}
function steps(n,status){
 $('steps').hidden=false;
 for(const k of [1,2]){
  const done=n>=k||status===K.done,cur=!done&&status==='OPEN'&&n+1===k,li=$('step'+k);
  li.className=done?'done':cur?'current':'';li.querySelector('i').textContent=done?'\\u2713':String(k);
  $('step'+k+'-s').textContent=done?'Approved':cur?'Waiting for approval':status==='OPEN'?'Next':'Not given';
 }
}
function buttons(label){ // label null = no action available
 current=null;$('approve').hidden=true;$('approve').disabled=false;
 $('start').hidden=!label;$('start').disabled=false;if(label)$('start').textContent=label;
}
// The 5-minute window of the first live approval (grant sets only).
function windowClock(){
 clearInterval(clock);clock=null;
 const until=info&&info.firstApprovalExpiresAt?Date.parse(info.firstApprovalExpiresAt):0;
 if(!GRANT||!until||info.status!=='OPEN'||info.approvals!==1){$('window').hidden=true;return}
 const tick=()=>{
  const left=Math.max(0,until-(Date.now()+skew)),m=Math.floor(left/60000),s=Math.floor(left%60000/1000);
  $('window').hidden=false;
  $('window').innerHTML='';const b=document.createElement('b');b.textContent=m+':'+String(s).padStart(2,'0');
  $('window').append('Second approval needed within ',b,'. After that the first approval expires and must be given again.');
  if(left<=0){clearInterval(clock);clock=null;refresh()}
 };
 tick();clock=setInterval(tick,1000);
}
function apply(i){
 const prevLive=lastLive;
 info=i;lastLive=i.status==='OPEN'?i.approvals:0;
 if(i.serverTime)skew=Date.parse(i.serverTime)-Date.now();
 show($('r-name'),i.targetDisplayName);show($('r-user'),i.targetUsername);show($('r-purpose'),i.purpose);
 show($('r-expires'),new Date(i.expiresAt).toLocaleString());$('request').hidden=false;
 if(GRANT){
  show($('r-access'),summary(i.items));show($('r-valid'),i.validDays+' days from approval');
  show($('r-fp'),(i.setFingerprint||'').replace(/(.{4})(?=.)/g,'$1 '));
  const ul=$('r-items');ul.innerHTML='';
  for(const it of i.items){const li=document.createElement('li');li.textContent=(MODULE_NAMES[it.moduleId]||it.moduleId)+(it.operation==='VIEW'?'':' \\u00b7 '+(OPS[it.operation]||it.operation));ul.append(li)}
  const all=i.items.length===Object.keys(MODULE_NAMES).length&&i.items.every(x=>x.operation===i.items[0].operation&&x.scopeKind===i.items[0].scopeKind);
  $('r-mods-s').textContent=all?'All '+i.items.length+' EOC modules':i.items.length+' EOC module'+(i.items.length===1?'':'s');
  const mods=$('r-mods');if(mods.hidden&&i.items.length<=6)mods.open=true;mods.hidden=false;
 }
 steps(i.approvals,i.status);
 const waiting=i.status==='OPEN'&&i.approvals>=1;
 $('share').hidden=!waiting;
 windowClock();
 if(i.status===K.done){
  stopPoll();buttons(null);$('help').hidden=true;show($('error'),'');
  show($('lead'),GRANT?'Access granted.':'Binding complete.');
  show($('status'),GRANT?'Both approvals are recorded and '+i.items.length+' EOC grants are active for '+i.validDays+' days. '+i.targetDisplayName+' can open these modules after signing in. You can close this page.'
   :'Both approvals are recorded. '+i.targetDisplayName+' can sign in to the EOC once their workspace access is granted. You can close this page.');
  return;
 }
 if(i.status!=='OPEN'){
  stopPoll();buttons(null);$('help').hidden=true;show($('status'),'');
  show($('lead'),i.status==='EXPIRED'?'This request has expired.':'This request was cancelled.');
  show($('error'),'No approval can be given on it. Ask your identity administrator for a new request if it is still needed.');
  return;
 }
 if(waiting){
  show($('lead'),'One approval is recorded. A second, different approver must now approve.');
  show($('help'),'Second approver here? Select the button and hand them this device: they choose their own passkey.');
  startPoll();
 }else{
  show($('lead'),GRANT?'Review the access, then approve with your own passkey.':'Review the request, then approve with your own passkey.');
  show($('help'),'Choose your own approver passkey and confirm with your fingerprint, face or device PIN. Your signature is recorded with this approval.');
  if(GRANT&&prevLive===1&&!busy){show($('status'),'');show($('error'),'The first approval expired: both approvals must be given within 5 minutes of each other. Approve again, then have the second approver approve right away.')}
 }
 if(!busy&&!current)buttons(idleLabel(retry));
}
function idleLabel(retry){return retry?'Try again with a different passkey':info&&info.approvals>=1?'Approve as the second approver':'Continue'}

// Live updates while waiting for the second approver.
function startPoll(){pollUntil=Date.now()+POLL_FOR_MS;show($('live'),'Watching for the second approval. This page updates by itself.');if(!timer)schedule()}
function stopPoll(){clearTimeout(timer);timer=null;show($('live'),'')}
function schedule(){timer=setTimeout(tick,POLL_MS)}
async function tick(){
 timer=null;
 if(Date.now()>pollUntil){show($('live'),'Stopped checking for updates. Reload the page to see the latest status.');return}
 if(document.hidden){schedule();return}
 try{
  const i=await api('info',ask());
  const changed=!info||i.status!==info.status||i.approvals!==info.approvals;
  if(changed){if(abort&&i.status!=='OPEN')abort.abort();if(!busy||i.status!=='OPEN')apply(i);else info=i}
 }catch{}
 if(info&&info.status==='OPEN'&&info.approvals>=1&&!timer)schedule();
}
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&timer){clearTimeout(timer);timer=null;tick()}});

async function load(){
 copy();
 $('link').value=location.origin+'/approve/?'+K.param+'='+encodeURIComponent(rid);
 if(!/^[0-9a-f-]{36}$/i.test(rid)){show($('lead'),'Open the full approval link to continue.');fail(GRANT?'CENTRAL_GRANT_REQUEST_NOT_FOUND':'CENTRAL_BINDING_REQUEST_NOT_FOUND');return}
 if(!window.PublicKeyCredential||!navigator.credentials?.get){show($('lead'),'This browser cannot use passkeys.');show($('error'),'Open this link in a current version of Safari, Chrome or Edge.');return}
 try{apply(await api('info',ask()))}
 catch(e){show($('lead'),'The request could not be loaded.');fail(e.code)}
}
// Two clicks on purpose: the passkey prompt must start from a click (Safari), and the challenge it signs lives 2 minutes.
$('start').onclick=async()=>{
 $('start').disabled=true;show($('error'),'');show($('status'),'Preparing the approval\\u2026');
 try{current=await api('options',ask());$('start').hidden=true;$('approve').hidden=false;$('approve').focus();
  show($('status'),info&&info.approvals>=1?'Second approver: select Approve with passkey and choose your own passkey.':'')}
 catch(e){fail(e.code);$('start').disabled=false;if(/NOT_OPEN$/.test(e.code||''))refresh()}
};
$('approve').onclick=async()=>{
 if(!current||busy)return;busy=true;$('approve').disabled=true;show($('error'),'');
 show($('status'),'Choose the approver\\'s own passkey, then confirm with fingerprint, face or device PIN.');
 const o=current.options,challengeId=current.challengeId;abort=new AbortController();
 try{
  const cred=await navigator.credentials.get({publicKey:{...o,challenge:dec(o.challenge),allowCredentials:[]},signal:abort.signal});
  const r=cred.response;
  const response={id:cred.id,rawId:enc(cred.rawId),type:cred.type,authenticatorAttachment:cred.authenticatorAttachment||undefined,
   clientExtensionResults:cred.getClientExtensionResults?cred.getClientExtensionResults():{},
   response:{clientDataJSON:enc(r.clientDataJSON),authenticatorData:enc(r.authenticatorData),signature:enc(r.signature),userHandle:r.userHandle?enc(r.userHandle):null}};
  if(GRANT)show($('status'),'Recording the approval\\u2026');
  const v=await api('verify',{challengeId,[K.key]:rid,response});
  busy=false;abort=null;current=null;retry=false;
  let i;try{i=await api('info',ask())}catch{i={...info,approvals:v.approvals,status:(v.bound||v.granted)?K.done:'OPEN'}}
  apply(i);
  if(i.status==='OPEN'){buttons(idleLabel(false));show($('status'),'Approval '+i.approvals+' of '+i.required+' recorded. Thank you.');$('start').focus()}
 }catch(e){
  busy=false;abort=null;
  if(info&&info.status!=='OPEN')return; // closed while the prompt was open: apply() already showed it
  if(e&&e.name==='AbortError')return;
  if(e&&e.name==='NotAllowedError'){show($('status'),'');show($('error'),'The passkey prompt was cancelled or timed out. Select '+idleLabel(false)+' to try again.');buttons(idleLabel(false));return}
  retry=true;fail(e&&e.code);buttons(idleLabel(true));
  if(/NOT_OPEN$|ALREADY_APPROVED$|ADMISSION/.test((e&&e.code)||''))refresh();
 }
};
async function refresh(){try{apply(await api('info',ask()))}catch{}}
$('copy').onclick=async()=>{
 const b=$('copy');
 try{await navigator.clipboard.writeText($('link').value)}catch{$('link').select();try{document.execCommand('copy')}catch{}}
 b.textContent='Copied';setTimeout(()=>{b.textContent='Copy link'},2000);
};
$('link').onfocus=()=>$('link').select();
load();
})();`;

export function startCentralEnrollment(c:CentralEnrollmentConfig){
  const origin=new URL(c.publicOrigin);
  if(origin.protocol!=='https:'||origin.host!==c.verifier.rpId||origin.pathname!=='/')throw new Error('CENTRAL_ENROLLMENT_ORIGIN_MUST_BE_HTTPS_RP_ID');
  const verifier=createCentralVerifierClient(c.verifier);
  const images=new Map<string,Buffer>();
  for(const f of Object.keys(ASSETS)){const p=path.join(c.assetsDir,f);if(fs.existsSync(p))images.set(f,fs.readFileSync(p))}
  // Per-client attempt budget (nginx passes the client address in X-Real-IP; the listener is loopback-only).
  const hits=new Map<string,number[]>(),limit=Number.isInteger(c.rateLimitPerMinute)&&(c.rateLimitPerMinute as number)>0?c.rateLimitPerMinute as number:20;
  const limited=(ip:string)=>{const now=Date.now(),w=(hits.get(ip)??[]).filter(t=>t>now-60_000);w.push(now);hits.set(ip,w);
    if(hits.size>10_000)for(const [k,v] of hits)if(!v.some(t=>t>now-60_000))hits.delete(k);return w.length>limit};

  const server=http.createServer((req,res)=>{
    const send=(status:number,type:string,body:string|Buffer,extra:Record<string,string>={})=>{
      if(res.headersSent)return;res.writeHead(status,{...SECURITY_HEADERS,'content-type':type,...extra}).end(body)};
    const json=(status:number,b:object)=>send(status,'application/json',JSON.stringify(b));
    const url=(req.url??'').split('?')[0];
    if(req.method==='GET'&&(url==='/enroll/'||url==='/enroll'))return send(200,'text/html; charset=utf-8',PAGE);
    if(req.method==='GET'&&url==='/enroll/assets/enroll.css')return send(200,'text/css; charset=utf-8',CSS);
    if(req.method==='GET'&&url==='/enroll/assets/enroll.js')return send(200,'text/javascript; charset=utf-8',JS);
    if(req.method==='GET'&&(url==='/approve/'||url==='/approve'))return send(200,'text/html; charset=utf-8',APPROVE_PAGE);
    if(req.method==='GET'&&url==='/approve/assets/approve.js')return send(200,'text/javascript; charset=utf-8',APPROVE_JS);
    const img=url.startsWith('/enroll/assets/')?url.slice('/enroll/assets/'.length):'';
    if(req.method==='GET'&&ASSETS[img]&&images.has(img))return send(200,ASSETS[img],images.get(img) as Buffer,{'cache-control':'public, max-age=86400'});
    const API=new Set(['/enroll/api/options','/enroll/api/verify','/approve/api/info','/approve/api/options','/approve/api/verify',
      '/approve/api/grant/info','/approve/api/grant/options','/approve/api/grant/verify']);
    if(req.method!=='POST'||!API.has(url))return json(404,{error:'NOT_FOUND'});
    const site=req.headers['sec-fetch-site'];
    if(req.headers.origin!==origin.origin||(site!==undefined&&site!=='same-origin')||!/^application\/json(;|$)/i.test(String(req.headers['content-type']??'')))
      return json(403,{error:'REQUEST_REJECTED'});
    const ip=String(req.headers['x-real-ip']??req.socket.remoteAddress??'-');
    if(limited(ip))return json(429,{error:'RATE_LIMITED'});
    let raw='',size=0,tooBig=false;req.setEncoding('utf8');
    req.on('data',(x:string)=>{size+=Buffer.byteLength(x);if(size>MAX_BODY){tooBig=true;json(413,{error:'REQUEST_TOO_LARGE'});req.destroy()}else raw+=x});
    req.on('end',async()=>{
      if(tooBig)return;
      let b:any;try{b=JSON.parse(raw)}catch{return json(400,{error:'REQUEST_INVALID'})}
      const ids={requestId:crypto.randomUUID(),correlationId:crypto.randomUUID()};
      try{
        if(url.startsWith('/approve/api/grant/')){
          const UUIDV=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
          if(typeof b?.grantRequestId!=='string'||!UUIDV.test(b.grantRequestId))return json(400,{error:'REQUEST_INVALID'});
          if(url==='/approve/api/grant/info')return json(200,await verifier.grantInfo(b.grantRequestId,ids));
          if(url==='/approve/api/grant/options'){
            const o=await verifier.grantOptions(b.grantRequestId,ids);
            if(o?.options?.rpId!==c.verifier.rpId||o?.options?.userVerification!=='required')return json(502,{error:'APPROVAL_UNAVAILABLE'});
            return json(200,{challengeId:o.challengeId,options:o.options});
          }
          if(typeof b.challengeId!=='string'||!UUIDV.test(b.challengeId)||!b.response||typeof b.response!=='object')return json(400,{error:'REQUEST_INVALID'});
          const v=await verifier.grantVerify({challengeId:b.challengeId,grantRequestId:b.grantRequestId,response:b.response},ids);
          console.log(JSON.stringify({level:'info',msg:'grant approval recorded',granted:v.granted,grants:v.grants,approvals:v.approvals,requestId:ids.requestId}));
          return json(200,{approved:true,approvals:v.approvals,granted:v.granted,grants:v.grants});
        }
        if(url.startsWith('/approve/api/')){
          const UUIDV=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
          if(typeof b?.bindingRequestId!=='string'||!UUIDV.test(b.bindingRequestId))return json(400,{error:'REQUEST_INVALID'});
          if(url==='/approve/api/info')return json(200,await verifier.approvalInfo(b.bindingRequestId,ids));
          if(url==='/approve/api/options'){
            const o=await verifier.approvalOptions(b.bindingRequestId,ids);
            if(o?.options?.rpId!==c.verifier.rpId||o?.options?.userVerification!=='required')return json(502,{error:'APPROVAL_UNAVAILABLE'});
            return json(200,{challengeId:o.challengeId,options:o.options});
          }
          if(typeof b.challengeId!=='string'||!UUIDV.test(b.challengeId)||!b.response||typeof b.response!=='object')return json(400,{error:'REQUEST_INVALID'});
          const v=await verifier.approvalVerify({challengeId:b.challengeId,bindingRequestId:b.bindingRequestId,response:b.response},ids);
          console.log(JSON.stringify({level:'info',msg:'binding approval recorded',bound:v.bound,approvals:v.approvals,requestId:ids.requestId}));
          return json(200,{approved:true,approvals:v.approvals,bound:v.bound});
        }
        if(url==='/enroll/api/options'){
          if(typeof b?.token!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(b.token))return json(403,{error:'CENTRAL_INVITE_INVALID'});
          const o=await verifier.enrollmentOptions(b.token,ids);
          if(o?.options?.rp?.id!==c.verifier.rpId)return json(502,{error:'ENROLLMENT_UNAVAILABLE'});
          return json(200,{challengeId:o.challengeId,options:o.options});
        }
        if(typeof b?.challengeId!=='string'||!b.response||typeof b.response!=='object'||(b.friendlyName!==undefined&&(typeof b.friendlyName!=='string'||b.friendlyName.length>60)))
          return json(400,{error:'REQUEST_INVALID'});
        await verifier.enrollmentVerify({challengeId:b.challengeId,response:b.response,friendlyName:b.friendlyName},ids);
        console.log(JSON.stringify({level:'info',msg:'central passkey enrolled',requestId:ids.requestId}));
        return json(200,{enrolled:true});
      }catch(e){
        if(e instanceof CentralCallError)return json(e.status===403?403:503,{error:e.code});
        return json(503,{error:'ENROLLMENT_UNAVAILABLE'});
      }
    });
  });
  server.on('error',e=>console.error(JSON.stringify({level:'error',msg:'central enrollment error',error:e.message})));
  server.listen(c.port,c.host,()=>console.log(JSON.stringify({level:'info',msg:'central enrollment listening',port:c.port,rpId:c.verifier.rpId})));
  return {close:()=>new Promise<void>(resolve=>server.close(()=>resolve()))};
}
