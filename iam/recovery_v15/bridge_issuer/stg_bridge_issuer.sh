#!/usr/bin/env bash
# STAGING ONLY. Give the central OIDC issuer its OWN access to the 623 IAM bridge (separate from the EOC BFF), per the
# dev team's handoff (separate certificate identities + audience-scoped HMAC keys):
#   - transport: issuer client cert (CN tcds-oidc-issuer-staging, URI urn:tcds:workload:oidc-issuer:staging) from our
#     staging CA; the 9443 proxy accepts a list of identities, each with a caller name it passes upstream
#   - request auth: the bridge accepts the issuer's own key (EOC_IAM_ISSUER_TOKEN) and requires the key to belong to the
#     caller whose certificate the proxy verified; it also accepts the issuer's hex nonces
# Codex's BFF identity, key and behaviour are unchanged.
#   inspect        read only
#   issuer-cert    CONFIRM=ISSUER-CERT   key + CSR in /etc/tcds-issuer, signed by the staging CA (90 d), allowlisted
#   patch-bridge   CONFIRM=PATCH-BRIDGE  staging login-v2-api: new internalIamApi.ts + EOC_IAM_ISSUER_TOKEN (taken from
#                  /etc/tcds-issuer/private-iam-keys.json, never printed); compile, deploy, restart staging api only
#   patch-proxy    CONFIRM=PATCH-PROXY   eoc-mtls-proxy-staging: identities list + caller header; restart (~2 s)
#   hosts          CONFIRM=HOSTS         sudo: 127.0.0.1 iam-bridge-stg.tcds.internal in /etc/hosts (loopback route)
#   test           issuer readiness + subject refusal + key/identity binding + issuer /internal/health/ready
#   revert         CONFIRM=REVERT-BRIDGE-ISSUER  restore bridge + proxy backups, restart both
# Usage: bash /tmp/recov15/bridge_issuer/stg_bridge_issuer.sh <cmd>     (run from /srv/arb-system/api)
set -euo pipefail
D=/tmp/recov15/bridge_issuer
S=$HOME/stg_login
B=$S/6.1B
M=$S/mtls
SEC=/etc/tcds-issuer
BK=$S/bridge_issuer_backup
RT=/srv/arb-system/oidc_issuer/runtime/node-v22.23.4-linux-x64/bin/node
APPDIR=/srv/arb-system/oidc_issuer/current
API=http://127.0.0.1:8195
APP=login-v2-api-staging
PROXY=eoc-mtls-proxy-staging
ISSUER=oidc-issuer-staging
ICN=tcds-oidc-issuer-staging
IURI=urn:tcds:workload:oidc-issuer:staging
HOSTLINE="127.0.0.1 iam-bridge-stg.tcds.internal"
FILES="src/express/internalIamApi.ts src/config/env.ts src/express/integration.ts"
OUTS="dist/express/internalIamApi.js dist/config/env.js dist/express/integration.js"
umask 077
clean_pm2() { env -i HOME="$HOME" PATH="$PATH" USER="$USER" LANG=C.UTF-8 pm2 "$@"; }
fp() { openssl x509 -in "$1" -noout -fingerprint -sha256 | sed 's/^.*=//' | tr 'a-f' 'A-F'; }
( cd $D && sha256sum -c --quiet - ) <<'SUMS' || { echo "files differ from the reviewed copies - stopping"; exit 1; }
fc4267bfe8fdbaeec9d63f006f1a2db8ba865e93b3d18a79836ecc7f8d4dad4a  internalIamApi.ts
0ae8acb3e277020d278f1cebc0f57df0e2d4b75e2f7b72823ef3cb39005ab53a  eocMtlsProxy.cjs
SUMS
grep -q kqcdqtazcqaawdkmcfed "$S/config.json" || { echo "$S/config.json is not the staging config - stopping"; exit 1; }
restart_api() {
  clean_pm2 restart "$APP" >/dev/null
  for i in $(seq 1 30); do
    [ "$(curl -s -o /dev/null -m 3 -w '%{http_code}' "$API/" || true)" = "404" ] && break; sleep 1
  done
  for i in $(seq 1 15); do ss -ltn | grep -q '127.0.0.1:8196 ' && { echo "$APP restarted; bridge listening on 127.0.0.1:8196"; return 0; }; sleep 1; done
  echo "!! bridge not listening after restart:"; pm2 logs "$APP" --nostream --lines 30 2>&1 | tail -30; exit 1
}

case "${1:-}" in
inspect)
  echo "bridge src is the issuer version: $(grep -q eocIssuerSecret "$B/src/express/internalIamApi.ts" && echo yes || echo no)"
  echo "config: EOC_IAM_SERVICE_TOKEN $(node -e 'const c=require(process.argv[1]);console.log(c.api.EOC_IAM_SERVICE_TOKEN?"set":"MISSING")' "$S/config.json"), EOC_IAM_ISSUER_TOKEN $(node -e 'const c=require(process.argv[1]);console.log(c.api.EOC_IAM_ISSUER_TOKEN?"set":"not set")' "$S/config.json")"
  echo "proxy identities: $(node -e 'const c=require(process.argv[1]);console.log(JSON.stringify((c.identities||[c.identity]).map(i=>(i.caller||"-")+"="+i.cn)))' "$M/config.json")"
  echo "issuer client cert: $( [ -f "$SEC/issuer-client.pem" ] && openssl x509 -in "$SEC/issuer-client.pem" -noout -subject -enddate | tr '\n' ' ' || echo absent)"
  echo "issuer keys file: $( [ -f "$SEC/private-iam-keys.json" ] && echo present || echo MISSING)"
  echo "hosts line: $(grep -qxF "$HOSTLINE" /etc/hosts && echo present || echo absent)"
  echo "allowlisted client certs: $(grep -c . "$M/allowed_clients.txt" || true)"
  for p in $APP $PROXY $ISSUER; do echo "pm2 $p: $(pm2 jlist 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const p=JSON.parse(s).find(x=>x.name===process.argv[1]);console.log(p?p.pm2_env.status:"absent")})' "$p")"; done
  ;;
issuer-cert)
  [ "${CONFIRM:-}" = "ISSUER-CERT" ] || { echo "set CONFIRM=ISSUER-CERT"; exit 1; }
  [ -f "$SEC/issuer-client.pem" ] && { echo "$SEC/issuer-client.pem exists - stopping"; exit 1; }
  [ -f "$M/ca.key" ] || { echo "staging CA missing in $M"; exit 1; }
  openssl ecparam -name prime256v1 -genkey -noout -out "$SEC/issuer-client.key"; chmod 600 "$SEC/issuer-client.key"
  openssl req -new -key "$SEC/issuer-client.key" -subj "/CN=$ICN" -out "$SEC/issuer-client.csr"
  printf 'basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=clientAuth\nsubjectAltName=URI:%s\n' "$IURI" > "$SEC/issuer-client.ext"
  openssl x509 -req -in "$SEC/issuer-client.csr" -CA "$M/ca.crt" -CAkey "$M/ca.key" -set_serial "0x$(openssl rand -hex 16)" -days 90 -sha256 \
    -extfile "$SEC/issuer-client.ext" -out "$SEC/issuer-client.pem" 2>/dev/null
  rm -f "$SEC/issuer-client.csr" "$SEC/issuer-client.ext"; chmod 600 "$SEC/issuer-client.pem"
  install -m 600 "$M/ca.crt" "$SEC/iam-ca.pem"
  openssl verify -CAfile "$M/ca.crt" -purpose sslclient "$SEC/issuer-client.pem"
  cp "$SEC/issuer-client.pem" "$M/issued/oidc-issuer-$(date -u +%Y%m%dT%H%M%SZ).crt"
  F=$(fp "$SEC/issuer-client.pem"); echo "$F" >> "$M/allowed_clients.txt"
  openssl x509 -in "$SEC/issuer-client.pem" -noout -subject -ext subjectAltName,extendedKeyUsage -enddate
  echo "issuer client cert allowlisted: $F (key never left $SEC)"
  ;;
patch-bridge)
  [ "${CONFIRM:-}" = "PATCH-BRIDGE" ] || { echo "set CONFIRM=PATCH-BRIDGE"; exit 1; }
  [ -e "$BK" ] && { echo "$BK exists - already patched? (revert first)"; exit 1; }
  [ -f "$SEC/private-iam-keys.json" ] || { echo "$SEC/private-iam-keys.json missing (run issuer_deploy.sh secrets)"; exit 1; }
  cd "$B"
  grep -q "eoc_bridge_admit_nonce_v623" src/express/internalIamApi.ts || { echo "deployed src is not the 623 bridge version - stopping"; exit 1; }
  grep -q "EOC_IAM_SERVICE_TOKEN:z.string().min(32).optional()" src/config/env.ts || { echo "env.ts lacks the eoc64 patch - stopping"; exit 1; }
  SCR=$(mktemp -d "$S/bridge_issuer_build.XXXX")
  ./node_modules/.bin/tsc -p tsconfig.json --outDir "$SCR/base"
  for o in $OUTS; do cmp -s "$SCR/base/${o#dist/}" "$o" || { echo "REFUSING: deployed $o is not the current src"; rm -rf "$SCR"; exit 1; }; echo "match: $o"; done
  mkdir -p "$BK"; chmod 700 "$BK"
  for f in $FILES $OUTS; do mkdir -p "$BK/$(dirname $f)"; cp -p "$f" "$BK/$f"; done
  cp -p "$S/config.json" "$BK/config.json"
  cp "$D/internalIamApi.ts" src/express/internalIamApi.ts
  node - "$B" <<'NODE'
const fs=require("fs"),path=require("path"),B=process.argv[2];
function edit(file,pairs){const p=path.join(B,file);let s=fs.readFileSync(p,"utf8");
 for(const [a,b] of pairs){const n=s.split(a).length-1;if(n!==1)throw Error(file+": expected 1 match, found "+n+" for: "+a.slice(0,70));s=s.replace(a,()=>b)}
 fs.writeFileSync(p,s);console.log("patched "+file)}
edit("src/config/env.ts",[["EOC_IAM_SERVICE_TOKEN:z.string().min(32).optional()",
  "EOC_IAM_SERVICE_TOKEN:z.string().min(32).optional(),\n EOC_IAM_ISSUER_TOKEN:z.string().min(32).optional()"]]);
edit("src/express/integration.ts",[["eocBridgeSecret:d.env.EOC_IAM_SERVICE_TOKEN})",
  "eocBridgeSecret:d.env.EOC_IAM_SERVICE_TOKEN,eocIssuerSecret:d.env.EOC_IAM_ISSUER_TOKEN})"]]);
NODE
  ./node_modules/.bin/tsc -p tsconfig.json --noEmit
  ./node_modules/.bin/tsc -p tsconfig.json --outDir "$SCR/new"
  for o in $OUTS; do cp "$SCR/new/${o#dist/}" "$o"; chmod 644 "$o"; done
  rm -rf "$SCR"
  # The issuer's bridge key, copied locally from the issuer's secrets (same server; never printed).
  node -e 'const fs=require("fs"),c=JSON.parse(fs.readFileSync(process.argv[1],"utf8")),k=JSON.parse(fs.readFileSync(process.argv[2],"utf8")).IAM_EOC_BRIDGE_KEY;
    if(!k||k.length<32)throw Error("issuer bridge key missing");if(k===c.api.EOC_IAM_SERVICE_TOKEN)throw Error("issuer key equals the BFF key");
    c.api.EOC_IAM_ISSUER_TOKEN=k;fs.writeFileSync(process.argv[1],JSON.stringify(c,null,2));' "$S/config.json" "$SEC/private-iam-keys.json"
  chmod 600 "$S/config.json"
  sha256sum $FILES $OUTS
  restart_api
  pm2 logs "$APP" --nostream --lines 40 2>/dev/null | grep -o '"oidcIssuer":[a-z]*' | tail -1
  echo "BRIDGE PATCHED (backup in $BK)"
  ;;
patch-proxy)
  [ "${CONFIRM:-}" = "PATCH-PROXY" ] || { echo "set CONFIRM=PATCH-PROXY"; exit 1; }
  [ -f "$SEC/issuer-client.pem" ] || { echo "run issuer-cert first"; exit 1; }
  mkdir -p "$BK/proxy"; [ -e "$BK/proxy/config.json" ] && { echo "proxy backup exists - already patched?"; exit 1; }
  cp -p "$M/config.json" "$M/eocMtlsProxy.cjs" "$BK/proxy/"
  node -e 'const fs=require("fs"),p=process.argv[1],c=JSON.parse(fs.readFileSync(p,"utf8"));
    if(!c.identity)throw Error("no existing identity");
    c.identities=[{caller:"eoc-bff",cn:c.identity.cn,uri:c.identity.uri},{caller:"oidc-issuer",cn:process.argv[2],uri:process.argv[3]}];
    fs.writeFileSync(p,JSON.stringify(c));' "$M/config.json" "$ICN" "$IURI"
  install -m 600 "$D/eocMtlsProxy.cjs" "$M/eocMtlsProxy.cjs"
  clean_pm2 restart "$PROXY" >/dev/null
  for i in $(seq 1 10); do ss -ltn | grep -q '0.0.0.0:9443 ' && break; sleep 1; done
  ss -ltn | grep -q '0.0.0.0:9443 ' || { echo "!! proxy not listening"; pm2 logs "$PROXY" --nostream --lines 20; exit 1; }
  echo "proxy restarted with identities: $(node -e 'console.log(require(process.argv[1]).identities.map(i=>i.caller+"="+i.cn).join(", "))' "$M/config.json")"
  ;;
hosts)
  [ "${CONFIRM:-}" = "HOSTS" ] || { echo "set CONFIRM=HOSTS"; exit 1; }
  grep -qxF "$HOSTLINE" /etc/hosts && { echo "already present"; exit 0; }
  echo "$HOSTLINE" | sudo tee -a /etc/hosts >/dev/null; getent hosts iam-bridge-stg.tcds.internal
  ;;
test)
  ck() { printf '%-5s %-70s %s\n' "$( [[ "$2" =~ $3 ]] && echo PASS || echo FAIL)" "$1" "$(echo "$2" | head -c 100)"; }
  run() { (cd "$APPDIR" && env -i HOME="$HOME" PATH=/usr/bin:/bin BFF_KEY_FILE="$S/config.json" "$RT" --env-file="$SEC/issuer.env" --input-type=module -e "$1" 2>&1) | tail -1; }
  ck "T1 issuer readiness through proxy + bridge (issuer cert + issuer key)" "$(run 'import {createIamVerifier} from "./src/iam-verifier-client.mjs";try{await createIamVerifier(process.env).readiness();console.log("READY")}catch(e){console.log(e.message)}')" "^READY$"
  ck "T2 unbound subject refused" "$(run 'import {createIamVerifier} from "./src/iam-verifier-client.mjs";try{await createIamVerifier(process.env).checkSubject({issuer:"https://login-stg.tcdsolutionsgroup.com",subject:"v1.no-such-binding-0000"});console.log("ACCEPTED")}catch(e){console.log(e.message)}')" "^IAM_VERIFIER_DENIED$"
  ck "T3 issuer cert + the BFF key refused (key bound to identity)" "$(run 'import {createIamVerifier} from "./src/iam-verifier-client.mjs";import fs from "node:fs";const k=JSON.parse(fs.readFileSync(process.env.BFF_KEY_FILE,"utf8")).api.EOC_IAM_SERVICE_TOKEN;try{await createIamVerifier({...process.env,IAM_EOC_BRIDGE_KEY:k}).readiness();console.log("ACCEPTED")}catch(e){console.log(e.message)}')" "^IAM_VERIFIER_DENIED$"
  ck "T4 issuer cert + a random key refused" "$(run 'import {createIamVerifier} from "./src/iam-verifier-client.mjs";try{await createIamVerifier({...process.env,IAM_EOC_BRIDGE_KEY:"r".repeat(48)}).readiness();console.log("ACCEPTED")}catch(e){console.log(e.message)}')" "^IAM_VERIFIER_DENIED$"
  clean_pm2 restart "$ISSUER" >/dev/null; sleep 3
  ck "T5 issuer /internal/health/ready now ready" "$(curl -s -m 8 -H 'Host: login-stg.tcdsolutionsgroup.com' http://127.0.0.1:8401/internal/health/ready)" '"ready":true.*"iamBridge":true'
  ck "T6 bridge attributes the calls to oidc-issuer" "$(pm2 logs "$APP" --nostream --lines 60 2>/dev/null | grep -o '"caller":"oidc-issuer","viaProxy":"oidc-issuer"' | tail -1)" 'oidc-issuer'
  echo "Regression for Codex's BFF path: run   bash /tmp/recov15/mtls/stg_mtls.sh selftest   and   bash /tmp/recov15/stg_eoc64.sh test"
  ;;
revert)
  [ "${CONFIRM:-}" = "REVERT-BRIDGE-ISSUER" ] || { echo "set CONFIRM=REVERT-BRIDGE-ISSUER"; exit 1; }
  [ -d "$BK" ] || { echo "no backup at $BK"; exit 1; }
  cd "$B"; for f in $FILES $OUTS; do [ -f "$BK/$f" ] && cp -p "$BK/$f" "$f"; done
  [ -f "$BK/config.json" ] && cp -p "$BK/config.json" "$S/config.json"
  restart_api
  if [ -f "$BK/proxy/config.json" ]; then cp -p "$BK/proxy/config.json" "$BK/proxy/eocMtlsProxy.cjs" "$M/"; clean_pm2 restart "$PROXY" >/dev/null; echo "proxy restored"; fi
  mv "$BK" "$BK.reverted.$(date -u +%Y%m%dT%H%M%SZ)"; echo "REVERTED (issuer cert stays allowlisted; remove with stg_mtls.sh revoke)"
  ;;
*) echo "usage: $0 inspect|issuer-cert|patch-bridge|patch-proxy|hosts|test|revert"; exit 2 ;;
esac
