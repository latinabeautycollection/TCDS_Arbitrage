#!/usr/bin/env bash
# PRODUCTION recovery-email approver (Anthony): account, central passkey invite (login.tcdsolutionsgroup.com), approver
# role (TCDS 645), and a test email to confirm the notice address before it is saved.
#   status                                                   read-only: active users + roles, approver passkeys/invites
#   create   CONFIRM=CREATE-APPROVER-ACCOUNT [APPROVER=anthony.malone] [NAME="Anthony Malone"]   only if it does not exist
#   invite   CONFIRM=ISSUE-INVITE ADMIN=<issuing admin username> [APPROVER=...]   single-use 72 h passkey invite; prints
#            the link: send it to Anthony yourself; it must be opened on HIS laptop; never paste it into chat
#   assign   CONFIRM=ASSIGN-APPROVER ADMIN=<assigning admin username> [APPROVER=...] [DAYS=90]   global role assignment
#   revoke   CONFIRM=REVOKE-APPROVER ADMIN=<username> [APPROVER=...]
#   test-email CONFIRM=SEND-TEST-EMAIL TO=<address>          one plain email from the configured sender (needs prepare)
# Prints no secrets.
set -euo pipefail
P=/srv/arb-system/loginv2_runtime; CFG=$P/config.json; RP=login.tcdsolutionsgroup.com
cd /srv/arb-system/api
eval "$(grep -E '^(PGHOST|PGPORT|PGDATABASE|PGUSER|PGPASSWORD|PGSSLMODE)=' .env | sed -E "s/^([A-Z_]+)=(.*)$/export \1='\2'/")"
case "$PGHOST $PGUSER" in *vfxlrkqgakqqbnbbgecp*) ;; *) echo ".env database is not production - stopping"; exit 1;; esac
WHO=${APPROVER:-anthony.malone}; NAME=${NAME:-Anthony Malone}; ADM=${ADMIN:-}; DAYS=${DAYS:-90}
[[ "$WHO" =~ ^[a-z0-9._-]{3,80}$ && "$DAYS" =~ ^[0-9]{1,3}$ && "$NAME" =~ ^[A-Za-z\ .\'-]{2,80}$ ]] || { echo "bad APPROVER / NAME / DAYS"; exit 1; }
[ -z "$ADM" ] || [[ "$ADM" =~ ^[a-z0-9._@-]{3,80}$ ]] || { echo "bad ADMIN"; exit 1; }
q() { PAGER=cat psql -X -q -At -F ' | ' -v ON_ERROR_STOP=1 -v who="$WHO" -v name="$NAME" -v adm="$ADM" -v days="$DAYS" "$@"; }
need() { [ "${CONFIRM:-}" = "$1" ] || { echo "set CONFIRM=$1"; exit 1; }; }
need_admin() { [ -n "$ADM" ] || { echo "set ADMIN=<username of the active admin who issues/assigns> (see status)"; exit 1; }
  [ "$(q <<< "SELECT count(*) FROM warehouse_identity.users WHERE normalized_username=lower(:'adm') AND status='ACTIVE';")" = 1 ] || { echo "ADMIN $ADM is not an active user"; exit 1; }
  [ "$ADM" != "$WHO" ] || { echo "ADMIN must be a different person"; exit 1; }; }

case "${1:-}" in
status) q <<'SQL'
\pset footer off
SELECT 'user: '||u.username||' | '||u.display_name||' | '||u.status||' | roles: '||coalesce((SELECT string_agg(r.role_code,', ' ORDER BY r.role_code)
   FROM warehouse_identity.user_role_assignments ra JOIN warehouse_identity.roles r USING (role_id)
   WHERE ra.user_id=u.user_id AND ra.revoked_at IS NULL AND (ra.valid_until IS NULL OR ra.valid_until>now())),'-')
 FROM warehouse_identity.users u WHERE u.status='ACTIVE' ORDER BY u.username;
SELECT 'approver account '||:'who'||': '||coalesce((SELECT status FROM warehouse_identity.users WHERE normalized_username=lower(:'who')),'does not exist yet');
SELECT 'central passkeys ('||p.rp_id||'): '||count(*) FILTER (WHERE p.security_state='ACTIVE')||' active' FROM warehouse_identity.central_passkeys p
 JOIN warehouse_identity.users u USING (user_id) WHERE u.normalized_username=lower(:'who') GROUP BY p.rp_id;
SELECT 'open invites: '||count(*) FROM warehouse_identity.central_enrollment_invites i JOIN warehouse_identity.users u USING (user_id)
 WHERE u.normalized_username=lower(:'who') AND i.consumed_at IS NULL AND i.revoked_at IS NULL AND i.expires_at>clock_timestamp();
SELECT 'recovery-email approvers now: '||coalesce(string_agg(u.username||' (until '||coalesce(ra.valid_until::date::text,'open')||')',', '),'nobody')
 FROM warehouse_identity.user_role_assignments ra JOIN warehouse_identity.users u USING (user_id)
 WHERE ra.role_id=(SELECT role_id FROM warehouse_identity.roles WHERE role_code='IAM_RECOVERY_DESTINATION_APPROVER') AND ra.revoked_at IS NULL
   AND (ra.valid_until IS NULL OR ra.valid_until>now());
SQL
  echo "page listener :8098 $( (exec 3<>/dev/tcp/127.0.0.1/8098) 2>/dev/null && echo up || echo 'down (login API not deployed yet)')"
  node -e 'const a=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).api;console.log("notice addresses configured: "+((a.RECOVERY_APPROVER_EMAILS||"").split(",").filter(Boolean).length))' "$CFG" ;;

create)
  need CREATE-APPROVER-ACCOUNT
  q <<'SQL'
BEGIN;
INSERT INTO warehouse_identity.users (username, display_name, status)
SELECT :'who', :'name', 'ACTIVE' WHERE NOT EXISTS (SELECT 1 FROM warehouse_identity.users WHERE normalized_username=lower(:'who'));
SELECT 'account: '||username||' | '||display_name||' | '||status FROM warehouse_identity.users WHERE normalized_username=lower(:'who');
COMMIT;
SQL
  echo "(an account row only: no password, no warehouse device, no roles - it can approve once it has a passkey + the role)" ;;

invite)
  need ISSUE-INVITE; need_admin
  (exec 3<>/dev/tcp/127.0.0.1/8098) 2>/dev/null || { echo "the enrollment page (:8098) is not running - deploy the login API first"; exit 1; }
  TOKEN=$(node -e 'process.stdout.write(require("crypto").randomBytes(32).toString("base64url"))')
  HASH=$(TOKEN="$TOKEN" node -e 'process.stdout.write(require("crypto").createHash("sha256").update(process.env.TOKEN).digest("hex"))')
  q -v hash="$HASH" -v rp="$RP" >/dev/null <<'SQL'
BEGIN;
GRANT tcds_identity_central_admin TO current_user WITH INHERIT TRUE;
SELECT warehouse_identity.central_issue_invite_v1(
  (SELECT user_id FROM warehouse_identity.users WHERE normalized_username=lower(:'who') AND status='ACTIVE'),
  (SELECT user_id FROM warehouse_identity.users WHERE normalized_username=lower(:'adm') AND status='ACTIVE'),
  decode(:'hash','hex'), :'rp', 4320, 'Recovery-email approver passkey enrollment', gen_random_uuid());
REVOKE tcds_identity_central_admin FROM current_user;
COMMIT;
SQL
  echo "Invite for $WHO (single use, expires in 72 hours; a new invite cancels the previous one):"
  echo; echo "  https://$RP/enroll/#$TOKEN"; echo
  echo "Send it to Anthony yourself. He must open it on HIS OWN laptop (the passkey is created there). Do not paste it into chat."
  unset TOKEN HASH ;;

assign)
  need ASSIGN-APPROVER; need_admin
  q <<'SQL'
BEGIN;
SELECT set_config('tcds.who', :'who', true), set_config('tcds.by', :'adm', true), set_config('tcds.days', :'days', true) \gset x_
DO $a$ DECLARE v_user uuid; v_by uuid; v_role uuid;
BEGIN
 SELECT user_id INTO v_user FROM warehouse_identity.users WHERE normalized_username=lower(current_setting('tcds.who')) AND status='ACTIVE';
 SELECT user_id INTO v_by FROM warehouse_identity.users WHERE normalized_username=lower(current_setting('tcds.by')) AND status='ACTIVE';
 SELECT role_id INTO v_role FROM warehouse_identity.roles WHERE role_code='IAM_RECOVERY_DESTINATION_APPROVER';
 IF v_user IS NULL OR v_by IS NULL OR v_role IS NULL THEN RAISE EXCEPTION 'APPROVER, ADMIN or the 645 role not found (or not ACTIVE)'; END IF;
 IF NOT EXISTS (SELECT 1 FROM warehouse_identity.central_passkeys WHERE user_id=v_user AND security_state='ACTIVE' AND rp_id='login.tcdsolutionsgroup.com')
   THEN RAISE EXCEPTION 'the approver has no active passkey on login.tcdsolutionsgroup.com yet - send the invite first'; END IF;
 IF EXISTS (SELECT 1 FROM warehouse_identity.user_role_assignments WHERE user_id=v_user AND role_id=v_role AND revoked_at IS NULL
   AND (valid_until IS NULL OR valid_until>clock_timestamp())) THEN RAISE NOTICE 'already an approver - nothing changed'; RETURN; END IF;
 INSERT INTO warehouse_identity.user_role_assignments (user_id, role_id, valid_until, assigned_by)
 VALUES (v_user, v_role, clock_timestamp() + make_interval(days => current_setting('tcds.days')::int), v_by);
 RAISE NOTICE 'assigned: % is a recovery-email approver for % days (company-wide)', current_setting('tcds.who'), current_setting('tcds.days');
END $a$;
COMMIT;
SQL
  ;;

revoke)
  need REVOKE-APPROVER; need_admin
  q <<'SQL'
BEGIN;
UPDATE warehouse_identity.user_role_assignments ra SET revoked_at=clock_timestamp(),
  revoked_by=(SELECT user_id FROM warehouse_identity.users WHERE normalized_username=lower(:'adm'))
 WHERE ra.user_id=(SELECT user_id FROM warehouse_identity.users WHERE normalized_username=lower(:'who')) AND ra.revoked_at IS NULL
   AND ra.role_id=(SELECT role_id FROM warehouse_identity.roles WHERE role_code='IAM_RECOVERY_DESTINATION_APPROVER');
COMMIT;
\echo approver role revoked (if it was assigned)
SQL
  ;;

test-email)
  need SEND-TEST-EMAIL
  [[ "${TO:-}" =~ ^[^@\ ]+@[^@\ ]+\.[^@\ ]+$ ]] || { echo "set TO=<address>"; exit 1; }
  CFGF=$P/config.json; [ -n "$(node -e 'const a=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).api;process.stdout.write(a.M365_SENDER||"")' "$CFGF")" ] \
    || CFGF=$HOME/prod_login_state/config.candidate.json
  [ -f "$CFGF" ] || { echo "no Graph settings yet - run prod_login_deploy.sh prepare first"; exit 1; }
  TO="$TO" node - "$CFGF" <<'JS'
const a=JSON.parse(require('fs').readFileSync(process.argv[2],'utf8')).api, to=process.env.TO;
(async()=>{
  const t=await fetch(`https://login.microsoftonline.com/${a.M365_TENANT_ID}/oauth2/v2.0/token`,{method:'POST',
    headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:a.M365_CLIENT_ID,
    client_secret:a.M365_CLIENT_SECRET,scope:'https://graph.microsoft.com/.default',grant_type:'client_credentials'})});
  if(!t.ok){console.log('token request failed: HTTP '+t.status);process.exit(1);}
  const tok=(await t.json()).access_token;
  const body={message:{subject:'TCDS Warehouse: approval notices test',body:{contentType:'Text',content:
    'This is a one-time test from the TCDS Warehouse login service.\n\nIf you received it, recovery-email approval requests will be sent to this address. Nothing needs to be done.'},
    toRecipients:[{emailAddress:{address:to}}]},saveToSentItems:false};
  const r=await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(a.M365_SENDER)}/sendMail`,{method:'POST',
    headers:{authorization:'Bearer '+tok,'content-type':'application/json'},body:JSON.stringify(body)});
  console.log(r.status===202?`sent (202) from ${a.M365_SENDER} to ${to} - ask the recipient to confirm it arrived`:`send failed: HTTP ${r.status}`);
  process.exit(r.status===202?0:1);
})().catch(e=>{console.log('send failed: '+e.message);process.exit(1)});
JS
  ;;
*) sed -n '2,11p' "$0"; exit 2 ;;
esac
