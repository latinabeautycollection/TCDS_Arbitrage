#!/usr/bin/env bash
# CENTRAL OIDC ISSUER (Domain 6.4 V1.2), STAGING, on the Warehouse server. Loopback only (127.0.0.1:8401): no nginx site
# until the login-stg DNS record exists. Vendor issuer source unchanged; our package.json/lockfile (oidc-provider 9.13.3).
# Own Node 22 runtime; the system Node 20 used by login-v2-api / PWA is not touched.
#   check            read only: arch, runtime, app, secrets dir, port, PM2 state
#   install-runtime  download Node v22.23.4 from nodejs.org, verify the PINNED sha256, unpack under $BASE/runtime
#   install-app      unpack the sha-pinned bundle, npm ci (public registry, no install scripts), node --check, run 130 tests
#   secrets          CONFIRM=ISSUER-SECRETS (sudo once to create /etc/tcds-issuer owned by you, 0700). Vendor
#                    provision-private-secrets.mjs (RS256-3072 JWKS, client id/secret, cookie + CSRF keys) + our IAM keys +
#                    Supabase CA + issuer.env (0600). Never prints a secret; refuses to overwrite.
#   start            CONFIRM=START-ISSUER: PM2 `oidc-issuer-staging` from a CLEAN environment (no shell secrets inherited)
#   verify           read only: loopback discovery/JWKS/refusals with Host login-stg; expects IAM readiness to FAIL for now
#   stop             pm2 stop + delete oidc-issuer-staging
# Usage: bash /tmp/recov15/oidc_issuer/issuer_deploy.sh <cmd>
set -euo pipefail
D=/tmp/recov15/oidc_issuer
BASE=/srv/arb-system/oidc_issuer
SEC=/etc/tcds-issuer
NODEV=v22.23.4
NODE_SHA_X64=1805bcd35e6815559bd2eb97db438d3fdb0eb3a5e6a977b7c1badca76337e9ce
BUNDLE=issuer-v1.2-r2
BUNDLE_SHA=14a4abf89bd1268c7344fbac055d96399924338ce842a4891fb56a9b762fb654
RT=$BASE/runtime/node-$NODEV-linux-x64
APP=$BASE/app/$BUNDLE
NAME=oidc-issuer-staging
ISSUER_HOST=login-stg.tcdsolutionsgroup.com
DBHOST=db.crydmokyojaynmrtxkym.supabase.co
umask 077
clean_pm2() { env -i HOME="$HOME" PATH="$PATH" USER="$USER" LANG=C.UTF-8 pm2 "$@"; }
need_runtime() { [ -x "$RT/bin/node" ] || { echo "run install-runtime first"; exit 1; }; }
need_app() { [ -f "$APP/src/server.mjs" ] && [ -d "$APP/node_modules" ] || { echo "run install-app first"; exit 1; }; }

case "${1:-}" in
check)
  echo "arch: $(uname -m) (bundle expects x86_64)"
  echo "system node: $(node --version 2>/dev/null) (left untouched)"
  echo "issuer runtime: $( [ -x "$RT/bin/node" ] && "$RT/bin/node" --version || echo 'not installed')"
  echo "app: $( [ -f "$APP/src/server.mjs" ] && echo "$APP" || echo 'not installed')"
  echo "secrets dir: $( [ -d "$SEC" ] && stat -c '%U %a' "$SEC" || echo 'absent')"
  [ -d "$SEC" ] && ls -1 "$SEC" | sed 's/^/  /'
  echo "port 8401: $(ss -ltn 2>/dev/null | grep -q '127.0.0.1:8401 ' && echo 'in use' || echo free)"
  echo "pm2: $(pm2 jlist 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const p=JSON.parse(s).find(x=>x.name===process.argv[1]);console.log(p?p.pm2_env.status:"not running")})' "$NAME")"
  echo "DB credentials file: $( [ -f "$HOME/stg_login/eoc_oidc_db.env" ] && echo present || echo MISSING)"
  ;;
install-runtime)
  [ "$(uname -m)" = "x86_64" ] || { echo "not x86_64 - stopping"; exit 1; }
  [ -x "$RT/bin/node" ] && { echo "runtime already installed: $("$RT/bin/node" --version)"; exit 0; }
  mkdir -p "$BASE/runtime"; chmod 700 "$BASE"
  T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
  curl -fsSL --proto '=https' -o "$T/node.tar.xz" "https://nodejs.org/dist/$NODEV/node-$NODEV-linux-x64.tar.xz"
  echo "$NODE_SHA_X64  $T/node.tar.xz" | sha256sum -c --quiet - || { echo "Node tarball checksum MISMATCH - stopping"; exit 1; }
  tar -xJf "$T/node.tar.xz" -C "$BASE/runtime"
  echo "runtime installed: $("$RT/bin/node" --version) at $RT (checksum verified)"
  ;;
install-app)
  need_runtime
  [ -e "$APP" ] && { echo "$APP exists - stopping"; exit 1; }
  echo "$BUNDLE_SHA  $D/$BUNDLE.tgz" | sha256sum -c --quiet - || { echo "bundle differs from the reviewed copy - stopping"; exit 1; }
  mkdir -p "$BASE/app"; tar -xzf "$D/$BUNDLE.tgz" -C "$BASE/app"
  cd "$APP"
  PATH="$RT/bin:/usr/bin:/bin" npm ci --ignore-scripts --omit=dev --no-fund --no-audit --registry=https://registry.npmjs.org/ 2>&1 | tail -2
  PATH="$RT/bin:/usr/bin:/bin" npm audit --omit=dev --registry=https://registry.npmjs.org/ 2>&1 | tail -1
  PATH="$RT/bin:/usr/bin:/bin" npm ls oidc-provider pg 2>/dev/null | tail -3
  for f in src/server.mjs src/security-v11.mjs src/iam-verifier-client.mjs src/pg-adapter.mjs src/central-iam-route-adapter.mjs deploy/issuer-passkey-mtls-proxy.cjs; do "$RT/bin/node" --check "$f"; done
  echo "syntax check OK"
  "$RT/bin/node" --test tests/*.test.mjs 2>&1 | grep -E '^# (tests|pass|fail)'
  ln -sfn "$APP" "$BASE/current"
  echo "app installed at $APP"
  ;;
secrets)
  [ "${CONFIRM:-}" = "ISSUER-SECRETS" ] || { echo "set CONFIRM=ISSUER-SECRETS"; exit 1; }
  need_runtime; need_app
  [ -f "$HOME/stg_login/eoc_oidc_db.env" ] || { echo "~/stg_login/eoc_oidc_db.env missing (run stg_oidc_db.sh bind-login)"; exit 1; }
  if [ ! -d "$SEC" ]; then
    echo "creating $SEC (owner $USER, 0700) - sudo password needed once"
    sudo install -d -o "$USER" -g "$(id -gn)" -m 700 "$SEC"
  fi
  [ "$(stat -c '%U %a' "$SEC")" = "$USER 700" ] || { echo "$SEC must be owned by $USER with mode 700 - stopping"; exit 1; }
  [ -e "$SEC/issuer.env" ] && { echo "$SEC/issuer.env exists - refusing to overwrite"; exit 1; }
  # 1. vendor generator: signing JWKS, client id/secret, cookie keys, CSRF key (refuses to overwrite)
  "$RT/bin/node" "$APP/scripts/provision-private-secrets.mjs" "$SEC/"
  # 2. our IAM keys: passkey route signing key, and a NEW issuer-only key for the 623 bridge (not the EOC BFF's token)
  "$RT/bin/node" -e 'const c=require("crypto"),fs=require("fs");fs.writeFileSync(process.argv[1],JSON.stringify({IAM_WORKLOAD_KEY:c.randomBytes(48).toString("base64url"),IAM_EOC_BRIDGE_KEY:c.randomBytes(48).toString("base64url")}),{mode:0o600,flag:"wx"})' "$SEC/private-iam-keys.json"
  # 3. Supabase CA for verified Postgres TLS (the issuer refuses unverified TLS)
  if [ ! -f "$SEC/postgres-ca.pem" ]; then
    T=$(mktemp -d)
    openssl s_client -starttls postgres -connect "$DBHOST:5432" -showcerts </dev/null 2>/dev/null \
      | awk '/BEGIN CERTIFICATE/{n++;f=sprintf("'"$T"'/c%02d.pem",n)} f{print > f} /END CERTIFICATE/{f=""}'
    ROOT=""
    for c in "$T"/c*.pem; do [ -f "$c" ] || continue
      [ "$(openssl x509 -in "$c" -noout -subject -nameopt RFC2253 | sed 's/^subject=//')" = "$(openssl x509 -in "$c" -noout -issuer -nameopt RFC2253 | sed 's/^issuer=//')" ] && ROOT=$c
    done
    if [ -z "$ROOT" ]; then
      echo "!! Supabase did not send its root CA. Download it from the Supabase dashboard: project crydmokyojaynmrtxkym ->"
      echo "   Project Settings -> Database -> SSL Configuration -> Download certificate, then copy it to $SEC/postgres-ca.pem (0600)"
      echo "   and re-run: CONFIRM=ISSUER-SECRETS bash $0 secrets-env"
      rm -rf "$T"; exit 3
    fi
    install -m 600 "$ROOT" "$SEC/postgres-ca.pem"; rm -rf "$T"
  fi
  exec bash "$0" secrets-env
  ;;
secrets-env)
  [ "${CONFIRM:-}" = "ISSUER-SECRETS" ] || { echo "set CONFIRM=ISSUER-SECRETS"; exit 1; }
  [ -e "$SEC/issuer.env" ] && { echo "$SEC/issuer.env exists - refusing to overwrite"; exit 1; }
  [ -f "$SEC/postgres-ca.pem" ] || { echo "$SEC/postgres-ca.pem missing"; exit 1; }
  echo "Postgres CA: $(openssl x509 -in "$SEC/postgres-ca.pem" -noout -subject -enddate | tr '\n' ' ')"
  openssl s_client -starttls postgres -connect "$DBHOST:5432" -CAfile "$SEC/postgres-ca.pem" -verify_return_error </dev/null 2>/dev/null \
    | grep -q 'Verify return code: 0 (ok)' && echo "Postgres TLS verifies against that CA" || { echo "Postgres TLS does NOT verify against $SEC/postgres-ca.pem - stopping"; exit 1; }
  # Compose issuer.env from the generated files. sslmode is deliberately NOT in the URL: with it, node-postgres would
  # override the explicit ssl.ca and the issuer's CA pinning would be lost.
  "$RT/bin/node" - "$SEC" "$HOME/stg_login/eoc_oidc_db.env" "$ISSUER_HOST" "$DBHOST" <<'JS'
const fs=require('fs'),[sec,dbf,host,dbhost]=process.argv.slice(2);
const cs=JSON.parse(fs.readFileSync(`${sec}/private-client-secrets.json`,'utf8')),ik=JSON.parse(fs.readFileSync(`${sec}/private-iam-keys.json`,'utf8'));
const db=Object.fromEntries(fs.readFileSync(dbf,'utf8').split('\n').filter(Boolean).map(l=>[l.slice(0,l.indexOf('=')),l.slice(l.indexOf('=')+1)]));
const url=`postgresql://${encodeURIComponent(db.OIDC_DB_USER)}:${encodeURIComponent(db.OIDC_DB_PASSWORD)}@${dbhost}:5432/eoc_oidc`;
const env=[
 '# Generated on this server. Never copy to git or chat.',
 '# OIDC_PRODUCTION_ENABLED=true is required by policy.mjs for the process to START at all; staging stays unexposed',
 '# because the issuer binds 127.0.0.1 only and has no nginx site until login-stg is certified.',
 'OIDC_PRODUCTION_ENABLED=true',`OIDC_ISSUER=https://${host}/`,
 `OIDC_CLIENT_ID=${cs.OIDC_CLIENT_ID}`,`OIDC_CLIENT_SECRET=${cs.OIDC_CLIENT_SECRET}`,
 'OIDC_REDIRECT_URI=https://eoc-stg.tcdsolutionsgroup.com/api/eoc/auth/callback',
 `OIDC_JWKS_FILE=${sec}/private-signing-jwks.json`,`OIDC_COOKIE_KEYS=${cs.OIDC_COOKIE_KEYS}`,
 `OIDC_DATABASE_URL=${url}`,`OIDC_DB_CA_FILE=${sec}/postgres-ca.pem`,
 '# IAM side not built yet: the passkey proxy (9444) and the issuer bridge identity do not exist; readiness fails until then.',
 'IAM_PASSKEY_API_URL=https://iam-issuer-stg.tcds.internal:9444','IAM_EOC_BRIDGE_API_URL=https://iam-bridge-stg.tcds.internal:9443',
 `IAM_WORKLOAD_KEY=${ik.IAM_WORKLOAD_KEY}`,`IAM_EOC_BRIDGE_KEY=${ik.IAM_EOC_BRIDGE_KEY}`,
 `IAM_CA_FILE=${sec}/iam-ca.pem`,`IAM_CLIENT_CERT=${sec}/issuer-client.pem`,`IAM_CLIENT_KEY=${sec}/issuer-client.key`,
 `OIDC_PASSKEY_SIGNING_KEY=${cs.OIDC_PASSKEY_SIGNING_KEY}`,'OIDC_PORT=8401',''].join('\n');
fs.writeFileSync(`${sec}/issuer.env`,env,{mode:0o600,flag:'wx'});
JS
  echo "== $SEC (names and modes only)"; stat -c '%a %U %n' "$SEC"/* | sed "s|$SEC/||"
  echo "== public registration (not secret)"; "$RT/bin/node" -e 'const r=require(process.argv[1]);console.log("client_id="+r.clientId+" jwks_kid="+r.jwksKid+" acr="+r.requiredAcr)' "$SEC/public-registration.json"
  ;;
start)
  [ "${CONFIRM:-}" = "START-ISSUER" ] || { echo "set CONFIRM=START-ISSUER"; exit 1; }
  need_runtime; need_app; [ -f "$SEC/issuer.env" ] || { echo "run secrets first"; exit 1; }
  # PM2 only treats a file as a config if its name ends in .config.cjs/.config.js/.json
  rm -f "$BASE/ecosystem.issuer.cjs"; pm2 delete ecosystem.issuer >/dev/null 2>&1 || true
  pm2 describe "$NAME" >/dev/null 2>&1 && { echo "$NAME already in PM2 - run stop first"; exit 1; }
  cat > "$BASE/ecosystem.issuer.config.cjs" <<EOF
module.exports = { apps: [{
  name: '$NAME', cwd: '$BASE/current', script: 'src/server.mjs', interpreter: '$RT/bin/node',
  node_args: '--env-file=$SEC/issuer.env', env: { NODE_ENV: 'production' },
  autorestart: true, max_restarts: 5, restart_delay: 5000, min_uptime: 10000, out_file: '$BASE/issuer.out.log', error_file: '$BASE/issuer.err.log'
}] };
EOF
  out=$(clean_pm2 start "$BASE/ecosystem.issuer.config.cjs" 2>&1) || { echo "pm2 start failed:"; echo "$out" | tail -15; exit 1; }
  pm2 describe "$NAME" >/dev/null 2>&1 || { echo "pm2 did not register $NAME:"; echo "$out" | tail -15; exit 1; }
  for i in $(seq 1 20); do ss -ltn | grep -q '127.0.0.1:8401 ' && break; sleep 1; done
  ss -ltn | grep -q '127.0.0.1:8401 ' && echo "issuer listening on 127.0.0.1:8401" || { echo "issuer did not start - last log lines:"; tail -20 "$BASE/issuer.err.log" "$BASE/issuer.out.log" 2>/dev/null; pm2 logs "$NAME" --lines 20 --nostream 2>&1 | tail -20; exit 1; }
  echo "(not saved to the PM2 dump yet; run 'pm2 save' once verify passes)"
  ;;
verify)
  H="Host: $ISSUER_HOST"; P="X-Forwarded-Proto: https"; U=http://127.0.0.1:8401
  ck() { printf '%-5s %-66s %s\n' "$( [[ "$2" =~ $3 ]] && echo PASS || echo FAIL)" "$1" "$(echo "$2" | head -c 110)"; }
  disc=$(curl -s -m 5 -H "$H" -H "$P" $U/.well-known/openid-configuration || true)
  j() { echo "$disc" | "$RT/bin/node" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const v=JSON.parse(s)[process.argv[1]];console.log(Array.isArray(v)?v.join(","):String(v))}catch{console.log("<no json>")}})' "$1"; }
  ck "V1 discovery issuer" "$(j issuer)" "^https://$ISSUER_HOST/?$"
  ck "V2 authorization endpoint on the issuer origin" "$(j authorization_endpoint)" "^https://$ISSUER_HOST/"
  ck "V3 code flow only" "$(j response_types_supported)" "^code$"
  ck "V4 PKCE S256" "$(j code_challenge_methods_supported)" "S256"
  ck "V5 required ACR advertised" "$(j acr_values_supported)" "urn:tcds:acr:phishing-resistant:uv"
  ck "V6 RS256 ID tokens" "$(j id_token_signing_alg_values_supported)" "RS256"
  jw=$(curl -s -m 5 -H "$H" -H "$P" "$U/jwks" || true)
  ck "V7 JWKS public only (no d/p/q)" "$(echo "$jw" | "$RT/bin/node" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const k=JSON.parse(s).keys;console.log(k.length>0&&k.every(x=>x.kty==="RSA"&&x.kid&&x.n&&!x.d&&!x.p&&!x.q)?"public "+k.length:"PRIVATE OR EMPTY")}catch{console.log("<no json>")}})')" "^public [1-9]"
  ck "V8 liveness" "$(curl -s -m 5 -H "$H" $U/internal/health/live)" '"alive":true'
  ck "V9 readiness refuses: IAM not built yet (expected for now)" "$(curl -s -m 8 -o /dev/null -w '%{http_code}' -H "$H" $U/internal/health/ready)" "^(401|503)$"
  ck "V10 wrong Host refused" "$(curl -s -m 5 -o /dev/null -w '%{http_code}' -H 'Host: evil.example' $U/.well-known/openid-configuration)" "^421$"
  ck "V11 /auth without PKCE refused" "$(curl -s -m 5 -o /dev/null -w '%{http_code}' -H "$H" -H "$P" "$U/auth?client_id=x&response_type=code&scope=openid")" "^(400|401)$"
  ck "V12 bound to loopback only" "$(ss -ltn | awk '$4 ~ /:8401$/{print $4}' | tr '\n' ' ')" "^127\.0\.0\.1:8401 ?$"
  ck "V13 process env carries no inherited DB/secret vars" "$(pid=$(pm2 pid $NAME | tail -1); tr '\0' '\n' < /proc/$pid/environ | cut -d= -f1 | grep -E '^(PG|OIDC_|IAM_|DATABASE_URL|STAGING_)' | tr '\n' ',' || true)" "^$"
  ;;
stop)
  pm2 stop "$NAME" >/dev/null 2>&1 || true; pm2 delete "$NAME" >/dev/null 2>&1 || true; echo "issuer stopped and removed from PM2" ;;
*) echo "usage: $0 check|install-runtime|install-app|secrets|start|verify|stop"; exit 2 ;;
esac
