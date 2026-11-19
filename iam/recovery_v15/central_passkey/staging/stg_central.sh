#!/usr/bin/env bash
# STAGING ONLY (IAM DB kqcdqtazcqaawdkmcfed, ~/stg_login). Central laptop passkey ceremony for the OIDC issuer (TCDS 626).
# Run in this order; each step stops on anything unexpected and prints no secret.
#   preflight        read only: package hashes, deployed 6.1B/6.1C sources are the versions this was built on, both
#                    candidates compile (in a temp dir), ports free, issuer keys + mTLS CA present, 626 not installed
#   db-rehearse      ONE transaction: catalog A -> 626 -> 627 tests -> 626 rollback -> catalog B (must equal A) -> ROLLBACK
#   db-install       CONFIRM=INSTALL-626: apply 626 (self-verifying)
#   db-test          627 against the installed 626, in a transaction that is rolled back
#   db-login         CONFIRM=CREATE-CENTRAL-LOGIN: login tcds_login_central (member of tcds_identity_central_verifier only);
#                    password generated here, only its SCRAM verifier goes to the DB; URL -> config.verifier.CENTRAL_DATABASE_URL
#   verifier-deploy  CONFIRM=DEPLOY-CENTRAL-VERIFIER: 6.1C + src/central (mount line in app.ts), CENTRAL_* in config.verifier,
#                    restart login-v2-verifier-staging, /ready/central must answer for login-stg
#   api-deploy       CONFIRM=DEPLOY-CENTRAL-API: 6.1B internal IAM API passkey routes + enrollment listener (8198), keys in
#                    config.api (issuer passkey key copied from /etc/tcds-issuer, subject key generated), restart API
#   proxy-start      CONFIRM=START-ISSUER-PASSKEY-PROXY: 9444 mTLS proxy (127.0.0.1 only, issuer certificate only, prefix
#                    /internal/v1/iam/oidc/passkey/), server cert from the staging CA, /etc/hosts name (sudo), pm2 save
#   test             synthetic end-to-end (stg_central_e2e.mjs): enrollment page -> 626; issuer's own client -> 9444 -> API -> 6.1C
#   enroll-update    CONFIRM=UPDATE-ENROLLMENT-PAGE: replace only the enrollment page (layout/logo, invite kept per tab)
#   status           read only     login-check  read only: the verifier login connects with only its functions
#   revert-api / revert-verifier (CONFIRM=REVERT-CENTRAL), proxy-stop, db-uninstall (CONFIRM=UNINSTALL-626)
# Copy the package to the server: scp -r central_passkey apifydev@139.177.200.80:/tmp/   (run from /srv/arb-system/api)
set -euo pipefail
D=/tmp/central_passkey
S=$HOME/stg_login; CFG=$S/config.json; C61=$S/6.1C; B61=$S/6.1B
SEC=/etc/tcds-issuer; M=$S/mtls; MI=$S/mtls_issuer
VAPP=login-v2-verifier-staging; AAPP=login-v2-api-staging; PAPP=issuer-passkey-proxy-staging
RP=login-stg.tcdsolutionsgroup.com; ISS=https://login-stg.tcdsolutionsgroup.com
ENROLL_PORT=8198; PROXY_PORT=9444; PROXY_HOST=iam-issuer-stg.tcds.internal
BKV=$S/central_verifier_backup; BKA=$S/central_api_backup
cd /srv/arb-system/api
eval "$(grep -E '^(PGHOST|PGPORT|PGDATABASE|PGUSER|PGPASSWORD|PGSSLMODE)=' .env | sed -E "s/^([A-Z_]+)=(.*)$/export \1='\2'/")"
export PGHOST=db.kqcdqtazcqaawdkmcfed.supabase.co PGPORT=5432 PGDATABASE=postgres PGUSER=postgres PAGER=cat
grep -q kqcdqtazcqaawdkmcfed "$CFG" || { echo "$CFG is not the staging config - stopping"; exit 1; }
umask 077
q() { psql -X -At -v ON_ERROR_STOP=1 "$@"; }
clean_pm2() { env -i HOME="$HOME" PATH="$PATH" USER="$USER" LANG=C.UTF-8 pm2 "$@"; }
strip() { grep -vxE 'BEGIN;|COMMIT;' "$1"; }
installed() { [ "$(q -c "SELECT to_regclass('warehouse_identity.central_passkeys') IS NOT NULL")" = t ]; }
listening() { ss -ltn | grep -q "127.0.0.1:$1 "; }
wait_port() { for i in $(seq 1 20); do listening "$1" && return 0; sleep 1; done; return 1; }
cfg_has() { node -e 'const c=require(process.argv[1]);const [s,k]=process.argv[2].split(".");process.exit(c[s]&&c[s][k]?0:1)' "$CFG" "$1"; }

( cd "$D" && sha256sum -c --quiet - ) <<'SUMS' || { echo "package files differ from the reviewed copies - stopping"; exit 1; }
059079418d366ca042ee0bd55dad1a8d776072ee3112eb3f34189d508fd961b6  626_central_passkey_ceremony.sql
9b7f94fabf4d5b088c3d2ba12b0114111134aa0b76618c8bf9280a46c797685b  626_rollback.sql
c68907f6ead17b51fe01011e7e4bc8313dac266808e34121b44f7818bc493cb9  627_central_passkey_tests.sql
918f1bce4c3ef31c4974bf0310a40660153f243c9a8e86e2f11e33e3229d5ea4  626_catalog_snapshot.sql
94a1e8e8345532a52082c59c259b123066ed28c9c03479a69a7c0f9a5a65fde6  verifier_6.1C/src/central/centralConfig.ts
646b9d28f92160853b40ec5fa5561fcc4438257a8b777feff430be58adbdd8dc  verifier_6.1C/src/central/centralService.ts
2d220f00e8f1f7d84c689ea347f58face8479c45ac2ed6a273c89b92db47e002  verifier_6.1C/src/central/centralRoutes.ts
b7665464cf1523e1261216292a0dde30ee7eead0d918e2750dcc8b475a6e7a85  verifier_6.1C/src/central/centralMount.ts
cb2e4e491f7916ac0928fd1882cf6cfa045edeab0f31a5acc51092f4801cebeb  loginv2_6.1B/internalIamApi.ts
4d0e7159d2383c24e1484f12fb42f59eac0c66edb8e85d8777092ff96154470e  loginv2_6.1B/centralVerifierClient.ts
3d6e27278c2bd243ceff063a194d3d8771570ecb8bbae480c5cc2e7c883618aa  loginv2_6.1B/centralEnrollment.ts
67d9c86b6ccbe92440229f5fdbec5bcb569f0ed37cd1a66688eecb0ab3026eab  loginv2_6.1B/centralWiring.ts
6a310c62d3155fdc09994c1dc4adc27ae6b4895fe7830f836451de6730dff233  loginv2_6.1B/assets/tcds-logo.jpg
bb8f8be5db781515b1d2d6960e322a9ae7dc964f8be624ff00f20dabb37481bf  loginv2_6.1B/assets/tcds-shield.png
aa70360a8017ab4900e947f38de5befd43f43701e6e767ebc4fd696fd1971ab3  loginv2_6.1B/assets/tcds-logo-wide.jpg
4ba61bfdf260a18a2c07060a0acbe3a41c582a784c50310d433d3c1325d9e4f9  proxy_9444/issuerPasskeyProxy.cjs
5af8383c96f1a93798fa05b2dd15f86fc59980bef552bf7e5e0ca6c92355f16c  staging/stg_central_e2e.mjs
edce6b8ff54d3b3822dcaaa54f2c31820286edfa41b6074f14e950bfbdc58154  staging/softAuthenticator.mjs
SUMS

# Deployed sources this package was built on.
V_APP_SHA=e6c798fa53fceb996edf3e0196df7daa0fa684f3cf8cea42b27eca8428a174a5    # 6.1C src/app.ts (R11)
A_IAM_SHA=fc4267bfe8fdbaeec9d63f006f1a2db8ba865e93b3d18a79836ecc7f8d4dad4a    # 6.1B src/express/internalIamApi.ts (bridge_issuer)
ENROLL_PREV_SHAS="0dd41c2349c1ceddafcf108f540f68c664aa12029d8022df9d458107ae5b933b 9bcb732eb0599b0db2b00ed9cab77fe583ea7908c4557f4d119bfc5020efaebb"   # centralEnrollment.ts versions this update may replace (v1 2026-11-19, v2 layout)
ENV_ANCHOR='EOC_IAM_ISSUER_TOKEN:z.string().min(32).optional()'
INT_ANCHOR='eocIssuerSecret:d.env.EOC_IAM_ISSUER_TOKEN})'
V_FILES="src/central/centralConfig.ts src/central/centralService.ts src/central/centralRoutes.ts src/central/centralMount.ts"
A_NEW="src/express/centralVerifierClient.ts src/express/centralEnrollment.ts src/express/centralWiring.ts"
A_EDIT="src/express/internalIamApi.ts src/config/env.ts src/express/integration.ts"

# Patch helpers (exact single-match edits; refuse otherwise). Applied to a copy of the tree, built, then copied in.
patch_verifier() {  # $1 = 6.1C tree
  mkdir -p "$1/src/central"; for f in $V_FILES; do cp "$D/verifier_6.1C/$f" "$1/$f"; done
  node - "$1" <<'NODE'
const fs=require("fs"),p=process.argv[2]+"/src/app.ts";let s=fs.readFileSync(p,"utf8");
const ed=[["import {orchestratorDb,webauthnDb,deviceDb} from './db/pool';","import {orchestratorDb,webauthnDb,deviceDb} from './db/pool';\nimport {mountCentral} from './central/centralMount';"],
 ["  app.use('/internal/v1/device-proof',auth('device'),deviceProofRoutes());\n","  app.use('/internal/v1/device-proof',auth('device'),deviceProofRoutes());\n  // Central issuer passkey ceremony (TCDS 626): only when CENTRAL_* is configured; own secret, scope and DB role.\n  mountCentral(app);\n"]];
for(const [a,b] of ed){if(s.split(a).length!==2)throw Error("app.ts: anchor not found exactly once");s=s.replace(a,()=>b)}fs.writeFileSync(p,s);
NODE
}
patch_api() {  # $1 = 6.1B tree
  cp "$D/loginv2_6.1B/internalIamApi.ts" "$1/src/express/internalIamApi.ts"
  for f in centralVerifierClient centralEnrollment centralWiring; do cp "$D/loginv2_6.1B/$f.ts" "$1/src/express/$f.ts"; done
  node - "$1" "$ENV_ANCHOR" "$INT_ANCHOR" <<'NODE'
const fs=require("fs"),[B,envA,intA]=process.argv.slice(2);
function edit(f,pairs){const p=B+"/"+f;let s=fs.readFileSync(p,"utf8");for(const [a,b] of pairs){if(s.split(a).length!==2)throw Error(f+": anchor not found exactly once: "+a.slice(0,60));s=s.replace(a,()=>b)}fs.writeFileSync(p,s)}
edit("src/config/env.ts",[[envA,envA+",\n EOC_IAM_ISSUER_PASSKEY_KEY:z.string().min(32).optional(),\n CENTRAL_OIDC_ISSUER:z.string().url().optional(),\n CENTRAL_RP_ID:z.string().min(3).optional(),\n CENTRAL_VERIFIER_URL:z.string().url().optional(),\n CENTRAL_WORKLOAD_SECRET:z.string().min(32).optional(),\n CENTRAL_SUBJECT_KEY:z.string().min(32).optional(),\n CENTRAL_ENROLL_PORT:z.coerce.number().int().min(1024).max(65535).optional(),\n CENTRAL_ENROLL_ASSETS_DIR:z.string().min(1).optional()"]]);
const ip=B+"/src/express/integration.ts";let s=fs.readFileSync(ip,"utf8");
const imp=s.match(/^import[^\n]*from '\.\/internalIamApi';$/m);if(!imp||s.split(imp[0]).length!==2)throw Error("integration.ts: internalIamApi import not found exactly once");
s=s.replace(imp[0],()=>imp[0]+"\nimport {centralPasskeyFromEnv} from './centralWiring';");
if(s.split(intA).length!==2)throw Error("integration.ts: anchor not found exactly once");
s=s.replace(intA,()=>"eocIssuerSecret:d.env.EOC_IAM_ISSUER_TOKEN,centralPasskey:centralPasskeyFromEnv(d.env as any,d.verifier.resultPublicKeyPem)})");
fs.writeFileSync(ip,s);
NODE
}
copy_tree() {  # $1 = source tree, $2 = empty target; node_modules linked, not copied
  ( cd "$1" && tar --exclude=./node_modules --exclude=./dist.candidate -cf - . ) | ( cd "$2" && tar -xf - ); ln -s "$1/node_modules" "$2/node_modules"
}
build_tree() {  # $1 = tree -> compiled into $1/dist.candidate
  ( cd "$1" && ./node_modules/.bin/tsc -p tsconfig.json --noEmit && ./node_modules/.bin/tsc -p tsconfig.json --outDir dist.candidate )
}
dist_matches_src() {  # $1 = deployed tree; every listed output must equal a fresh build of its current src
  local T; T=$(mktemp -d "$S/central_check.XXXX"); copy_tree "$1" "$T"
  ( cd "$T" && ./node_modules/.bin/tsc -p tsconfig.json --outDir dist.candidate ) || { rm -rf "$T"; return 1; }
  shift; local ok=0; for o in "$@"; do cmp -s "$T/dist.candidate/${o#dist/}" "$T/$o" || { echo "  deployed $o is not built from the current src"; ok=1; }; done
  rm -rf "$T"; return $ok
}

case "${1:-}" in
preflight)
  echo "== deployed sources"
  [ "$(sha256sum "$C61/src/app.ts" | cut -d' ' -f1)" = "$V_APP_SHA" ] && echo "ok 6.1C src/app.ts is the R11 version" || { echo "STOP 6.1C src/app.ts differs from R11"; exit 1; }
  [ "$(sha256sum "$B61/src/express/internalIamApi.ts" | cut -d' ' -f1)" = "$A_IAM_SHA" ] && echo "ok 6.1B internalIamApi.ts is the bridge_issuer version" || { echo "STOP 6.1B internalIamApi.ts differs"; exit 1; }
  [ "$(grep -cF "$ENV_ANCHOR" "$B61/src/config/env.ts")" = 1 ] && [ "$(grep -cF "$INT_ANCHOR" "$B61/src/express/integration.ts")" = 1 ] && echo "ok 6.1B env/integration anchors" || { echo "STOP 6.1B anchors not found"; exit 1; }
  dist_matches_src "$C61" dist/app.js && echo "ok 6.1C dist = src" || { echo "STOP 6.1C"; exit 1; }
  dist_matches_src "$B61" dist/express/internalIamApi.js dist/config/env.js dist/express/integration.js && echo "ok 6.1B dist = src" || { echo "STOP 6.1B"; exit 1; }
  echo "== candidates compile (temp copies; nothing deployed)"
  for t in C61 B61; do T=$(mktemp -d "$S/central_cand.XXXX"); copy_tree "${!t}" "$T"
    if [ $t = C61 ]; then patch_verifier "$T"; else patch_api "$T"; fi
    build_tree "$T" >/dev/null && echo "ok $t candidate compiles" || { echo "STOP $t candidate does not compile:"; (cd "$T" && ./node_modules/.bin/tsc -p tsconfig.json --noEmit | head -20); rm -rf "$T"; exit 1; }
    rm -rf "$T"; done
  echo "== runtime"
  for p in $ENROLL_PORT $PROXY_PORT; do ss -ltn | grep -q ":$p " && echo "NOTE port $p already in use" || echo "ok port $p free"; done
  listening 8191 && listening 8195 && listening 8196 && echo "ok staging verifier 8191, API 8195, internal 8196 listening" || echo "STOP staging services not all listening"
  [ -r "$SEC/private-iam-keys.json" ] && node -e 'const k=require(process.argv[1]);process.exit(k.IAM_WORKLOAD_KEY&&k.IAM_WORKLOAD_KEY.length>=32?0:1)' "$SEC/private-iam-keys.json" && echo "ok issuer passkey key present" || echo "STOP issuer keys missing"
  [ -r "$M/ca.crt" ] && [ -r "$M/ca.key" ] && [ -r "$M/config.json" ] && echo "ok staging mTLS CA present" || echo "STOP mTLS CA missing"
  grep -q "IAM_PASSKEY_API_URL=https://$PROXY_HOST:$PROXY_PORT" "$SEC/issuer.env" && echo "ok issuer calls https://$PROXY_HOST:$PROXY_PORT" || echo "NOTE issuer IAM_PASSKEY_API_URL is not $PROXY_HOST:$PROXY_PORT"
  getent hosts "$PROXY_HOST" >/dev/null && echo "ok $PROXY_HOST resolves" || echo "note $PROXY_HOST not in /etc/hosts yet (proxy-start adds it)"
  echo "== database"
  q -c "SELECT '626 installed=' || (to_regclass('warehouse_identity.central_passkeys') IS NOT NULL) || ', 623 installed=' || (to_regprocedure('warehouse_identity.eoc_resolve_federation_v623(text,text,uuid)') IS NOT NULL) || ', 622 status fn=' || (to_regprocedure('warehouse_identity.iam_session_epoch_status_v15(uuid)') IS NOT NULL)"
  echo "PREFLIGHT DONE" ;;

db-rehearse)
  installed && { echo "626 already installed"; exit 1; }
  { echo "BEGIN;"; echo "\\set snap A"; cat $D/626_catalog_snapshot.sql; strip $D/626_central_passkey_ceremony.sql; cat $D/627_central_passkey_tests.sql
    strip $D/626_rollback.sql; echo "\\set snap B"; cat $D/626_catalog_snapshot.sql
    echo "SELECT 'catalog A vs B differences after rollback: ' || count(*) FROM ((SELECT item FROM _snap WHERE name='A' EXCEPT SELECT item FROM _snap WHERE name='B') UNION ALL (SELECT item FROM _snap WHERE name='B' EXCEPT SELECT item FROM _snap WHERE name='A')) d;"
    echo "SELECT 'diff: ' || item FROM ((SELECT 'A-only ' || item AS item FROM (SELECT item FROM _snap WHERE name='A' EXCEPT SELECT item FROM _snap WHERE name='B') x) UNION ALL (SELECT 'B-only ' || item FROM (SELECT item FROM _snap WHERE name='B' EXCEPT SELECT item FROM _snap WHERE name='A') y)) z LIMIT 20;"
    echo "ROLLBACK;"; } | q 2>&1 | grep -v NOTICE
  echo "rehearse finished (ROLLBACK)" ;;

db-install)
  [ "${CONFIRM:-}" = "INSTALL-626" ] || { echo "set CONFIRM=INSTALL-626"; exit 1; }
  installed && { echo "626 already installed"; exit 1; }
  q -f $D/626_central_passkey_ceremony.sql && echo "626 INSTALLED" ;;

db-test)
  installed || { echo "626 not installed"; exit 1; }
  { echo "BEGIN;"; cat $D/627_central_passkey_tests.sql; echo "ROLLBACK;"; } | q 2>&1 | grep -v NOTICE ;;

db-login)
  [ "${CONFIRM:-}" = "CREATE-CENTRAL-LOGIN" ] || { echo "set CONFIRM=CREATE-CENTRAL-LOGIN"; exit 1; }
  installed || { echo "626 not installed"; exit 1; }
  cfg_has verifier.CENTRAL_DATABASE_URL && { echo "config.verifier.CENTRAL_DATABASE_URL already set"; exit 1; }
  [ "$(q -c "SELECT count(*) FROM pg_roles WHERE rolname='tcds_login_central'")" = 0 ] || { echo "role tcds_login_central exists"; exit 1; }
  PW=$(openssl rand -hex 32)
  VER=$(PW="$PW" node -e 'const c=require("crypto"),pw=process.env.PW,salt=c.randomBytes(16),it=4096;
    const sp=c.pbkdf2Sync(pw,salt,it,32,"sha256"),h=(k,m)=>c.createHmac("sha256",k).update(m).digest();
    const stored=c.createHash("sha256").update(h(sp,"Client Key")).digest();
    process.stdout.write(`SCRAM-SHA-256$${it}:${salt.toString("base64")}$${stored.toString("base64")}:${h(sp,"Server Key").toString("base64")}`)')
  q <<SQL
BEGIN;
CREATE ROLE tcds_login_central LOGIN INHERIT CONNECTION LIMIT 8 PASSWORD '$VER';
GRANT tcds_identity_central_verifier TO tcds_login_central;
ALTER ROLE tcds_login_central SET search_path = pg_catalog;
COMMIT;
SQL
  unset VER
  cp -p "$CFG" "$CFG.bak-central-$(date -u +%Y%m%dT%H%M%SZ)"
  PW="$PW" node -e 'const fs=require("fs"),f=process.argv[1],c=JSON.parse(fs.readFileSync(f,"utf8"));
    const u=new URL(c.verifier.WEBAUTHN_DATABASE_URL);u.username="tcds_login_central";u.password=process.env.PW;
    c.verifier.CENTRAL_DATABASE_URL=u.toString();const t=f+".tmp";fs.writeFileSync(t,JSON.stringify(c,null,2)+"\n",{mode:0o600});fs.renameSync(t,f)' "$CFG"
  unset PW
  echo "login created; config.verifier.CENTRAL_DATABASE_URL written (never printed)"
  "$0" login-check ;;

login-check)
  # Through the Node driver, exactly as the verifier connects (the URL carries the driver's sslmode, which psql rejects).
  NODE_PATH="$C61/node_modules" node - "$CFG" <<'NODE'
const {Client}=require("pg"),cfg=require(process.argv[2]);
(async()=>{const c=new Client({connectionString:cfg.verifier.CENTRAL_DATABASE_URL});await c.connect();
 const r=(await c.query(`SELECT current_user u,(SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname=current_user) p,
   has_table_privilege('warehouse_identity.central_passkeys','SELECT') t,
   has_function_privilege('warehouse_identity.central_claim_workload_nonce_v1(bytea,uuid,uuid,timestamptz)','EXECUTE') f`)).rows[0];
 console.log(`login check: user=${r.u} superuser/bypassrls=${r.p} can read central_passkeys=${r.t} can claim nonce=${r.f}`);
 await c.end();process.exit(r.u==="tcds_login_central"&&!r.p&&!r.t&&r.f?0:1)})().catch(e=>{console.log("login check FAILED: "+e.message);process.exit(1)});
NODE
  ;;

verifier-deploy)
  [ "${CONFIRM:-}" = "DEPLOY-CENTRAL-VERIFIER" ] || { echo "set CONFIRM=DEPLOY-CENTRAL-VERIFIER"; exit 1; }
  [ -e "$BKV" ] && { echo "$BKV exists - already deployed? (revert-verifier first)"; exit 1; }
  cfg_has verifier.CENTRAL_DATABASE_URL || { echo "run db-login first"; exit 1; }
  [ "$(sha256sum "$C61/src/app.ts" | cut -d' ' -f1)" = "$V_APP_SHA" ] || { echo "6.1C src/app.ts changed - stopping"; exit 1; }
  echo "building the 6.1C candidate (temp copy; nothing changed yet)..."
  T=$(mktemp -d "$S/central_v.XXXX"); copy_tree "$C61" "$T"; patch_verifier "$T"; build_tree "$T"
  echo "build ok; backing up and installing..."
  mkdir -p "$BKV/src" "$BKV/dist"; cp -p "$C61/src/app.ts" "$BKV/src/"; cp -p "$C61/dist/app.js" "$BKV/dist/"; cp -p "$CFG" "$BKV/config.json"
  cp "$T/src/app.ts" "$C61/src/app.ts"; mkdir -p "$C61/src/central" "$C61/dist/central"
  for f in $V_FILES; do cp "$T/$f" "$C61/$f"; done
  cp "$T/dist.candidate/app.js" "$C61/dist/app.js"; cp "$T/dist.candidate/central/"*.js "$C61/dist/central/"; rm -rf "$T"
  node -e 'const fs=require("fs"),f=process.argv[1],c=JSON.parse(fs.readFileSync(f,"utf8"));
    if(!c.verifier.CENTRAL_WORKLOAD_SECRET)c.verifier.CENTRAL_WORKLOAD_SECRET=require("crypto").randomBytes(48).toString("base64url");
    Object.assign(c.verifier,{CENTRAL_RP_ID:process.argv[2],CENTRAL_ORIGIN:"https://"+process.argv[2],CENTRAL_RP_NAME:"TCDS"});
    const t=f+".tmp";fs.writeFileSync(t,JSON.stringify(c,null,2)+"\n",{mode:0o600});fs.renameSync(t,f)' "$CFG" "$RP"
  echo "restarting $VAPP..."
  clean_pm2 restart "$VAPP" >/dev/null; wait_port 8191 || { echo "!! verifier not listening"; pm2 logs "$VAPP" --nostream --lines 30; exit 1; }
  sleep 1; R=$(curl -s http://127.0.0.1:8191/ready/central); echo "ready/central: $R"
  echo "$R" | grep -q "\"rpId\":\"$RP\"" || { echo "!! central routes not ready - check logs; revert with CONFIRM=REVERT-CENTRAL $0 revert-verifier"; exit 1; }
  curl -s -o /dev/null -w "warehouse ready (unchanged): %{http_code}\n" http://127.0.0.1:8191/ready
  echo "VERIFIER DEPLOYED (backup $BKV)" ;;

api-deploy)
  [ "${CONFIRM:-}" = "DEPLOY-CENTRAL-API" ] || { echo "set CONFIRM=DEPLOY-CENTRAL-API"; exit 1; }
  [ -e "$BKA" ] && { echo "$BKA exists - already deployed? (revert-api first)"; exit 1; }
  cfg_has verifier.CENTRAL_WORKLOAD_SECRET || { echo "run verifier-deploy first"; exit 1; }
  [ "$(sha256sum "$B61/src/express/internalIamApi.ts" | cut -d' ' -f1)" = "$A_IAM_SHA" ] || { echo "6.1B internalIamApi.ts changed - stopping"; exit 1; }
  ss -ltn | grep -q ":$ENROLL_PORT " && { echo "port $ENROLL_PORT in use - stopping"; exit 1; }
  echo "building the 6.1B candidate (temp copy; nothing changed yet)..."
  T=$(mktemp -d "$S/central_a.XXXX"); copy_tree "$B61" "$T"; patch_api "$T"; build_tree "$T"
  echo "build ok; backing up and installing..."
  mkdir -p "$BKA"; for f in $A_EDIT; do mkdir -p "$BKA/$(dirname $f)"; cp -p "$B61/$f" "$BKA/$f"; done
  for o in express/internalIamApi.js config/env.js express/integration.js; do mkdir -p "$BKA/dist/$(dirname $o)"; cp -p "$B61/dist/$o" "$BKA/dist/$o"; done
  cp -p "$CFG" "$BKA/config.json"
  for f in $A_EDIT $A_NEW; do cp "$T/$f" "$B61/$f"; done
  for o in express/internalIamApi.js config/env.js express/integration.js express/centralVerifierClient.js express/centralEnrollment.js express/centralWiring.js; do
    cp "$T/dist.candidate/$o" "$B61/dist/$o"; chmod 644 "$B61/dist/$o"; done
  rm -rf "$T"
  mkdir -p "$S/central_assets"; cp "$D/loginv2_6.1B/assets/"* "$S/central_assets/"; chmod 755 "$S/central_assets"; chmod 644 "$S/central_assets/"*
  node -e 'const fs=require("fs"),f=process.argv[1],c=JSON.parse(fs.readFileSync(f,"utf8")),k=JSON.parse(fs.readFileSync(process.argv[2],"utf8")).IAM_WORKLOAD_KEY;
    if(!k||k.length<32)throw Error("issuer passkey key missing");
    if(k===c.api.EOC_IAM_ISSUER_TOKEN||k===c.api.EOC_IAM_SERVICE_TOKEN)throw Error("issuer passkey key equals a bridge key");
    Object.assign(c.api,{EOC_IAM_ISSUER_PASSKEY_KEY:k,CENTRAL_OIDC_ISSUER:process.argv[3],CENTRAL_RP_ID:process.argv[4],
      CENTRAL_VERIFIER_URL:"http://127.0.0.1:8191",CENTRAL_WORKLOAD_SECRET:c.verifier.CENTRAL_WORKLOAD_SECRET,
      CENTRAL_ENROLL_PORT:process.argv[5],CENTRAL_ENROLL_ASSETS_DIR:process.argv[6]});
    if(!c.api.CENTRAL_SUBJECT_KEY)c.api.CENTRAL_SUBJECT_KEY=require("crypto").randomBytes(48).toString("base64url");
    const t=f+".tmp";fs.writeFileSync(t,JSON.stringify(c,null,2)+"\n",{mode:0o600});fs.renameSync(t,f)' "$CFG" "$SEC/private-iam-keys.json" "$ISS" "$RP" "$ENROLL_PORT" "$S/central_assets"
  clean_pm2 restart "$AAPP" >/dev/null
  wait_port 8196 && wait_port $ENROLL_PORT || { echo "!! API listeners not up"; pm2 logs "$AAPP" --nostream --lines 30; exit 1; }
  pm2 logs "$AAPP" --nostream --lines 60 2>/dev/null | grep -o '"centralPasskey":[a-z]*' | tail -1
  curl -s -o /dev/null -w "enrollment page: %{http_code}\n" http://127.0.0.1:$ENROLL_PORT/enroll/
  curl -s -o /dev/null -w "sign-in API (unchanged): %{http_code}\n" http://127.0.0.1:8195/api/v1/auth/session
  echo "API DEPLOYED (backup $BKA)" ;;

proxy-start)
  [ "${CONFIRM:-}" = "START-ISSUER-PASSKEY-PROXY" ] || { echo "set CONFIRM=START-ISSUER-PASSKEY-PROXY"; exit 1; }
  ss -ltn | grep -q ":$PROXY_PORT " && { echo "port $PROXY_PORT in use"; exit 1; }
  mkdir -p "$MI"; chmod 700 "$MI"
  cp "$D/proxy_9444/issuerPasskeyProxy.cjs" "$MI/"
  if [ ! -f "$MI/server.crt" ]; then
    openssl ecparam -name prime256v1 -genkey -noout -out "$MI/server.key"
    openssl req -new -key "$MI/server.key" -subj "/CN=$PROXY_HOST" -out "$MI/server.csr"
    printf "subjectAltName=DNS:%s\nextendedKeyUsage=serverAuth\nkeyUsage=critical,digitalSignature\nbasicConstraints=critical,CA:FALSE\n" "$PROXY_HOST" > "$MI/server.ext"
    openssl x509 -req -in "$MI/server.csr" -CA "$M/ca.crt" -CAkey "$M/ca.key" -set_serial "0x$(openssl rand -hex 16)" -days 365 -sha256 \
      -extfile "$MI/server.ext" -out "$MI/server.crt" 2>/dev/null
    rm -f "$MI/server.csr" "$MI/server.ext"; chmod 600 "$MI/server.key"
  fi
  openssl verify -CAfile "$M/ca.crt" "$MI/server.crt"
  # The issuer identity and its certificate fingerprint, exactly as allowed on the 9443 bridge proxy; nothing else.
  node -e 'const fs=require("fs"),c=JSON.parse(fs.readFileSync(process.argv[1],"utf8")),mi=process.argv[2];
    const id=(c.identities||[]).find(i=>i.caller==="oidc-issuer");if(!id)throw Error("no oidc-issuer identity in the 9443 config");
    fs.writeFileSync(mi+"/config.json",JSON.stringify({listenHost:"127.0.0.1",port:Number(process.argv[4]),upstreamPort:8196,
      prefix:"/internal/v1/iam/oidc/passkey/",maxBody:16384,methods:["POST"],serverKey:mi+"/server.key",serverCert:mi+"/server.crt",
      caCert:process.argv[3]+"/ca.crt",allowedClients:mi+"/allowed_clients.txt",allowIps:["127.0.0.1"],identities:[id]},null,2),{mode:0o600})' \
    "$M/config.json" "$MI" "$M" "$PROXY_PORT"
  ICERT=$(grep -E '^IAM_CLIENT_CERT=' "$SEC/issuer.env" | cut -d= -f2-)
  [ -n "$ICERT" ] && [ -r "$ICERT" ] || { echo "issuer client certificate (IAM_CLIENT_CERT) not readable"; exit 1; }
  openssl verify -CAfile "$M/ca.crt" -purpose sslclient "$ICERT" >/dev/null || { echo "issuer client certificate does not chain to the staging CA"; exit 1; }
  openssl x509 -in "$ICERT" -noout -fingerprint -sha256 | sed 's/^.*=//' | tr 'a-f' 'A-F' > "$MI/allowed_clients.txt"
  echo "allowed client: $(cut -c1-23 "$MI/allowed_clients.txt")… ($ICERT)"
  getent hosts "$PROXY_HOST" >/dev/null || { echo "adding $PROXY_HOST to /etc/hosts (sudo)"; echo "127.0.0.1 $PROXY_HOST" | sudo tee -a /etc/hosts >/dev/null; }
  env -i HOME="$HOME" PATH="$PATH" USER="$USER" LANG=C.UTF-8 EOC_MTLS_CONFIG="$MI/config.json" pm2 start "$MI/issuerPasskeyProxy.cjs" --name "$PAPP" >/dev/null
  wait_port $PROXY_PORT || { echo "!! proxy not listening"; pm2 logs "$PAPP" --nostream --lines 20; exit 1; }
  clean_pm2 save >/dev/null
  curl -s -o /dev/null -w "no client certificate: %{http_code} (000 = refused in the TLS handshake)\n" --cacert "$M/ca.crt" "https://$PROXY_HOST:$PROXY_PORT/internal/v1/iam/oidc/passkey/begin" || true
  echo "PROXY STARTED on 127.0.0.1:$PROXY_PORT (pm2 saved)" ;;

test)
  [ -r "$SEC/issuer.env" ] || { echo "cannot read $SEC/issuer.env"; exit 1; }
  ADMIN_URL=$(node -e 'const u=new URL("postgresql://x@h/d");u.username=process.env.PGUSER;u.password=process.env.PGPASSWORD;u.hostname=process.env.PGHOST;u.port=process.env.PGPORT;u.pathname="/"+process.env.PGDATABASE;process.stdout.write(u.toString())')
  # The issuer's own Node 22 if found (as PM2 runs it), else the system node (the test needs only node: built-ins + pg).
  NODE_BIN=$(pm2 jlist 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const a=JSON.parse(s).find(x=>x.name==="oidc-issuer-staging");process.stdout.write(a?.pm2_env?.exec_interpreter||"")}catch{}})')
  [ -x "$NODE_BIN" ] || NODE_BIN=$(find /srv/arb-system/oidc_issuer/runtime -maxdepth 4 -type f -path '*/bin/node' 2>/dev/null | head -1)
  [ -x "$NODE_BIN" ] || NODE_BIN=$(command -v node)
  echo "node: $NODE_BIN ($("$NODE_BIN" -v))"
  STG_ADMIN_DB_URL="$ADMIN_URL" "$NODE_BIN" "$D/staging/stg_central_e2e.mjs" "$CFG" "$SEC/issuer.env" \
    /srv/arb-system/oidc_issuer/current/src "$D/staging/softAuthenticator.mjs" "$B61/node_modules" ;;

status)
  for p in 8191 8195 8196 $ENROLL_PORT $PROXY_PORT; do printf "port %s: " $p; ss -ltn | grep -q "127.0.0.1:$p " && echo listening || echo "-"; done
  curl -s http://127.0.0.1:8191/ready/central; echo
  for k in verifier.CENTRAL_DATABASE_URL verifier.CENTRAL_WORKLOAD_SECRET api.EOC_IAM_ISSUER_PASSKEY_KEY api.CENTRAL_SUBJECT_KEY; do cfg_has $k && echo "config $k: set" || echo "config $k: -"; done
  q -c "SELECT '626 installed=' || (to_regclass('warehouse_identity.central_passkeys') IS NOT NULL)"
  installed && q -c "SELECT 'central passkeys active=' || count(*) FILTER (WHERE security_state='ACTIVE') || ' total=' || count(*) FROM warehouse_identity.central_passkeys" || true ;;

revert-verifier)
  [ "${CONFIRM:-}" = "REVERT-CENTRAL" ] || { echo "set CONFIRM=REVERT-CENTRAL"; exit 1; }
  [ -d "$BKV" ] || { echo "no backup $BKV"; exit 1; }
  cp -p "$BKV/src/app.ts" "$C61/src/app.ts"; cp -p "$BKV/dist/app.js" "$C61/dist/app.js"; rm -rf "$C61/src/central" "$C61/dist/central"
  node -e 'const fs=require("fs"),f=process.argv[1],c=JSON.parse(fs.readFileSync(f,"utf8"));for(const k of ["CENTRAL_RP_ID","CENTRAL_ORIGIN","CENTRAL_RP_NAME"])delete c.verifier[k];
    const t=f+".tmp";fs.writeFileSync(t,JSON.stringify(c,null,2)+"\n",{mode:0o600});fs.renameSync(t,f)' "$CFG"
  clean_pm2 restart "$VAPP" >/dev/null; wait_port 8191 && echo "verifier reverted (central routes off; login + workload secret kept)"; mv "$BKV" "$BKV.reverted-$(date -u +%Y%m%dT%H%M%SZ)" ;;

revert-api)
  [ "${CONFIRM:-}" = "REVERT-CENTRAL" ] || { echo "set CONFIRM=REVERT-CENTRAL"; exit 1; }
  [ -d "$BKA" ] || { echo "no backup $BKA"; exit 1; }
  for f in $A_EDIT; do cp -p "$BKA/$f" "$B61/$f"; done
  for o in express/internalIamApi.js config/env.js express/integration.js; do cp -p "$BKA/dist/$o" "$B61/dist/$o"; done
  rm -f "$B61/src/express/central"*.ts "$B61/dist/express/central"*.js
  clean_pm2 restart "$AAPP" >/dev/null; wait_port 8196 && echo "API reverted (keys left in config.api, unused)"; mv "$BKA" "$BKA.reverted-$(date -u +%Y%m%dT%H%M%SZ)" ;;

enroll-update)
  # Enrollment page only (layout/logo + invite kept for the tab). Replaces centralEnrollment.ts/.js; nothing else.
  [ "${CONFIRM:-}" = "UPDATE-ENROLLMENT-PAGE" ] || { echo "set CONFIRM=UPDATE-ENROLLMENT-PAGE"; exit 1; }
  F=src/express/centralEnrollment.ts; O=dist/express/centralEnrollment.js
  case " $ENROLL_PREV_SHAS " in *" $(sha256sum "$B61/$F" | cut -d' ' -f1) "*) ;; *) echo "deployed $F is not a known earlier version - stopping"; exit 1;; esac
  echo "building the 6.1B candidate (temp copy; nothing changed yet)..."
  T=$(mktemp -d "$S/central_e.XXXX"); copy_tree "$B61" "$T"; cp "$D/loginv2_6.1B/centralEnrollment.ts" "$T/$F"; build_tree "$T"
  BK=$S/central_enroll_backup-$(date -u +%Y%m%dT%H%M%SZ); mkdir -p "$BK"; cp -p "$B61/$F" "$B61/$O" "$BK/"
  cp "$T/$F" "$B61/$F"; cp "$T/dist.candidate/express/centralEnrollment.js" "$B61/$O"; chmod 644 "$B61/$O"; rm -rf "$T"
  cp "$D/loginv2_6.1B/assets/tcds-logo-wide.jpg" "$S/central_assets/"; chmod 644 "$S/central_assets/tcds-logo-wide.jpg"
  clean_pm2 restart "$AAPP" >/dev/null; wait_port 8196 && wait_port $ENROLL_PORT || { echo "!! API listeners not up - restore: cp $BK/* back, restart"; exit 1; }
  curl -s -o /dev/null -w "enrollment page: %{http_code}\n" http://127.0.0.1:$ENROLL_PORT/enroll/
  curl -s -o /dev/null -w "logo: %{http_code} %{content_type}\n" http://127.0.0.1:$ENROLL_PORT/enroll/assets/tcds-logo-wide.jpg
  curl -s -o /dev/null -w "sign-in API (unchanged): %{http_code}\n" http://127.0.0.1:8195/api/v1/auth/session
  echo "ENROLLMENT PAGE UPDATED (backup $BK)" ;;

proxy-stop)
  clean_pm2 delete "$PAPP" >/dev/null 2>&1 || true; clean_pm2 save >/dev/null; echo "proxy stopped (files kept in $MI)" ;;

db-uninstall)
  [ "${CONFIRM:-}" = "UNINSTALL-626" ] || { echo "set CONFIRM=UNINSTALL-626"; exit 1; }
  [ "$(q -c "SELECT count(*) FROM pg_roles WHERE rolname='tcds_login_central'")" = 0 ] || q -c "DROP ROLE tcds_login_central"
  q -f $D/626_rollback.sql && echo "626 UNINSTALLED" ;;

*) sed -n '2,22p' "$0"; exit 2 ;;
esac
