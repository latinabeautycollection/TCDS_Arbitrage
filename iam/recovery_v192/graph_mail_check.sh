#!/usr/bin/env bash
# Recovery V1.9.2 delivery check: can the existing Domain 10 Microsoft Graph identity send recovery codes?
# Prints NO secrets: env values are masked, the access token is never printed (only its roles/app claims).
#   check          read-only: env keys, PM2 email-workers, token + Mail.Send role, sender mailbox, last deliveries
#   send TO=<addr> CONFIRM=SEND-TEST   sends ONE plain test mail from the configured sender to <addr>
# Copy first: scp graph_mail_check.sh apifydev@139.177.200.80:/tmp/recov192/
set -euo pipefail
ENV_FILE=${ENV_FILE:-/srv/arb-system/api/.env}
[ -r "$ENV_FILE" ] || { echo "cannot read $ENV_FILE"; exit 1; }

node_graph() {  # $1 = mode (check|send); env file parsed inside node so secrets never hit argv
  MODE="$1" ENV_FILE="$ENV_FILE" TO="${TO:-}" node - <<'JS'
const fs=require('fs');
const env={};for(const l of fs.readFileSync(process.env.ENV_FILE,'utf8').split(/\r?\n/)){const m=l.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)\s*$/);if(m)env[m[1]]=m[2].replace(/^['"]|['"]$/g,'');}
const pick=(re)=>Object.keys(env).filter(k=>re.test(k));
const keys=pick(/M365|GRAPH|AZURE|EMAIL|MAIL|SENDER/);
console.log('== env keys (values masked)');for(const k of keys){const v=env[k]||'';console.log(`  ${k}=${/SECRET|PASSWORD|KEY|TOKEN/.test(k)?(v?'<set, '+v.length+' chars>':'<empty>'):v}`);}
// Only the M365 keys the Domain 10 email module uses (other apps, e.g. eBay, also have *_CLIENT_ID / *_CLIENT_SECRET).
const tenant=env.M365_TENANT_ID,client=env.M365_CLIENT_ID,secret=env.M365_CLIENT_SECRET;
const sender=(env.M365_ALLOWED_SENDER||env.M365_ALERT_FROM||'').split(',')[0].trim()||undefined;
if(!tenant||!client||!secret){console.log('!! M365_TENANT_ID / M365_CLIENT_ID / M365_CLIENT_SECRET not all set - stopping');process.exit(1);}
console.log(`== sender mailbox: ${sender||'!! not found in env'}`);
(async()=>{
 const r=await fetch(`https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`,{method:'POST',
  headers:{'Content-Type':'application/x-www-form-urlencoded'},
  body:new URLSearchParams({client_id:client,client_secret:secret,scope:'https://graph.microsoft.com/.default',grant_type:'client_credentials'}),signal:AbortSignal.timeout(15000)});
 const j=await r.json().catch(()=>({}));
 if(!r.ok||!j.access_token){console.log(`!! token request failed: HTTP ${r.status} ${j.error||''} ${(j.error_description||'').split('\r')[0].slice(0,160)}`);process.exit(1);}
 const claims=JSON.parse(Buffer.from(j.access_token.split('.')[1],'base64url').toString());
 const exp=new Date(claims.exp*1000).toISOString();
 console.log(`== token OK (app ${claims.app_displayname||claims.appid}, expires ${exp})`);
 console.log(`   roles: ${(claims.roles||[]).join(', ')||'(none)'}`);
 console.log(`   Mail.Send: ${(claims.roles||[]).includes('Mail.Send')?'YES':'!! NO'}`);
 const H={Authorization:`Bearer ${j.access_token}`};
 if(sender){
  const u=await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(sender)}?$select=mail,accountEnabled,userPrincipalName`,{headers:H,signal:AbortSignal.timeout(15000)});
  console.log(`== sender lookup: HTTP ${u.status}${u.status===403?' (app lacks User.Read.All - not needed for sending)':''}${u.ok?' '+JSON.stringify(await u.json()):''}`);
 }
 if(process.env.MODE==='send'){
  const to=process.env.TO;if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to||'')){console.log('!! TO=<address> required');process.exit(1);}
  if(!sender){console.log('!! no sender');process.exit(1);}
  const s=await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(sender)}/sendMail`,{method:'POST',headers:{...H,'Content-Type':'application/json'},
   body:JSON.stringify({message:{subject:'TCDS Warehouse recovery - delivery test',body:{contentType:'Text',content:'Test message for the warehouse password recovery delivery check. No action needed.'},
   toRecipients:[{emailAddress:{address:to}}]},saveToSentItems:false}),signal:AbortSignal.timeout(15000)});
  const t=s.status===202?'':(await s.text()).slice(0,200);
  console.log(`== sendMail: HTTP ${s.status} ${s.status===202?'ACCEPTED':'!! '+t}`);
 }
})().catch(e=>{console.log('!! '+e.message);process.exit(1);});
JS
}

case "${1:-}" in
check)
  echo "== PM2 processes with mail/email/domain10 in the name"; pm2 jlist 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const l=JSON.parse(s||"[]").filter(p=>/mail|domain10|notif/i.test(p.name));if(!l.length)console.log("  none");for(const p of l)console.log(`  ${p.name} (id ${p.pm_id}) ${p.pm2_env.status}`)})' || echo "  pm2 not available"
  node_graph check || true
  echo "== recent Domain 10 deliveries (state + time only)"
  DB=$(grep -E '^\s*DATABASE_URL=' "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d "'\"" | sed 's/sslmode=no-verify/sslmode=require/')
  [ -n "$DB" ] && psql "$DB" -X -q -A -F ' | ' -v ON_ERROR_STOP=0 <<'SQL' 2>&1 | grep -v '^$' | head -20 || echo "  (no DATABASE_URL)"
\pset footer off
DO $$ BEGIN IF to_regclass('operations.notification_deliveries') IS NULL THEN RAISE NOTICE 'operations.notification_deliveries missing'; END IF; END $$;
SELECT format('SELECT %I AS state, count(*) AS n, max(%I) AS last_at FROM operations.notification_deliveries GROUP BY 1 ORDER BY 3 DESC NULLS LAST',s,t)
 FROM (SELECT (array_agg(column_name::text ORDER BY ordinal_position) FILTER (WHERE column_name ~ '(state|status)$'))[1] s,
              (array_agg(column_name::text ORDER BY column_name DESC) FILTER (WHERE column_name IN ('updated_at','created_at')))[1] t
       FROM information_schema.columns WHERE table_schema='operations' AND table_name='notification_deliveries') x
 WHERE s IS NOT NULL AND t IS NOT NULL \gexec
SQL
  ;;
send)
  [ "${CONFIRM:-}" = "SEND-TEST" ] || { echo "set CONFIRM=SEND-TEST and TO=<your address>"; exit 1; }
  node_graph send ;;
*) sed -n '2,7p' "$0"; exit 2 ;;
esac
