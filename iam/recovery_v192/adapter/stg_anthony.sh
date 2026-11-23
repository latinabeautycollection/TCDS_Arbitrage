#!/usr/bin/env bash
# STAGING ONLY. Makes a named staging user (default anthony.malone.stg) a recovery-email approver (TCDS 645).
#   status                         read-only: the user, their central passkey on login-stg, approver role, pending enrollments
#   assign   CONFIRM=ASSIGN-APPROVER [APPROVER=username] [DAYS=90]   global role assignment, attributed to ASSIGNED_BY
#   revoke   CONFIRM=REVOKE-APPROVER [APPROVER=username]
# Assigning the role grants nothing else: approving still needs the person's own central passkey on login-stg.
# Notices go to RECOVERY_APPROVER_EMAILS: set it with stg_adapter_v2.sh approvers (that address is not handled here).
set -euo pipefail
cd /srv/arb-system/api
eval "$(grep -E '^(PGHOST|PGPORT|PGDATABASE|PGUSER|PGPASSWORD|PGSSLMODE)=' .env | sed -E "s/^([A-Z_]+)=(.*)$/export \1='\2'/")"
export PGHOST=db.kqcdqtazcqaawdkmcfed.supabase.co PGPORT=5432 PGDATABASE=postgres PGUSER=postgres
[ "$PGHOST" = "db.kqcdqtazcqaawdkmcfed.supabase.co" ] || { echo "not the staging host - stopping"; exit 1; }
WHO=${APPROVER:-anthony.malone.stg}; BY=${ASSIGNED_BY:-stg_approver_1}; DAYS=${DAYS:-90}
[[ "$WHO" =~ ^[a-z0-9._-]{3,80}$ && "$BY" =~ ^[a-z0-9._-]{3,80}$ && "$DAYS" =~ ^[0-9]{1,3}$ ]] || { echo "bad APPROVER / ASSIGNED_BY / DAYS"; exit 1; }
q() { PAGER=cat psql -X -q -A -F ' | ' -v ON_ERROR_STOP=1 -v who="$WHO" -v by="$BY" -v days="$DAYS" "$@"; }

case "${1:-}" in
status) q <<'SQL'
\pset footer off
SELECT 'user: '||u.username||' | '||u.display_name||' | status='||u.status AS approver FROM warehouse_identity.users u WHERE u.normalized_username=lower(:'who');
SELECT 'central passkeys on login-stg: active='||count(*) FILTER (WHERE p.security_state='ACTIVE')||' total='||count(*) AS passkeys
 FROM warehouse_identity.central_passkeys p JOIN warehouse_identity.users u ON u.user_id=p.user_id
 WHERE u.normalized_username=lower(:'who') AND p.rp_id='login-stg.tcdsolutionsgroup.com';
SELECT 'approver role: '||coalesce(string_agg('valid until '||coalesce(ra.valid_until::date::text,'open'),', ') FILTER (WHERE ra.role_id IS NOT NULL),'none')||' | can approve now='||
  bool_or(warehouse_identity.recovery_is_contact_approver_v645(u.user_id)) AS role
 FROM warehouse_identity.users u LEFT JOIN warehouse_identity.user_role_assignments ra ON ra.user_id=u.user_id AND ra.revoked_at IS NULL
   AND ra.role_id=(SELECT role_id FROM warehouse_identity.roles WHERE role_code='IAM_RECOVERY_DESTINATION_APPROVER')
 WHERE u.normalized_username=lower(:'who') GROUP BY u.user_id;
SELECT 'enrollment '||left(e.enrollment_id::text,8)||' | '||u.username||' | '||e.contact_hint||' | '||e.status||' | approvals '||
  (SELECT count(*) FROM warehouse_identity.recovery_contact_approvals_v645 a WHERE a.enrollment_id=e.enrollment_id)||
  ' | link https://login-stg.tcdsolutionsgroup.com/approve/recovery/?e='||e.enrollment_id AS recent
 FROM warehouse_identity.recovery_contact_enrollments_v645 e JOIN warehouse_identity.users u ON u.user_id=e.user_id
 ORDER BY e.created_at DESC LIMIT 5;
SQL
  ;;
assign)
  [ "${CONFIRM:-}" = ASSIGN-APPROVER ] || { echo "set CONFIRM=ASSIGN-APPROVER"; exit 1; }
  q <<'SQL'
BEGIN;
SELECT set_config('tcds.who', :'who', true), set_config('tcds.by', :'by', true), set_config('tcds.days', :'days', true) \gset x_
DO $a$ DECLARE v_user uuid; v_by uuid; v_role uuid;
BEGIN
 SELECT user_id INTO v_user FROM warehouse_identity.users WHERE normalized_username=lower(current_setting('tcds.who')) AND status='ACTIVE';
 SELECT user_id INTO v_by FROM warehouse_identity.users WHERE normalized_username=lower(current_setting('tcds.by')) AND status='ACTIVE';
 SELECT role_id INTO v_role FROM warehouse_identity.roles WHERE role_code='IAM_RECOVERY_DESTINATION_APPROVER';
 IF v_user IS NULL OR v_by IS NULL OR v_role IS NULL THEN RAISE EXCEPTION 'APPROVER, ASSIGNED_BY or the 645 role not found (or not ACTIVE)'; END IF;
 IF v_user=v_by THEN RAISE EXCEPTION 'ASSIGNED_BY must be a different person'; END IF;
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
  [ "${CONFIRM:-}" = REVOKE-APPROVER ] || { echo "set CONFIRM=REVOKE-APPROVER"; exit 1; }
  q <<'SQL'
BEGIN;
UPDATE warehouse_identity.user_role_assignments ra SET revoked_at=clock_timestamp(),
  revoked_by=(SELECT user_id FROM warehouse_identity.users WHERE normalized_username=lower(:'by'))
 WHERE ra.user_id=(SELECT user_id FROM warehouse_identity.users WHERE normalized_username=lower(:'who')) AND ra.revoked_at IS NULL
   AND ra.role_id=(SELECT role_id FROM warehouse_identity.roles WHERE role_code='IAM_RECOVERY_DESTINATION_APPROVER');
COMMIT;
\echo approver role revoked (if it was assigned)
SQL
  ;;
*) sed -n '2,8p' "$0"; exit 2 ;;
esac
