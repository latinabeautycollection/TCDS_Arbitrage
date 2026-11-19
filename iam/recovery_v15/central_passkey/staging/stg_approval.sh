#!/usr/bin/env bash
# STAGING ONLY (IAM DB kqcdqtazcqaawdkmcfed, ~/stg_login). Binding approval with the central laptop passkey (TCDS 628),
# on top of 626 (installed) and 624/625 (install first: /tmp/recov15/v13iam/stg_v13_iam.sh install).
#   preflight        read only: package hashes, 624 installed / 628 not, deployed files are the versions this replaces,
#                    both candidates compile (temp copies)
#   db-rehearse      ONE transaction: catalog A -> 628 -> 629 tests -> 628 rollback -> catalog B (= A) -> ROLLBACK
#   db-install       CONFIRM=INSTALL-628              db-test   629 in a rolled-back transaction
#   verifier-update  CONFIRM=UPDATE-CENTRAL-VERIFIER: 6.1C centralService.ts + centralRoutes.ts (approval routes), restart
#   api-update       CONFIRM=UPDATE-CENTRAL-API: 6.1B centralEnrollment.ts (+ /approve/ page) + centralVerifierClient.ts, restart
#   nginx-approve    CONFIRM=ROUTE-APPROVE: add /approve/ -> 8198 to the login-stg vhost (sudo), nginx -t gate, reload, probe
#   approvers        CONFIRM=ASSIGN-APPROVERS: EOC_IDENTITY_BINDING_APPROVER to the two staging approver accounts,
#                    company-wide (no facility/station), 60 days, assigned by the staging identity admin
#   request          CONFIRM=REQUEST-BINDING bash $0 request <username> "<purpose>": a binding request (72 h); the subject is
#                    computed here from login-v2-api's subject key (never printed); prints the approval link
#   status           read only: requests, approvals, bindings for the pilot accounts
#   page-update      CONFIRM=UPDATE-APPROVAL-PAGE: approval page v2 only (guided second approval, live status, copy link);
#                    replaces centralEnrollment.ts deployed by api-update; revert with CONFIRM=REVERT-APPROVAL $0 revert-page
#   revert-verifier / revert-api / revert-page (CONFIRM=REVERT-APPROVAL), db-uninstall (CONFIRM=UNINSTALL-628; refuses if approvals exist)
# Copy: scp -r central_passkey apifydev@139.177.200.80:/tmp/     (run from /srv/arb-system/api)
set -euo pipefail
D=/tmp/central_passkey
S=$HOME/stg_login; CFG=$S/config.json; C61=$S/6.1C; B61=$S/6.1B
VAPP=login-v2-verifier-staging; AAPP=login-v2-api-staging
RP=login-stg.tcdsolutionsgroup.com; ENROLL_PORT=8198
VHOST=/etc/nginx/sites-available/$RP
cd /srv/arb-system/api
eval "$(grep -E '^(PGHOST|PGPORT|PGDATABASE|PGUSER|PGPASSWORD|PGSSLMODE)=' .env | sed -E "s/^([A-Z_]+)=(.*)$/export \1='\2'/")"
export PGHOST=db.kqcdqtazcqaawdkmcfed.supabase.co PGPORT=5432 PGDATABASE=postgres PGUSER=postgres PAGER=cat
grep -q kqcdqtazcqaawdkmcfed "$CFG" || { echo "$CFG is not the staging config - stopping"; exit 1; }
umask 077
q() { psql -X -At -v ON_ERROR_STOP=1 "$@"; }
clean_pm2() { env -i HOME="$HOME" PATH="$PATH" USER="$USER" LANG=C.UTF-8 pm2 "$@"; }
strip() { grep -vxE 'BEGIN;|COMMIT;' "$1"; }
listening() { ss -ltn | grep -q "127.0.0.1:$1 "; }
wait_port() { for i in $(seq 1 20); do listening "$1" && return 0; sleep 1; done; return 1; }
installed628() { [ "$(q -c "SELECT to_regclass('warehouse_identity.central_binding_requests') IS NOT NULL")" = t ]; }
copy_tree() { ( cd "$1" && tar --exclude=./node_modules --exclude=./dist.candidate -cf - . ) | ( cd "$2" && tar -xf - ); ln -s "$1/node_modules" "$2/node_modules"; }
build_tree() { ( cd "$1" && ./node_modules/.bin/tsc -p tsconfig.json --noEmit && ./node_modules/.bin/tsc -p tsconfig.json --outDir dist.candidate ); }
sha() { sha256sum "$1" | cut -d' ' -f1; }

( cd "$D" && sha256sum -c --quiet - ) <<'SUMS' || { echo "package files differ from the reviewed copies - stopping"; exit 1; }
918f1bce4c3ef31c4974bf0310a40660153f243c9a8e86e2f11e33e3229d5ea4  626_catalog_snapshot.sql
e0969204a99ab64a73044fafa875b93eb8425cb7ecf7d9511b181ff5ec82a0f3  approval/628_central_binding_approval.sql
545a64c5c656237decdadc1c8e98d0e8a8405c158ce9c6ff69a7f39c9d8559f0  approval/628_rollback.sql
bb82174a45a4cd62477dfdeb744a8e146977515394da8bd3c01df8d03140b965  approval/629_central_binding_approval_tests.sql
646b9d28f92160853b40ec5fa5561fcc4438257a8b777feff430be58adbdd8dc  verifier_6.1C/src/central/centralService.ts
2d220f00e8f1f7d84c689ea347f58face8479c45ac2ed6a273c89b92db47e002  verifier_6.1C/src/central/centralRoutes.ts
3d6e27278c2bd243ceff063a194d3d8771570ecb8bbae480c5cc2e7c883618aa  loginv2_6.1B/centralEnrollment.ts
4d0e7159d2383c24e1484f12fb42f59eac0c66edb8e85d8777092ff96154470e  loginv2_6.1B/centralVerifierClient.ts
SUMS

# Deployed versions this replaces (first central deployment 2026-11-19; enrollment page v3).
V_SERVICE_OLD=e1c5e62fdfe575231e904579c7d1628dfb2950399e4d0a0ec5d510a276947d9b
V_ROUTES_OLD=443f049fedc5d803a46b203f11c84ed5aecf670364c5509763807899fcaaa2d6
A_ENROLL_OLD=773827e1ca30a382564ec5b2f503bd4d67b4e3a760142ec872e58cfe3f78ccb3
A_ENROLL_V4=f29d0728da2429ee1488d84aad557ad8921ab6b32d36c6af7c97dc6fcd9d0407   # page as deployed by api-update (approval page v1)
A_ENROLL_V5=932c2aa1ff1013a7b10eb7ab8f13ce059c213461a7f217acd87b1b5fa94c0369   # approval page v2 (page-update 2026-11-19 09:36Z)
A_CLIENT_NEW=faa7e6edf4a0aafc24d3f4b11d2f51d37809571df76fc258cf6c115e647e0d9d
A_CLIENT_OLD=383f0a846102454c4475a90e6dce114a4fae87772033aa5961bea6eddfdf0c56
V_SRC="src/central/centralService.ts src/central/centralRoutes.ts"
A_SRC="src/express/centralEnrollment.ts src/express/centralVerifierClient.ts"
APPROVERS="yahaira.rosario.malone.stg robert.mahoney.stg"; ADMIN=stg.identity.admin

check_deployed() {
  local ok=0
  [ "$(sha $C61/src/central/centralService.ts)" = "$V_SERVICE_OLD" ] && [ "$(sha $C61/src/central/centralRoutes.ts)" = "$V_ROUTES_OLD" ] \
    && echo "ok 6.1C central files are the first deployed versions" || { echo "6.1C central files are not the expected versions"; ok=1; }
  [ "$(sha $B61/src/express/centralEnrollment.ts)" = "$A_ENROLL_OLD" ] && [ "$(sha $B61/src/express/centralVerifierClient.ts)" = "$A_CLIENT_OLD" ] \
    && echo "ok 6.1B enrollment page v3 + client v1 deployed" || { echo "6.1B central files are not the expected versions"; ok=1; }
  return $ok
}
candidate() {  # $1 = C61|B61 -> prints temp tree path with the new files, built
  local T; T=$(mktemp -d "$S/approval_cand.XXXX")
  if [ "$1" = C61 ]; then copy_tree "$C61" "$T"; cp "$D/verifier_6.1C/src/central/centralService.ts" "$D/verifier_6.1C/src/central/centralRoutes.ts" "$T/src/central/"
  else copy_tree "$B61" "$T"; cp "$D/loginv2_6.1B/centralEnrollment.ts" "$D/loginv2_6.1B/centralVerifierClient.ts" "$T/src/express/"; fi
  build_tree "$T" >/dev/null || { (cd "$T" && ./node_modules/.bin/tsc -p tsconfig.json --noEmit | head -20) >&2; rm -rf "$T"; return 1; }
  echo "$T"
}

case "${1:-}" in
preflight)
  check_deployed || { echo "STOP"; exit 1; }
  for t in C61 B61; do T=$(candidate $t) && { echo "ok $t candidate compiles"; rm -rf "$T"; } || { echo "STOP $t candidate does not compile"; exit 1; }; done
  q -c "SELECT '624 installed=' || (to_regclass('warehouse_identity.eoc_binding_approvals_v13') IS NOT NULL) || ', 626 installed=' || (to_regclass('warehouse_identity.central_passkeys') IS NOT NULL) || ', 628 installed=' || (to_regclass('warehouse_identity.central_binding_requests') IS NOT NULL) || ', approver role=' || EXISTS (SELECT 1 FROM warehouse_identity.roles WHERE role_code='EOC_IDENTITY_BINDING_APPROVER')"
  grep -q "location ^~ /approve/" "$VHOST" 2>/dev/null && echo "nginx: /approve/ already routed" || echo "nginx: /approve/ not routed yet (nginx-approve adds it)"
  echo "PREFLIGHT DONE" ;;

db-rehearse)
  installed628 && { echo "628 already installed"; exit 1; }
  { echo "BEGIN;"; echo "\\set snap A"; cat $D/626_catalog_snapshot.sql; strip $D/approval/628_central_binding_approval.sql; cat $D/approval/629_central_binding_approval_tests.sql
    echo "SET LOCAL tcds.r628_delete_central_approvals = 'yes';"; strip $D/approval/628_rollback.sql; echo "\\set snap B"; cat $D/626_catalog_snapshot.sql
    echo "SELECT 'catalog A vs B differences after rollback: ' || count(*) FROM ((SELECT item FROM _snap WHERE name='A' EXCEPT SELECT item FROM _snap WHERE name='B') UNION ALL (SELECT item FROM _snap WHERE name='B' EXCEPT SELECT item FROM _snap WHERE name='A')) d;"
    echo "SELECT 'diff: ' || item FROM ((SELECT 'A-only ' || item AS item FROM (SELECT item FROM _snap WHERE name='A' EXCEPT SELECT item FROM _snap WHERE name='B') x) UNION ALL (SELECT 'B-only ' || item FROM (SELECT item FROM _snap WHERE name='B' EXCEPT SELECT item FROM _snap WHERE name='A') y)) z LIMIT 20;"
    echo "ROLLBACK;"; } | q 2>&1 | grep -vE '^(NOTICE|PASS)'
  echo "rehearse finished (ROLLBACK)" ;;

db-install)
  [ "${CONFIRM:-}" = "INSTALL-628" ] || { echo "set CONFIRM=INSTALL-628"; exit 1; }
  installed628 && { echo "628 already installed"; exit 1; }
  q -f $D/approval/628_central_binding_approval.sql >/dev/null && echo "628 INSTALLED" ;;

db-test)
  installed628 || { echo "628 not installed"; exit 1; }
  { echo "BEGIN;"; cat $D/approval/629_central_binding_approval_tests.sql; echo "ROLLBACK;"; } | q 2>&1 | grep -vE '^NOTICE' | grep -E 'FAIL|SUMMARY|ERROR' ;;

verifier-update)
  [ "${CONFIRM:-}" = "UPDATE-CENTRAL-VERIFIER" ] || { echo "set CONFIRM=UPDATE-CENTRAL-VERIFIER"; exit 1; }
  installed628 || { echo "install 628 first"; exit 1; }
  [ "$(sha $C61/src/central/centralService.ts)" = "$V_SERVICE_OLD" ] || { echo "6.1C centralService.ts is not the first version - stopping"; exit 1; }
  echo "building the 6.1C candidate (temp copy)..."; T=$(candidate C61)
  BK=$S/approval_verifier_backup-$(date -u +%Y%m%dT%H%M%SZ); mkdir -p "$BK/src" "$BK/dist"
  for f in centralService centralRoutes; do cp -p "$C61/src/central/$f.ts" "$BK/src/"; cp -p "$C61/dist/central/$f.js" "$BK/dist/"; cp "$T/src/central/$f.ts" "$C61/src/central/"; cp "$T/dist.candidate/central/$f.js" "$C61/dist/central/"; done
  rm -rf "$T"; echo "$BK" > "$S/.approval_verifier_backup"
  clean_pm2 restart "$VAPP" >/dev/null; wait_port 8191 || { echo "!! verifier not listening - revert with CONFIRM=REVERT-APPROVAL $0 revert-verifier"; exit 1; }
  sleep 1; curl -s http://127.0.0.1:8191/ready/central; echo; curl -s -o /dev/null -w "warehouse ready (unchanged): %{http_code}\n" http://127.0.0.1:8191/ready
  echo "VERIFIER UPDATED (backup $BK)" ;;

api-update)
  [ "${CONFIRM:-}" = "UPDATE-CENTRAL-API" ] || { echo "set CONFIRM=UPDATE-CENTRAL-API"; exit 1; }
  [ "$(sha $B61/src/express/centralEnrollment.ts)" = "$A_ENROLL_OLD" ] || { echo "6.1B centralEnrollment.ts is not v3 - stopping"; exit 1; }
  echo "building the 6.1B candidate (temp copy)..."; T=$(candidate B61)
  BK=$S/approval_api_backup-$(date -u +%Y%m%dT%H%M%SZ); mkdir -p "$BK/src" "$BK/dist"
  for f in centralEnrollment centralVerifierClient; do cp -p "$B61/src/express/$f.ts" "$BK/src/"; cp -p "$B61/dist/express/$f.js" "$BK/dist/"; cp "$T/src/express/$f.ts" "$B61/src/express/"; cp "$T/dist.candidate/express/$f.js" "$B61/dist/express/"; chmod 644 "$B61/dist/express/$f.js"; done
  rm -rf "$T"; echo "$BK" > "$S/.approval_api_backup"
  clean_pm2 restart "$AAPP" >/dev/null; wait_port 8196 && wait_port $ENROLL_PORT || { echo "!! API listeners not up - revert with CONFIRM=REVERT-APPROVAL $0 revert-api"; exit 1; }
  curl -s -o /dev/null -w "enrollment page: %{http_code}\n" http://127.0.0.1:$ENROLL_PORT/enroll/
  curl -s -o /dev/null -w "approval page: %{http_code}\n" "http://127.0.0.1:$ENROLL_PORT/approve/?r=00000000-0000-4000-8000-000000000000"
  curl -s -o /dev/null -w "sign-in API (unchanged): %{http_code}\n" http://127.0.0.1:8195/api/v1/auth/session
  echo "API UPDATED (backup $BK)" ;;

page-update)
  [ "${CONFIRM:-}" = "UPDATE-APPROVAL-PAGE" ] || { echo "set CONFIRM=UPDATE-APPROVAL-PAGE"; exit 1; }
  case "$(sha $B61/src/express/centralEnrollment.ts)" in "$A_ENROLL_V4"|"$A_ENROLL_V5") ;; *) echo "6.1B centralEnrollment.ts is not a known earlier page version - stopping"; exit 1;; esac
  [ "$(sha $B61/src/express/centralVerifierClient.ts)" = "$A_CLIENT_NEW" ] || { echo "6.1B centralVerifierClient.ts is not the api-update version - stopping"; exit 1; }
  echo "building the 6.1B candidate (temp copy)..."; T=$(candidate B61)
  cmp -s "$T/src/express/centralVerifierClient.ts" "$B61/src/express/centralVerifierClient.ts" || { echo "client would change - stopping"; rm -rf "$T"; exit 1; }
  BK=$S/approval_page_backup-$(date -u +%Y%m%dT%H%M%SZ); mkdir -p "$BK/src" "$BK/dist"
  cp -p "$B61/src/express/centralEnrollment.ts" "$BK/src/"; cp -p "$B61/dist/express/centralEnrollment.js" "$BK/dist/"
  cp "$T/src/express/centralEnrollment.ts" "$B61/src/express/"; cp "$T/dist.candidate/express/centralEnrollment.js" "$B61/dist/express/"; chmod 644 "$B61/dist/express/centralEnrollment.js"
  rm -rf "$T"; [ -s "$S/.approval_page_backup" ] || echo "$BK" > "$S/.approval_page_backup"   # revert-page goes back to approval page v1
  clean_pm2 restart "$AAPP" >/dev/null; wait_port 8196 && wait_port $ENROLL_PORT || { echo "!! API listeners not up - revert with CONFIRM=REVERT-APPROVAL $0 revert-page"; exit 1; }
  curl -s -o /dev/null -w "enrollment page: %{http_code}\n" http://127.0.0.1:$ENROLL_PORT/enroll/
  curl -s -o /dev/null -w "approval page: %{http_code}\n" "http://127.0.0.1:$ENROLL_PORT/approve/?r=00000000-0000-4000-8000-000000000000"
  curl -s http://127.0.0.1:$ENROLL_PORT/approve/assets/approve.js | grep -q "Approve as the second approver" && echo "approval page v2 served" || echo "!! approval page v2 NOT served"
  curl -s -o /dev/null -w "sign-in API (unchanged): %{http_code}\n" http://127.0.0.1:8195/api/v1/auth/session
  echo "APPROVAL PAGE UPDATED (backup $BK)" ;;

revert-page)
  [ "${CONFIRM:-}" = "REVERT-APPROVAL" ] || { echo "set CONFIRM=REVERT-APPROVAL"; exit 1; }
  BK=$(cat "$S/.approval_page_backup"); cp -p "$BK/src/centralEnrollment.ts" "$B61/src/express/"; cp -p "$BK/dist/centralEnrollment.js" "$B61/dist/express/"
  clean_pm2 restart "$AAPP" >/dev/null; wait_port 8196 && wait_port $ENROLL_PORT && echo "approval page reverted to v1" ;;

nginx-approve)
  [ "${CONFIRM:-}" = "ROUTE-APPROVE" ] || { echo "set CONFIRM=ROUTE-APPROVE"; exit 1; }
  sudo grep -q "location ^~ /approve/" "$VHOST" && { echo "/approve/ already routed"; exit 0; }
  sudo cp -p "$VHOST" "$VHOST.bak-$(date -u +%Y%m%dT%H%M%SZ)"
  sudo python3 - "$VHOST" <<'PY'
import sys,pathlib
p=pathlib.Path(sys.argv[1]); s=p.read_text()
a=" location ^~ /enroll/ {"
assert s.count(a)==1, "enroll location not found exactly once"
block=""" location ^~ /approve/ {
   limit_req zone=tcds_oidc_auth burst=15 nodelay;
   proxy_set_header Host $host;
   proxy_set_header X-Forwarded-Proto https;
   proxy_set_header X-Real-IP $remote_addr;
   proxy_set_header X-Forwarded-For $remote_addr;
   proxy_pass http://127.0.0.1:8198;
   proxy_read_timeout 15s;
 }
"""
p.write_text(s.replace(a, block + a))
PY
  if ! sudo nginx -t 2>&1 | tail -1 | grep -q successful; then echo "nginx -t FAILED - restoring"; sudo cp -p "$(ls -t $VHOST.bak-* | head -1)" "$VHOST"; exit 1; fi
  sudo systemctl reload nginx; sleep 2
  for u in "https://$RP/approve/?r=00000000-0000-4000-8000-000000000000" "https://$RP/enroll/" "https://$RP/.well-known/openid-configuration"; do
    echo "$(curl -s -o /dev/null -w '%{http_code}' "$u") $u"; done
  echo "$(curl -s -o /dev/null -w '%{http_code}' "https://$RP/internal/x") https://$RP/internal/x (want 404)"
  echo "APPROVE ROUTED" ;;

approvers)
  [ "${CONFIRM:-}" = "ASSIGN-APPROVERS" ] || { echo "set CONFIRM=ASSIGN-APPROVERS"; exit 1; }
  q <<SQL
BEGIN;
INSERT INTO warehouse_identity.user_role_assignments (user_id, role_id, valid_until, assigned_by)
SELECT u.user_id, r.role_id, clock_timestamp() + interval '60 days', (SELECT user_id FROM warehouse_identity.users WHERE username = '$ADMIN')
  FROM warehouse_identity.users u, warehouse_identity.roles r
 WHERE u.username IN ($(printf "'%s'," $APPROVERS | sed 's/,$//')) AND u.status = 'ACTIVE' AND r.role_code = 'EOC_IDENTITY_BINDING_APPROVER'
   AND NOT EXISTS (SELECT 1 FROM warehouse_identity.user_role_assignments x WHERE x.user_id = u.user_id AND x.role_id = r.role_id AND x.revoked_at IS NULL);
SELECT 'approver role: ' || u.username || ' company-wide until ' || to_char(ra.valid_until, 'YYYY-MM-DD')
  FROM warehouse_identity.user_role_assignments ra JOIN warehouse_identity.users u USING (user_id) JOIN warehouse_identity.roles r USING (role_id)
 WHERE r.role_code = 'EOC_IDENTITY_BINDING_APPROVER' AND ra.revoked_at IS NULL ORDER BY u.username;
COMMIT;
SQL
  ;;

request)
  [ "${CONFIRM:-}" = "REQUEST-BINDING" ] || { echo "set CONFIRM=REQUEST-BINDING"; exit 1; }
  installed628 || { echo "628 not installed"; exit 1; }
  U="${2:-}"; P="${3:-}"
  [[ "$U" =~ ^[a-z0-9.]+\.stg$ ]] && [ ${#P} -ge 3 ] || { echo "usage: CONFIRM=REQUEST-BINDING $0 request <pilot username> \"<purpose>\""; exit 1; }
  UID_=$(q -c "SELECT user_id FROM warehouse_identity.users WHERE username = '$U' AND status = 'ACTIVE'")
  [ -n "$UID_" ] || { echo "no active user $U"; exit 1; }
  # subject = base64url(HMAC-SHA256(subject key, issuer + "\n" + user id)), exactly as login-v2-api computes it; only its sha256 hex leaves node
  SH=$(USERID="$UID_" node -e 'const c=require(process.argv[1]).api,cr=require("crypto");const iss=c.CENTRAL_OIDC_ISSUER.replace(/\/$/,"");
    const sub=cr.createHmac("sha256",c.CENTRAL_SUBJECT_KEY).update(`${iss}\n${process.env.USERID}`,"utf8").digest("base64url");
    process.stdout.write(iss+" "+cr.createHash("sha256").update(sub).digest("hex"))' "$CFG")
  ISS=${SH%% *}; HASH=${SH##* }
  q -v purpose="$P" <<SQL >/dev/null
BEGIN;
GRANT tcds_identity_central_admin TO current_user WITH INHERIT TRUE;
SELECT warehouse_identity.central_request_binding_v1('$UID_', '$ISS', '$HASH', :'purpose',
  (SELECT user_id FROM warehouse_identity.users WHERE username = '$ADMIN'), 72);
REVOKE tcds_identity_central_admin FROM current_user;
COMMIT;
SQL
  RID=$(q -c "SELECT central_binding_request_id FROM warehouse_identity.central_binding_requests WHERE target_user_id = '$UID_' AND status = 'OPEN'")
  echo "Binding request for $U: \"$P\" (open 72 hours; two different approvers, each with their own passkey)"
  echo
  echo "  https://$RP/approve/?r=$RID"
  echo
  echo "This link is not a secret: approving needs an approver's passkey. Open it once as each approver." ;;

status)
  q <<SQL
SELECT 'request ' || rpad(u.username, 28) || rpad(r.status, 10) || ' approvals=' ||
       (SELECT count(*) FROM warehouse_identity.eoc_binding_approvals_v13 a WHERE a.request_id = r.central_binding_request_id) ||
       ' "' || r.purpose || '"  https://$RP/approve/?r=' || r.central_binding_request_id
  FROM warehouse_identity.central_binding_requests r JOIN warehouse_identity.users u ON u.user_id = r.target_user_id ORDER BY r.created_at;
SELECT 'binding ' || rpad(u.username, 28) || b.binding_status || ' approved by ' || a1.username || ' + ' || a2.username
  FROM warehouse_identity.eoc_federated_subject_bindings_v12 b JOIN warehouse_identity.users u ON u.user_id = b.user_id
  LEFT JOIN warehouse_identity.users a1 ON a1.user_id = b.approved_by LEFT JOIN warehouse_identity.users a2 ON a2.user_id = b.secondary_approved_by
 WHERE u.username LIKE '%.stg' ORDER BY b.created_at;
SELECT 'approver ' || u.username || ' until ' || to_char(ra.valid_until, 'YYYY-MM-DD')
  FROM warehouse_identity.user_role_assignments ra JOIN warehouse_identity.users u USING (user_id) JOIN warehouse_identity.roles r USING (role_id)
 WHERE r.role_code = 'EOC_IDENTITY_BINDING_APPROVER' AND ra.revoked_at IS NULL;
SQL
  ;;

revert-verifier)
  [ "${CONFIRM:-}" = "REVERT-APPROVAL" ] || { echo "set CONFIRM=REVERT-APPROVAL"; exit 1; }
  BK=$(cat "$S/.approval_verifier_backup"); for f in centralService centralRoutes; do cp -p "$BK/src/$f.ts" "$C61/src/central/"; cp -p "$BK/dist/$f.js" "$C61/dist/central/"; done
  clean_pm2 restart "$VAPP" >/dev/null; wait_port 8191 && echo "verifier reverted to $BK" ;;

revert-api)
  [ "${CONFIRM:-}" = "REVERT-APPROVAL" ] || { echo "set CONFIRM=REVERT-APPROVAL"; exit 1; }
  BK=$(cat "$S/.approval_api_backup"); for f in centralEnrollment centralVerifierClient; do cp -p "$BK/src/$f.ts" "$B61/src/express/"; cp -p "$BK/dist/$f.js" "$B61/dist/express/"; done
  clean_pm2 restart "$AAPP" >/dev/null; wait_port 8196 && echo "API reverted to $BK" ;;

db-uninstall)
  [ "${CONFIRM:-}" = "UNINSTALL-628" ] || { echo "set CONFIRM=UNINSTALL-628"; exit 1; }
  q -f $D/approval/628_rollback.sql >/dev/null && echo "628 UNINSTALLED" ;;

*) sed -n '2,20p' "$0"; exit 2 ;;
esac
