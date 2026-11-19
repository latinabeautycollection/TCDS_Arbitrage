#!/usr/bin/env bash
# STAGING ONLY. EOC module-grant approval (TCDS 630) end to end:
#   IAM DB kqcdqtazcqaawdkmcfed (630) -> 6.1C grant routes -> grant admission service (loopback :8403, vendor admission
#   code) -> retail EOC DB crydmokyojaynmrtxkym (vendor 072 writer) -> eoc_iam.module_grants.
# Order: preflight, db-rehearse, db-install, db-test, eoc-check, eoc-logins, admission-deploy, verifier-update, api-update,
#        approvers, request (one per person), then each approver opens the link; status at any time.
#   preflight        read only: package hashes, deployed versions, 628 in / 630 not, candidates compile, port 8403 free
#   db-rehearse      ONE transaction: catalog A -> 630 -> 631 tests -> 630 rollback -> catalog B (= A) -> ROLLBACK
#   db-install       CONFIRM=INSTALL-630           db-test   631 in a rolled-back transaction
#   eoc-check        read only, retail EOC DB: 072 installed, its roles present, our two logins absent
#   eoc-logins       CONFIRM=CREATE-EOC-GRANT-LOGINS: eoc_grant_attest_stg (attestation writer only) and eoc_grant_admin_stg
#                    (grant admin only); passwords generated here, set as SCRAM verifiers, kept in the admission env (0600)
#   admission-deploy CONFIRM=DEPLOY-GRANT-ADMISSION: approval signing key (Ed25519) + shared secret generated here,
#                    service files to ~/stg_login/grant_admission, PM2 eoc-grant-admission-staging on 127.0.0.1:8403, ready
#   verifier-update  CONFIRM=UPDATE-CENTRAL-VERIFIER: 6.1C central files (+ centralGrants.ts) and the CENTRAL_GRANT_* /
#                    CENTRAL_APPROVAL_* config keys; restart; ready/central must report grantApproval
#   api-update       CONFIRM=UPDATE-CENTRAL-API: 6.1B approval page (grant mode) + verifier client; restart
#   page-update      CONFIRM=UPDATE-APPROVAL-PAGE: approval page only (compact two-pane card); revert-page goes back
#   approvers        CONFIRM=ASSIGN-GRANT-APPROVERS: EOC_MODULE_GRANT_APPROVER to the two staging approvers, company-wide, 60 days
#   request          CONFIRM=REQUEST-GRANTS bash $0 request <username> "<purpose>": VIEW on all 20 EOC modules, company-wide,
#                    90 days; 72-hour request; prints the approval link (no secret in it)
#   status           read only: requests, live approvals, EOC grants per pilot account
#   revert-verifier / revert-api (CONFIRM=REVERT-GRANTS), admission-stop, eoc-logins-drop (CONFIRM=DROP-EOC-GRANT-LOGINS),
#   db-uninstall (CONFIRM=UNINSTALL-630; refuses if requests exist)
# Copy: scp -r central_passkey apifydev@139.177.200.80:/tmp/     (run from /srv/arb-system/api)
set -euo pipefail
D=/tmp/central_passkey
S=$HOME/stg_login; CFG=$S/config.json; C61=$S/6.1C; B61=$S/6.1B; GA=$S/grant_admission
VAPP=login-v2-verifier-staging; AAPP=login-v2-api-staging; GAPP=eoc-grant-admission-staging; GPORT=8403
RP=login-stg.tcdsolutionsgroup.com; ENROLL_PORT=8198
EOC_HOST=db.crydmokyojaynmrtxkym.supabase.co; IAM_HOST=db.kqcdqtazcqaawdkmcfed.supabase.co
APPROVAL_ISSUER=urn:tcds:iam:central-verifier:staging; APPROVAL_AUDIENCE=urn:tcds:eoc:retail:staging
CA_SRC=/etc/tcds-issuer/postgres-ca.pem
APPROVERS="yahaira.rosario.malone.stg robert.mahoney.stg"; ADMIN=stg.identity.admin
cd /srv/arb-system/api
eval "$(grep -E '^(PGPASSWORD)=' .env | sed -E "s/^([A-Z_]+)=(.*)$/export \1='\2'/")"
export PGHOST=$IAM_HOST PGPORT=5432 PGDATABASE=postgres PGUSER=postgres PAGER=cat PGCONNECT_TIMEOUT=10
grep -q kqcdqtazcqaawdkmcfed "$CFG" || { echo "$CFG is not the staging config - stopping"; exit 1; }
umask 077
q() { psql -X -At -v ON_ERROR_STOP=1 "$@"; }
qe() { PGHOST=$EOC_HOST psql -X -At -v ON_ERROR_STOP=1 "$@"; }
clean_pm2() { env -i HOME="$HOME" PATH="$PATH" USER="$USER" LANG=C.UTF-8 pm2 "$@"; }
strip() { grep -vxE 'BEGIN;|COMMIT;' "$1"; }
listening() { ss -ltn | grep -q "127.0.0.1:$1 "; }
wait_port() { for i in $(seq 1 20); do listening "$1" && return 0; sleep 1; done; return 1; }
installed630() { [ "$(q -c "SELECT to_regclass('warehouse_identity.central_grant_requests') IS NOT NULL")" = t ]; }
copy_tree() { ( cd "$1" && tar --exclude=./node_modules --exclude=./dist.candidate -cf - . ) | ( cd "$2" && tar -xf - ); ln -s "$1/node_modules" "$2/node_modules"; }
build_tree() { ( cd "$1" && ./node_modules/.bin/tsc -p tsconfig.json --noEmit && ./node_modules/.bin/tsc -p tsconfig.json --outDir dist.candidate ); }
sha() { sha256sum "$1" | cut -d' ' -f1; }

( cd "$D" && sha256sum -c --quiet - ) <<'SUMS' || { echo "package files differ from the reviewed copies - stopping"; exit 1; }
918f1bce4c3ef31c4974bf0310a40660153f243c9a8e86e2f11e33e3229d5ea4  626_catalog_snapshot.sql
66e40fb8a2b5b288c7ab7e90ce63117f714fa6ec6c2f31254b8fe65d6b60def1  grants/630_central_grant_approval.sql
8a06b64890a4c4130e35b1cd342680a0cb27d4089712e6f75e16be9aea59ce57  grants/630_rollback.sql
09e7be4a19244a6de83e017cb4f91c6595f6d4dbb697b05a0c998329a027f021  grants/631_central_grant_approval_tests.sql
646b9d28f92160853b40ec5fa5561fcc4438257a8b777feff430be58adbdd8dc  verifier_6.1C/src/central/centralService.ts
2d220f00e8f1f7d84c689ea347f58face8479c45ac2ed6a273c89b92db47e002  verifier_6.1C/src/central/centralRoutes.ts
b7665464cf1523e1261216292a0dde30ee7eead0d918e2750dcc8b475a6e7a85  verifier_6.1C/src/central/centralMount.ts
feb69f35f1f7867b378494982e6da93e8a481a3addc43a01bb7218ec5b9cd49c  verifier_6.1C/src/central/centralGrants.ts
3d6e27278c2bd243ceff063a194d3d8771570ecb8bbae480c5cc2e7c883618aa  loginv2_6.1B/centralEnrollment.ts
4d0e7159d2383c24e1484f12fb42f59eac0c66edb8e85d8777092ff96154470e  loginv2_6.1B/centralVerifierClient.ts
8da9300e919101d1be67462c694e95686cbfb3fe8bae693c4849334a4dc74208  grant_admission/grantAdmission.mjs
4ab9a2f5fd4e59569ba886646333bf346131afa82072ef4c3d2c0b7be57fdebc  grant_admission/start.cjs
SUMS

# Deployed versions this replaces (626 deploy + 628 approval update + approval page v2, 2026-11-19).
V_SERVICE_OLD=ccf7540926e0aa0c4018b5f5198d30226a4284236540bb81564a67b48116e024
V_ROUTES_OLD=fa681cc99aa2b8f2dc5c9267a38037da2ff919f70798798c0f9374b9759b1e8e
V_MOUNT_OLD=654b5d845845af66fc2f541b0a7f2a8c860568bc5306cfebe2476ea6aabe6818
A_ENROLL_OLD=09ba804e37dd4bbc167853d52932d42ff7537df6a3c1df42155912c58c4bb0ed
A_CLIENT_OLD=faa7e6edf4a0aafc24d3f4b11d2f51d37809571df76fc258cf6c115e647e0d9d
V_NEW="centralService centralRoutes centralMount centralGrants"
A_NEW="centralEnrollment centralVerifierClient"
A_ENROLL_GRANTS1=8e0023d6970a6f8968e4406e46dd9c7abe7f4f55555514bde50ab3016844e65e   # approval page with grant mode, as deployed by api-update
MODULES="executive capital acquisition market retail pqp purchasing warehouse shipping returns identity hardware governance forensic ai administration decisions agents knowledge scenarios"

check_deployed() {
  local ok=0
  [ "$(sha $C61/src/central/centralService.ts)" = "$V_SERVICE_OLD" ] && [ "$(sha $C61/src/central/centralRoutes.ts)" = "$V_ROUTES_OLD" ] \
    && [ "$(sha $C61/src/central/centralMount.ts)" = "$V_MOUNT_OLD" ] && [ ! -e "$C61/src/central/centralGrants.ts" ] \
    && echo "ok 6.1C central files are the 628 versions (no grant routes yet)" || { echo "6.1C central files are not the expected versions"; ok=1; }
  [ "$(sha $B61/src/express/centralEnrollment.ts)" = "$A_ENROLL_OLD" ] && [ "$(sha $B61/src/express/centralVerifierClient.ts)" = "$A_CLIENT_OLD" ] \
    && echo "ok 6.1B approval page v2 + client deployed" || { echo "6.1B central files are not the expected versions"; ok=1; }
  return $ok
}
candidate() {  # $1 = C61|B61 -> prints a temp tree with the new files, built
  local T f; T=$(mktemp -d "$S/grants_cand.XXXX")
  if [ "$1" = C61 ]; then copy_tree "$C61" "$T"; for f in $V_NEW; do cp "$D/verifier_6.1C/src/central/$f.ts" "$T/src/central/"; done
  else copy_tree "$B61" "$T"; for f in $A_NEW; do cp "$D/loginv2_6.1B/$f.ts" "$T/src/express/"; done; fi
  build_tree "$T" >/dev/null || { (cd "$T" && ./node_modules/.bin/tsc -p tsconfig.json --noEmit | head -20) >&2; rm -rf "$T"; return 1; }
  echo "$T"
}
# SCRAM-SHA-256 verifier for a password (the password itself never reaches the database server or its logs)
scram() { PW="$1" node -e 'const c=require("crypto"),p=process.env.PW,s=c.randomBytes(16),i=4096,k=c.pbkdf2Sync(p,s,i,32,"sha256");
  const h=(key,m)=>c.createHmac("sha256",key).update(m).digest();const ck=h(k,"Client Key"),sk=h(k,"Server Key");
  process.stdout.write(`SCRAM-SHA-256$${i}:${s.toString("base64")}$${c.createHash("sha256").update(ck).digest("base64")}:${sk.toString("base64")}`)'; }
items_json() { node -e 'process.stdout.write(JSON.stringify(process.argv.slice(1).map(m=>({moduleId:m,operation:"VIEW",scopeKind:"ENTERPRISE",scopeIds:[]}))))' $MODULES; }

case "${1:-}" in
preflight)
  check_deployed || { echo "STOP"; exit 1; }
  for t in C61 B61; do T=$(candidate $t) && { echo "ok $t candidate compiles"; rm -rf "$T"; } || { echo "STOP $t candidate does not compile"; exit 1; }; done
  q -c "SELECT '628 installed=' || (to_regclass('warehouse_identity.central_binding_requests') IS NOT NULL) || ', 630 installed=' || (to_regclass('warehouse_identity.central_grant_requests') IS NOT NULL) || ', grant approver role=' || EXISTS (SELECT 1 FROM warehouse_identity.roles WHERE role_code='EOC_MODULE_GRANT_APPROVER')"
  listening $GPORT && echo "!! port $GPORT already in use" || echo "ok port $GPORT free"
  [ -r "$CA_SRC" ] && echo "ok Postgres CA readable ($CA_SRC)" || echo "!! $CA_SRC not readable"
  echo "PREFLIGHT DONE" ;;

db-rehearse)
  installed630 && { echo "630 already installed"; exit 1; }
  { echo "BEGIN;"; echo "\\set snap A"; cat $D/626_catalog_snapshot.sql; strip $D/grants/630_central_grant_approval.sql; cat $D/grants/631_central_grant_approval_tests.sql
    echo "SET LOCAL tcds.r630_delete_grant_approvals = 'yes';"; strip $D/grants/630_rollback.sql; echo "\\set snap B"; cat $D/626_catalog_snapshot.sql
    echo "SELECT 'catalog A vs B differences after rollback: ' || count(*) FROM ((SELECT item FROM _snap WHERE name='A' EXCEPT SELECT item FROM _snap WHERE name='B') UNION ALL (SELECT item FROM _snap WHERE name='B' EXCEPT SELECT item FROM _snap WHERE name='A')) d;"
    echo "SELECT 'diff: ' || item FROM ((SELECT 'A-only ' || item AS item FROM (SELECT item FROM _snap WHERE name='A' EXCEPT SELECT item FROM _snap WHERE name='B') x) UNION ALL (SELECT 'B-only ' || item FROM (SELECT item FROM _snap WHERE name='B' EXCEPT SELECT item FROM _snap WHERE name='A') y)) z LIMIT 20;"
    echo "ROLLBACK;"; } | q 2>&1 | grep -E 'FAIL|SUMMARY|ERROR|catalog|diff'
  echo "rehearse finished (ROLLBACK)" ;;

db-install)
  [ "${CONFIRM:-}" = "INSTALL-630" ] || { echo "set CONFIRM=INSTALL-630"; exit 1; }
  installed630 && { echo "630 already installed"; exit 1; }
  q -f $D/grants/630_central_grant_approval.sql >/dev/null && echo "630 INSTALLED" ;;

db-test)
  installed630 || { echo "630 not installed"; exit 1; }
  { echo "BEGIN;"; cat $D/grants/631_central_grant_approval_tests.sql; echo "ROLLBACK;"; } | q 2>&1 | grep -E 'FAIL|SUMMARY|ERROR' ;;

eoc-check)
  [ -z "$(qe -c "SELECT 1 WHERE to_regnamespace('warehouse_identity') IS NOT NULL")" ] || { echo "warehouse_identity found on the EOC host - wrong database, stopping"; exit 1; }
  qe <<'SQL'
SELECT 'eoc 072 writer installed=' || (to_regprocedure('eoc_iam.create_governed_grant_v12(uuid,text,text,text,text[],uuid,uuid,uuid,uuid,timestamptz,timestamptz,uuid,text)') IS NOT NULL);
SELECT 'eoc attestation table=' || (to_regclass('eoc_iam.grant_verified_attestations_v12') IS NOT NULL) || ', reader=' || (to_regprocedure('eoc_iam.grants_for_subject_v12(uuid)') IS NOT NULL);
SELECT 'role ' || r || '=' || EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) FROM unnest(ARRAY['eoc_iam_verified_attestation_writer','eoc_grant_admin_runtime','eoc_grant_fn_owner']) r;
SELECT 'login ' || r || ' exists=' || EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) FROM unnest(ARRAY['eoc_grant_attest_stg','eoc_grant_admin_stg']) r;
SELECT 'grants in eoc_iam.module_grants=' || count(*) FROM eoc_iam.module_grants;
SQL
  echo "EOC CHECK DONE (read only)" ;;

eoc-logins)
  [ "${CONFIRM:-}" = "CREATE-EOC-GRANT-LOGINS" ] || { echo "set CONFIRM=CREATE-EOC-GRANT-LOGINS"; exit 1; }
  [ -z "$(qe -c "SELECT 1 WHERE to_regnamespace('warehouse_identity') IS NOT NULL")" ] || { echo "wrong database, stopping"; exit 1; }
  mkdir -p "$GA"; chmod 700 "$GA"; ENVF=$GA/admission.env
  [ -e "$ENVF" ] && { echo "$ENVF exists - logins already created? (eoc-logins-drop first)"; exit 1; }
  PW1=$(node -e 'process.stdout.write(require("crypto").randomBytes(32).toString("base64url"))'); PW2=$(node -e 'process.stdout.write(require("crypto").randomBytes(32).toString("base64url"))')
  V1=$(scram "$PW1"); V2=$(scram "$PW2")
  qe -v v1="$V1" -v v2="$V2" <<'SQL' >/dev/null
BEGIN;
CREATE ROLE eoc_grant_attest_stg LOGIN NOINHERIT PASSWORD :'v1';
GRANT eoc_iam_verified_attestation_writer TO eoc_grant_attest_stg WITH INHERIT TRUE;
CREATE ROLE eoc_grant_admin_stg LOGIN NOINHERIT PASSWORD :'v2';
GRANT eoc_grant_admin_runtime TO eoc_grant_admin_stg WITH INHERIT TRUE;
ALTER ROLE eoc_grant_attest_stg CONNECTION LIMIT 4; ALTER ROLE eoc_grant_admin_stg CONNECTION LIMIT 4;
COMMIT;
SQL
  { echo "ATTESTATION_WRITER_USER=eoc_grant_attest_stg"; echo "ATTESTATION_WRITER_PASSWORD=$PW1"; echo "GRANT_ADMIN_USER=eoc_grant_admin_stg"; echo "GRANT_ADMIN_PASSWORD=$PW2"; } > "$ENVF"
  chmod 600 "$ENVF"; unset PW1 PW2 V1 V2
  qe -c "SELECT 'login ' || r.rolname || ' member of ' || string_agg(g.rolname, ',') FROM pg_roles r JOIN pg_auth_members m ON m.member = r.oid JOIN pg_roles g ON g.oid = m.roleid WHERE r.rolname IN ('eoc_grant_attest_stg','eoc_grant_admin_stg') GROUP BY r.rolname ORDER BY 1"
  echo "EOC GRANT LOGINS CREATED (passwords only in $ENVF, 0600)" ;;

admission-deploy)
  [ "${CONFIRM:-}" = "DEPLOY-GRANT-ADMISSION" ] || { echo "set CONFIRM=DEPLOY-GRANT-ADMISSION"; exit 1; }
  ENVF=$GA/admission.env; [ -f "$ENVF" ] || { echo "run eoc-logins first"; exit 1; }
  listening $GPORT && { echo "port $GPORT in use - stopping"; exit 1; }
  ( cd "$D/grant_admission" && sha256sum -c --quiet - ) <<'SUMS' || { echo "admission files differ from the reviewed copies - stopping"; exit 1; }
91018397c3727d443298a509483d9e9f1cb9834e7f357df93c82f1b8bc80fb06  vendor/approvalProtocol.mjs
c106622e4c3422df447d7a3962f475b8f0bc4f9f146b01e868e16f0a3b184cc4  vendor/approvalAdmission.mjs
SUMS
  mkdir -p "$GA/vendor"; cp "$D/grant_admission/grantAdmission.mjs" "$D/grant_admission/start.cjs" "$GA/"; cp "$D/grant_admission/vendor/"*.mjs "$GA/vendor/"
  [ -e "$GA/node_modules" ] || ln -s "$C61/node_modules" "$GA/node_modules"
  install -m 600 "$CA_SRC" "$GA/postgres-ca.pem"
  openssl s_client -starttls postgres -connect "$EOC_HOST:5432" -CAfile "$GA/postgres-ca.pem" -verify_return_error </dev/null 2>/dev/null \
    | grep -q 'Verify return code: 0 (ok)' && echo "ok EOC DB TLS verifies against the CA" || { echo "EOC DB TLS does not verify - stopping"; exit 1; }
  # signing key: private half -> verifier config only; public half -> the admission service
  if ! grep -q '^GRANT_ADMISSION_SECRET=' "$ENVF"; then
    node -e 'const c=require("crypto"),fs=require("fs"),{privateKey,publicKey}=c.generateKeyPairSync("ed25519");
      fs.writeFileSync(process.argv[1],privateKey.export({type:"pkcs8",format:"pem"}),{mode:0o600});
      fs.writeFileSync(process.argv[2],publicKey.export({type:"spki",format:"pem"}),{mode:0o600})' "$GA/approval_signing.key" "$GA/approval_public.pem"
    { echo "GRANT_ADMISSION_SECRET=$(node -e 'process.stdout.write(require("crypto").randomBytes(48).toString("base64url"))')"
      echo "APPROVAL_PUBLIC_KEY_PEM_FILE=$GA/approval_public.pem"; echo "APPROVAL_ISSUER=$APPROVAL_ISSUER"; echo "APPROVAL_AUDIENCE=$APPROVAL_AUDIENCE"
      echo "EOC_DB_HOST=$EOC_HOST"; echo "EOC_DB_PORT=5432"; echo "EOC_DB_NAME=postgres"; echo "EOC_DB_CA_FILE=$GA/postgres-ca.pem"; echo "GRANT_ADMISSION_PORT=$GPORT"; } >> "$ENVF"
  fi
  cat > "$GA/grant_admission.config.cjs" <<'JS'
const fs=require('fs'),path=require('path');const env={};
for(const l of fs.readFileSync(path.join(__dirname,'admission.env'),'utf8').split('\n')){const m=l.match(/^([A-Z_]+)=(.*)$/);if(m)env[m[1]]=m[2]}
module.exports={apps:[{name:'eoc-grant-admission-staging',script:path.join(__dirname,'start.cjs'),cwd:__dirname,env,autorestart:true,max_restarts:10,min_uptime:5000}]};
JS
  chmod 600 "$GA/grant_admission.config.cjs"
  clean_pm2 start "$GA/grant_admission.config.cjs" >/dev/null; wait_port $GPORT || { echo "!! admission not listening"; pm2 logs $GAPP --nostream --lines 20; exit 1; }
  sleep 1; R=$(curl -s http://127.0.0.1:$GPORT/ready); echo "admission ready: $R"
  echo "$R" | grep -q '"ready"' || { echo "!! admission cannot reach the EOC DB with its logins - check: pm2 logs $GAPP"; exit 1; }
  curl -s -o /dev/null -w "unauthenticated admit refused: %{http_code}\n" -X POST -H 'content-type: application/json' -d '{}' http://127.0.0.1:$GPORT/internal/v1/eoc/grants/admit
  clean_pm2 save >/dev/null; echo "GRANT ADMISSION DEPLOYED (PM2 $GAPP, 127.0.0.1:$GPORT)" ;;

verifier-update)
  [ "${CONFIRM:-}" = "UPDATE-CENTRAL-VERIFIER" ] || { echo "set CONFIRM=UPDATE-CENTRAL-VERIFIER"; exit 1; }
  installed630 || { echo "install 630 first"; exit 1; }
  [ -f "$GA/approval_signing.key" ] && grep -q '^GRANT_ADMISSION_SECRET=' "$GA/admission.env" || { echo "run admission-deploy first"; exit 1; }
  [ "$(sha $C61/src/central/centralService.ts)" = "$V_SERVICE_OLD" ] && [ "$(sha $C61/src/central/centralMount.ts)" = "$V_MOUNT_OLD" ] \
    || { echo "6.1C central files are not the 628 versions - stopping"; exit 1; }
  echo "building the 6.1C candidate (temp copy)..."; T=$(candidate C61)
  BK=$S/grants_verifier_backup-$(date -u +%Y%m%dT%H%M%SZ); mkdir -p "$BK/src" "$BK/dist"; cp -p "$CFG" "$BK/config.json"
  for f in centralService centralRoutes centralMount; do cp -p "$C61/src/central/$f.ts" "$BK/src/"; cp -p "$C61/dist/central/$f.js" "$BK/dist/"; done
  for f in $V_NEW; do cp "$T/src/central/$f.ts" "$C61/src/central/"; cp "$T/dist.candidate/central/$f.js" "$C61/dist/central/"; done
  rm -rf "$T"; echo "$BK" > "$S/.grants_verifier_backup"
  SECRET=$(grep '^GRANT_ADMISSION_SECRET=' "$GA/admission.env" | cut -d= -f2-)
  SECRET="$SECRET" node -e 'const fs=require("fs"),f=process.argv[1],c=JSON.parse(fs.readFileSync(f,"utf8"));
    Object.assign(c.verifier,{CENTRAL_GRANT_ADMISSION_URL:"http://127.0.0.1:"+process.argv[2],CENTRAL_GRANT_ADMISSION_SECRET:process.env.SECRET,
      CENTRAL_APPROVAL_SIGNING_KEY_PEM:fs.readFileSync(process.argv[3],"utf8"),CENTRAL_APPROVAL_ISSUER:process.argv[4],CENTRAL_APPROVAL_AUDIENCE:process.argv[5]});
    const t=f+".tmp";fs.writeFileSync(t,JSON.stringify(c,null,2)+"\n",{mode:0o600});fs.renameSync(t,f)' "$CFG" "$GPORT" "$GA/approval_signing.key" "$APPROVAL_ISSUER" "$APPROVAL_AUDIENCE"
  unset SECRET
  clean_pm2 restart "$VAPP" >/dev/null; wait_port 8191 || { echo "!! verifier not listening - revert with CONFIRM=REVERT-GRANTS $0 revert-verifier"; exit 1; }
  sleep 1; R=$(curl -s http://127.0.0.1:8191/ready/central); echo "ready/central: $R"
  echo "$R" | grep -q '"grantApproval":true' || { echo "!! grant routes not active - revert with CONFIRM=REVERT-GRANTS $0 revert-verifier"; exit 1; }
  curl -s -o /dev/null -w "warehouse ready (unchanged): %{http_code}\n" http://127.0.0.1:8191/ready
  echo "VERIFIER UPDATED (backup $BK)" ;;

api-update)
  [ "${CONFIRM:-}" = "UPDATE-CENTRAL-API" ] || { echo "set CONFIRM=UPDATE-CENTRAL-API"; exit 1; }
  [ "$(sha $B61/src/express/centralEnrollment.ts)" = "$A_ENROLL_OLD" ] && [ "$(sha $B61/src/express/centralVerifierClient.ts)" = "$A_CLIENT_OLD" ] \
    || { echo "6.1B central files are not the expected versions - stopping"; exit 1; }
  echo "building the 6.1B candidate (temp copy)..."; T=$(candidate B61)
  BK=$S/grants_api_backup-$(date -u +%Y%m%dT%H%M%SZ); mkdir -p "$BK/src" "$BK/dist"
  for f in $A_NEW; do cp -p "$B61/src/express/$f.ts" "$BK/src/"; cp -p "$B61/dist/express/$f.js" "$BK/dist/"; cp "$T/src/express/$f.ts" "$B61/src/express/"; cp "$T/dist.candidate/express/$f.js" "$B61/dist/express/"; chmod 644 "$B61/dist/express/$f.js"; done
  rm -rf "$T"; echo "$BK" > "$S/.grants_api_backup"
  clean_pm2 restart "$AAPP" >/dev/null; wait_port 8196 && wait_port $ENROLL_PORT || { echo "!! API listeners not up - revert with CONFIRM=REVERT-GRANTS $0 revert-api"; exit 1; }
  curl -s -o /dev/null -w "enrollment page: %{http_code}\n" http://127.0.0.1:$ENROLL_PORT/enroll/
  curl -s -o /dev/null -w "approval page: %{http_code}\n" "http://127.0.0.1:$ENROLL_PORT/approve/?g=00000000-0000-4000-8000-000000000000"
  curl -s http://127.0.0.1:$ENROLL_PORT/approve/assets/approve.js | grep -q "EOC access." && echo "approval page serves grant mode" || echo "!! grant mode NOT served"
  curl -s -o /dev/null -w "sign-in API (unchanged): %{http_code}\n" http://127.0.0.1:8195/api/v1/auth/session
  echo "API UPDATED (backup $BK)" ;;

page-update)
  [ "${CONFIRM:-}" = "UPDATE-APPROVAL-PAGE" ] || { echo "set CONFIRM=UPDATE-APPROVAL-PAGE"; exit 1; }
  [ "$(sha $B61/src/express/centralEnrollment.ts)" = "$A_ENROLL_GRANTS1" ] || { echo "6.1B centralEnrollment.ts is not the api-update version - stopping"; exit 1; }
  cmp -s "$D/loginv2_6.1B/centralVerifierClient.ts" "$B61/src/express/centralVerifierClient.ts" || { echo "verifier client differs - use api-update instead"; exit 1; }
  echo "building the 6.1B candidate (temp copy)..."; T=$(candidate B61)
  BK=$S/grants_page_backup-$(date -u +%Y%m%dT%H%M%SZ); mkdir -p "$BK/src" "$BK/dist"
  cp -p "$B61/src/express/centralEnrollment.ts" "$BK/src/"; cp -p "$B61/dist/express/centralEnrollment.js" "$BK/dist/"
  cp "$T/src/express/centralEnrollment.ts" "$B61/src/express/"; cp "$T/dist.candidate/express/centralEnrollment.js" "$B61/dist/express/"; chmod 644 "$B61/dist/express/centralEnrollment.js"
  rm -rf "$T"; echo "$BK" > "$S/.grants_page_backup"
  clean_pm2 restart "$AAPP" >/dev/null; wait_port 8196 && wait_port $ENROLL_PORT || { echo "!! API listeners not up - revert with CONFIRM=REVERT-GRANTS $0 revert-page"; exit 1; }
  curl -s -o /dev/null -w "approval page: %{http_code}\n" "http://127.0.0.1:$ENROLL_PORT/approve/?g=00000000-0000-4000-8000-000000000000"
  curl -s http://127.0.0.1:$ENROLL_PORT/approve/ | grep -q "approve-body" && echo "compact two-pane card served" || echo "!! new card NOT served"
  curl -s -o /dev/null -w "sign-in API (unchanged): %{http_code}\n" http://127.0.0.1:8195/api/v1/auth/session
  echo "APPROVAL PAGE UPDATED (backup $BK)" ;;

revert-page)
  [ "${CONFIRM:-}" = "REVERT-GRANTS" ] || { echo "set CONFIRM=REVERT-GRANTS"; exit 1; }
  BK=$(cat "$S/.grants_page_backup"); cp -p "$BK/src/centralEnrollment.ts" "$B61/src/express/"; cp -p "$BK/dist/centralEnrollment.js" "$B61/dist/express/"
  clean_pm2 restart "$AAPP" >/dev/null; wait_port 8196 && wait_port $ENROLL_PORT && echo "approval page reverted" ;;

approvers)
  [ "${CONFIRM:-}" = "ASSIGN-GRANT-APPROVERS" ] || { echo "set CONFIRM=ASSIGN-GRANT-APPROVERS"; exit 1; }
  installed630 || { echo "630 not installed"; exit 1; }
  q <<SQL
BEGIN;
INSERT INTO warehouse_identity.user_role_assignments (user_id, role_id, valid_until, assigned_by)
SELECT u.user_id, r.role_id, clock_timestamp() + interval '60 days', (SELECT user_id FROM warehouse_identity.users WHERE username = '$ADMIN')
  FROM warehouse_identity.users u, warehouse_identity.roles r
 WHERE u.username IN ($(printf "'%s'," $APPROVERS | sed 's/,$//')) AND u.status = 'ACTIVE' AND r.role_code = 'EOC_MODULE_GRANT_APPROVER'
   AND NOT EXISTS (SELECT 1 FROM warehouse_identity.user_role_assignments x WHERE x.user_id = u.user_id AND x.role_id = r.role_id AND x.revoked_at IS NULL);
SELECT 'grant approver ' || u.username || ' until ' || to_char(ra.valid_until, 'YYYY-MM-DD')
  FROM warehouse_identity.user_role_assignments ra JOIN warehouse_identity.users u USING (user_id) JOIN warehouse_identity.roles r USING (role_id)
 WHERE r.role_code = 'EOC_MODULE_GRANT_APPROVER' AND ra.revoked_at IS NULL ORDER BY 1;
COMMIT;
SQL
  ;;

request)
  [ "${CONFIRM:-}" = "REQUEST-GRANTS" ] || { echo "set CONFIRM=REQUEST-GRANTS"; exit 1; }
  installed630 || { echo "630 not installed"; exit 1; }
  U="${2:-}"; P="${3:-}"
  case "$U" in anthony.malone.stg|korina.korva.stg) ;; *) echo "usage: CONFIRM=REQUEST-GRANTS $0 request <anthony.malone.stg|korina.korva.stg> \"<purpose>\""; exit 1;; esac
  [ ${#P} -ge 3 ] || { echo "give a purpose, e.g. \"EOC pilot: CEO module view\""; exit 1; }
  ID=$(q -v items="$(items_json)" -v u="$U" -v p="$P" -v a="$ADMIN" <<'SQL'
BEGIN;
GRANT tcds_identity_central_admin TO current_user WITH INHERIT TRUE;
SELECT warehouse_identity.central_request_grants_v1(
  (SELECT user_id FROM warehouse_identity.users WHERE username = :'u' AND status = 'ACTIVE'), :'items'::jsonb, 90, :'p',
  (SELECT user_id FROM warehouse_identity.users WHERE username = :'a' AND status = 'ACTIVE'), 72);
REVOKE tcds_identity_central_admin FROM current_user;
COMMIT;
SQL
)
  ID=$(echo "$ID" | grep -Eo '[0-9a-f-]{36}' | head -1)
  echo "Grant request for $U: VIEW on 20 EOC modules, company-wide, 90 days (request open 72 hours)."
  echo "  https://$RP/approve/?g=$ID"
  echo "The link is not a secret: approving needs an approver's passkey. Both approvals within 5 minutes of each other." ;;

status)
  q <<SQL
SELECT 'grant request ' || rpad(u.username, 22) || rpad(CASE WHEN r.status = 'OPEN' AND r.expires_at <= now() THEN 'EXPIRED' ELSE r.status END, 10)
       || ' live approvals=' || (SELECT count(DISTINCT a.approver_user_id) FROM warehouse_identity.central_grant_approvals a
            WHERE a.grant_request_id = r.central_grant_request_id AND a.consumed_at IS NULL AND a.expires_at > now())
       || ' items=' || jsonb_array_length(r.items) || coalesce(' eoc grants=' || cardinality(r.eoc_grant_ids), '')
       || ' "' || r.purpose || '"  https://$RP/approve/?g=' || r.central_grant_request_id
  FROM warehouse_identity.central_grant_requests r JOIN warehouse_identity.users u ON u.user_id = r.target_user_id ORDER BY r.created_at;
SELECT 'grant approver ' || u.username || ' until ' || to_char(ra.valid_until, 'YYYY-MM-DD')
  FROM warehouse_identity.user_role_assignments ra JOIN warehouse_identity.users u USING (user_id) JOIN warehouse_identity.roles r USING (role_id)
 WHERE r.role_code = 'EOC_MODULE_GRANT_APPROVER' AND ra.revoked_at IS NULL ORDER BY 1;
SQL
  IDS=$(q -c "SELECT string_agg(username || '=' || user_id, ' ') FROM warehouse_identity.users WHERE username IN ('anthony.malone.stg','korina.korva.stg')")
  for kv in $IDS; do n=${kv%%=*}; id=${kv#*=}
    echo "eoc grants    $(printf '%-22s' "$n") $(qe -c "SELECT count(*) || ' active (' || coalesce(string_agg(DISTINCT operation, ','), '-') || '), until ' || coalesce(to_char(min(valid_until), 'YYYY-MM-DD'), '-') FROM eoc_iam.module_grants WHERE subject_id = '$id' AND revoked_at IS NULL AND valid_until > now()")"
  done ;;

revert-verifier)
  [ "${CONFIRM:-}" = "REVERT-GRANTS" ] || { echo "set CONFIRM=REVERT-GRANTS"; exit 1; }
  BK=$(cat "$S/.grants_verifier_backup")
  for f in centralService centralRoutes centralMount; do cp -p "$BK/src/$f.ts" "$C61/src/central/"; cp -p "$BK/dist/$f.js" "$C61/dist/central/"; done
  rm -f "$C61/src/central/centralGrants.ts" "$C61/dist/central/centralGrants.js"; cp -p "$BK/config.json" "$CFG"
  clean_pm2 restart "$VAPP" >/dev/null; wait_port 8191 && echo "verifier reverted (no grant routes, grant keys removed from config)" ;;

revert-api)
  [ "${CONFIRM:-}" = "REVERT-GRANTS" ] || { echo "set CONFIRM=REVERT-GRANTS"; exit 1; }
  BK=$(cat "$S/.grants_api_backup"); for f in $A_NEW; do cp -p "$BK/src/$f.ts" "$B61/src/express/"; cp -p "$BK/dist/$f.js" "$B61/dist/express/"; done
  clean_pm2 restart "$AAPP" >/dev/null; wait_port 8196 && wait_port $ENROLL_PORT && echo "API reverted (approval page v2, binding only)" ;;

admission-stop)
  clean_pm2 delete "$GAPP" >/dev/null 2>&1 || true; clean_pm2 save >/dev/null; echo "admission stopped (files kept in $GA)" ;;

eoc-logins-drop)
  [ "${CONFIRM:-}" = "DROP-EOC-GRANT-LOGINS" ] || { echo "set CONFIRM=DROP-EOC-GRANT-LOGINS"; exit 1; }
  listening $GPORT && { echo "stop the admission service first ($0 admission-stop)"; exit 1; }
  qe -c "DROP ROLE IF EXISTS eoc_grant_attest_stg" -c "DROP ROLE IF EXISTS eoc_grant_admin_stg" >/dev/null
  shred -u "$GA/admission.env" 2>/dev/null || rm -f "$GA/admission.env"; echo "EOC grant logins dropped, admission env shredded" ;;

db-uninstall)
  [ "${CONFIRM:-}" = "UNINSTALL-630" ] || { echo "set CONFIRM=UNINSTALL-630"; exit 1; }
  q -f $D/grants/630_rollback.sql && echo "630 UNINSTALLED" ;;

*) sed -n '2,27p' "$0"; exit 2 ;;
esac
