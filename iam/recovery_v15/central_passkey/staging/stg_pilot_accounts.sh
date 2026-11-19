#!/usr/bin/env bash
# STAGING ONLY (IAM DB kqcdqtazcqaawdkmcfed). The EOC leadership pilot accounts, created by us on staging (Anthony,
# 2026-11-18: "do everything ourselves on staging; production is done properly"). Display names are marked STAGING.
#   plan     read only: which pilot accounts exist, their passkeys and open invites
#   create   CONFIRM=CREATE-PILOT-ACCOUNTS: the 4 pilot accounts + one staging identity-admin account that issues invites
#   invite   CONFIRM=ISSUE-INVITE bash $0 invite <username>: a single-use, 72-hour enrollment invite; prints the link.
#            The link IS the invite: open it only on the device that should hold the passkey; it works once.
#   status   read only: passkeys per pilot account
set -euo pipefail
cd /srv/arb-system/api
eval "$(grep -E '^(PGHOST|PGPORT|PGDATABASE|PGUSER|PGPASSWORD|PGSSLMODE)=' .env | sed -E "s/^([A-Z_]+)=(.*)$/export \1='\2'/")"
export PGHOST=db.kqcdqtazcqaawdkmcfed.supabase.co PGPORT=5432 PGDATABASE=postgres PGUSER=postgres PAGER=cat
[ "$PGHOST" = "db.kqcdqtazcqaawdkmcfed.supabase.co" ] || { echo "not the staging host - stopping"; exit 1; }
q() { psql -X -At -v ON_ERROR_STOP=1 "$@"; }
RP=login-stg.tcdsolutionsgroup.com
ADMIN=stg.identity.admin
# username | display name | role in the pilot
PILOT="anthony.malone.stg|Anthony Malone (STAGING)|CTO
korina.korva.stg|Korina Korva (STAGING)|CEO
yahaira.rosario.malone.stg|Yahaira Rosario Malone (STAGING)|VP - binding approver
robert.mahoney.stg|Robert Mahoney (STAGING)|IT Manager - binding approver"

case "${1:-}" in
plan|status)
  q <<SQL
SELECT rpad(u.username, 30) || rpad(u.status, 10) || ' passkeys(active)=' ||
       (SELECT count(*) FROM warehouse_identity.central_passkeys p WHERE p.user_id = u.user_id AND p.security_state = 'ACTIVE') ||
       ' open invites=' || (SELECT count(*) FROM warehouse_identity.central_enrollment_invites i WHERE i.user_id = u.user_id
          AND i.consumed_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > clock_timestamp()) || '  ' || u.display_name
  FROM warehouse_identity.users u
 WHERE u.username IN ('$ADMIN','anthony.malone.stg','korina.korva.stg','yahaira.rosario.malone.stg','robert.mahoney.stg')
 ORDER BY u.username;
SELECT 'pilot accounts present: ' || count(*) || ' of 5' FROM warehouse_identity.users
 WHERE username IN ('$ADMIN','anthony.malone.stg','korina.korva.stg','yahaira.rosario.malone.stg','robert.mahoney.stg');
SQL
  ;;
create)
  [ "${CONFIRM:-}" = "CREATE-PILOT-ACCOUNTS" ] || { echo "set CONFIRM=CREATE-PILOT-ACCOUNTS"; exit 1; }
  VALUES=$(printf "('%s','%s')," "$ADMIN" "Staging Identity Admin (STAGING)"; while IFS='|' read -r u n _; do printf "('%s','%s')," "$u" "$n"; done <<< "$PILOT")
  q <<SQL
BEGIN;
INSERT INTO warehouse_identity.users (username, display_name, status)
SELECT v.u, v.n, 'ACTIVE' FROM (VALUES ${VALUES%,}) v(u, n)
 WHERE NOT EXISTS (SELECT 1 FROM warehouse_identity.users x WHERE x.username = v.u);
SELECT 'created or already present: ' || username || ' (' || user_id || ')' FROM warehouse_identity.users
 WHERE username IN ('$ADMIN','anthony.malone.stg','korina.korva.stg','yahaira.rosario.malone.stg','robert.mahoney.stg') ORDER BY username;
COMMIT;
SQL
  echo "Pilot roles (not grants - nothing is granted by this step):"; while IFS='|' read -r u _ r; do echo "  $u: $r"; done <<< "$PILOT" ;;
invite)
  [ "${CONFIRM:-}" = "ISSUE-INVITE" ] || { echo "set CONFIRM=ISSUE-INVITE"; exit 1; }
  U="${2:-}"; grep -q "^$U|" <<< "$PILOT" || { echo "usage: CONFIRM=ISSUE-INVITE $0 invite <one of: $(cut -d'|' -f1 <<< "$PILOT" | tr '\n' ' ')>"; exit 1; }
  TOKEN=$(node -e 'process.stdout.write(require("crypto").randomBytes(32).toString("base64url"))')
  HASH=$(TOKEN="$TOKEN" node -e 'process.stdout.write(require("crypto").createHash("sha256").update(process.env.TOKEN).digest("hex"))')
  q <<SQL >/dev/null
BEGIN;
GRANT tcds_identity_central_admin TO current_user WITH INHERIT TRUE;
SELECT warehouse_identity.central_issue_invite_v1(
  (SELECT user_id FROM warehouse_identity.users WHERE username = '$U' AND status = 'ACTIVE'),
  (SELECT user_id FROM warehouse_identity.users WHERE username = '$ADMIN' AND status = 'ACTIVE'),
  '\\x$HASH'::bytea, '$RP', 4320, 'Staging EOC leadership pilot enrollment', gen_random_uuid());
REVOKE tcds_identity_central_admin FROM current_user;
COMMIT;
SQL
  echo "Invite for $U (single use, expires in 72 hours; a new invite cancels the previous one):"
  echo
  echo "  https://$RP/enroll/#$TOKEN"
  echo
  echo "Open it only on the device that should hold this account's passkey. Do not paste it into chat."
  unset TOKEN HASH ;;
*) sed -n '2,10p' "$0"; exit 2 ;;
esac
