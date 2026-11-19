#!/usr/bin/env bash
# STAGING ONLY (IAM DB kqcdqtazcqaawdkmcfed). EOC leadership appointments for the staging pilot (enterprise_org, 603 + 603a).
# The EOC admits a person only with exactly one ACTIVE appointment whose person is VERIFIED and IAM-linked
# (EOC server/policy.mjs activeAppointment). The IAM link evidence is the person's VERIFIED 623 binding, which two
# approvers created through the central passkey approval (628). Appointments grant NO module access: that is the
# separate two-approver EOC grant (eoc_iam.module_grants).
#   plan     read only: bindings, positions, people, appointments; what apply would write
#   apply    CONFIRM=APPOINT-PILOT: positions CEO + CTO, the two people (VERIFIED, IAM-linked), ACTIVE appointments
#            for 90 days approved by the staging identity admin; then checks every EOC admission condition
#   status   read only: the same admission check as apply
#   end      CONFIRM=END-PILOT-APPOINTMENTS: sets both appointments ENDED (history kept; EOC admission stops)
set -euo pipefail
cd /srv/arb-system/api
eval "$(grep -E '^(PGHOST|PGPORT|PGDATABASE|PGUSER|PGPASSWORD|PGSSLMODE)=' .env | sed -E "s/^([A-Z_]+)=(.*)$/export \1='\2'/")"
export PGHOST=db.kqcdqtazcqaawdkmcfed.supabase.co PGPORT=5432 PGDATABASE=postgres PGUSER=postgres PAGER=cat
[ "$PGHOST" = "db.kqcdqtazcqaawdkmcfed.supabase.co" ] || { echo "not the staging host - stopping"; exit 1; }
q() { psql -X -At -v ON_ERROR_STOP=1 "$@"; }
ISSUER=https://login-stg.tcdsolutionsgroup.com
ADMIN=stg.identity.admin
DAYS=90
# username | person_key | position | position title | function
PILOT="anthony.malone.stg|ANTHONY_MALONE_STG|CTO|Chief Technology Officer|TECHNOLOGY
korina.korva.stg|KORINA_KORVA_STG|CEO|Chief Executive Officer|EXECUTIVE"
USERS="'anthony.malone.stg','korina.korva.stg'"

# The EOC admission rule (policy.mjs activeAppointment + 623 snapshot shape), evaluated in SQL.
CHECK_SQL="
SELECT 'eoc admission ' || rpad(u.username, 22) ||
       CASE WHEN count(*) FILTER (WHERE a.appointment_status = 'ACTIVE' AND p.record_status = 'VERIFIED' AND p.iam_user_id = u.user_id
              AND pos.active AND p.iam_link_verified_at IS NOT NULL AND p.iam_link_authority = 'TCDS_GOVERNED_IAM'
              AND nullif(p.iam_link_evidence_reference, '') IS NOT NULL AND a.approved_at IS NOT NULL
              AND nullif(a.approval_reference, '') IS NOT NULL AND a.effective_from <= current_date
              AND (a.effective_until IS NULL OR a.effective_until >= current_date)
              AND a.position_code IN ('CEO','VICE_PRESIDENT','CTO','WAREHOUSE_ADMINISTRATOR','WAREHOUSE_GENERAL_MANAGER','IT_MANAGER')) = 1
            THEN 'PASS  ' ELSE 'FAIL  ' END ||
       coalesce(string_agg(a.position_code || ' ' || a.appointment_status || ' ' || a.effective_from || '..' || coalesce(a.effective_until::text, 'open'), ', '), 'no appointment')
  FROM warehouse_identity.users u
  LEFT JOIN enterprise_org.leadership_people p ON p.iam_user_id = u.user_id
  LEFT JOIN enterprise_org.leadership_appointments a ON a.person_id = p.person_id
  LEFT JOIN enterprise_org.positions pos ON pos.position_code = a.position_code
 WHERE u.username IN ($USERS)
 GROUP BY u.username ORDER BY u.username;
SELECT 'binding       ' || rpad(u.username, 22) || coalesce(b.binding_status, 'NONE') || coalesce(' ' || b.binding_id, '')
  FROM warehouse_identity.users u
  LEFT JOIN warehouse_identity.eoc_federated_subject_bindings_v12 b ON b.user_id = u.user_id AND b.issuer = '$ISSUER' AND b.revoked_at IS NULL
 WHERE u.username IN ($USERS) ORDER BY u.username;"

case "${1:-}" in
plan|status)
  q -c "SELECT 'positions: ' || coalesce(string_agg(position_code || CASE WHEN active THEN '' ELSE '(inactive)' END, ', ' ORDER BY position_code), 'none') FROM enterprise_org.positions"
  q -c "SELECT 'people: ' || count(*) || ', appointments: ' || (SELECT count(*) FROM enterprise_org.leadership_appointments) FROM enterprise_org.leadership_people"
  q <<< "$CHECK_SQL"
  [ "$1" = plan ] && echo "apply would: add positions CEO/CTO if missing; link each person to their VERIFIED $ISSUER binding; ACTIVE appointment for $DAYS days, approved by $ADMIN" ;;
apply)
  [ "${CONFIRM:-}" = "APPOINT-PILOT" ] || { echo "set CONFIRM=APPOINT-PILOT"; exit 1; }
  ROWS=$(while IFS='|' read -r u k p t f; do printf "('%s','%s','%s','%s','%s')," "$u" "$k" "$p" "$t" "$f"; done <<< "$PILOT")
  q <<SQL
BEGIN;
CREATE TEMP TABLE pilot(username text, person_key text, position_code text, position_title text, function_key text) ON COMMIT DROP;
INSERT INTO pilot VALUES ${ROWS%,};
DO \$\$
DECLARE r record; v_user uuid; v_admin uuid; v_bind record; v_person uuid;
BEGIN
 SELECT user_id INTO v_admin FROM warehouse_identity.users WHERE username = '$ADMIN' AND status = 'ACTIVE';
 IF v_admin IS NULL THEN RAISE EXCEPTION 'STAGING_IDENTITY_ADMIN_MISSING'; END IF;
 FOR r IN SELECT * FROM pilot LOOP
  SELECT user_id INTO v_user FROM warehouse_identity.users WHERE username = r.username AND status = 'ACTIVE';
  IF v_user IS NULL THEN RAISE EXCEPTION 'PILOT_ACCOUNT_MISSING %', r.username; END IF;
  -- The IAM link is evidence-backed: the VERIFIED, unrevoked central binding approved by two people (628).
  SELECT b.binding_id, b.verified_at INTO v_bind FROM warehouse_identity.eoc_federated_subject_bindings_v12 b
   WHERE b.user_id = v_user AND b.issuer = '$ISSUER' AND b.binding_status = 'VERIFIED' AND b.revoked_at IS NULL;
  IF v_bind.binding_id IS NULL THEN RAISE EXCEPTION 'NO_VERIFIED_BINDING %', r.username; END IF;
  INSERT INTO enterprise_org.positions (position_code, position_title, function_key, executive_all_modules)
  VALUES (r.position_code, r.position_title, r.function_key, r.position_code = 'CEO') ON CONFLICT (position_code) DO NOTHING;
  SELECT person_id INTO v_person FROM enterprise_org.leadership_people WHERE iam_user_id = v_user OR person_key = r.person_key;
  IF v_person IS NULL THEN
   INSERT INTO enterprise_org.leadership_people (person_key, full_name, iam_user_id, iam_link_authority, iam_link_evidence_reference,
     iam_link_verified_at, record_status)
   SELECT r.person_key, u.display_name, v_user, 'TCDS_GOVERNED_IAM', 'EOC_BINDING:' || v_bind.binding_id, v_bind.verified_at, 'VERIFIED'
     FROM warehouse_identity.users u WHERE u.user_id = v_user
   RETURNING person_id INTO v_person;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM enterprise_org.leadership_appointments a WHERE a.person_id = v_person AND a.position_code = r.position_code
                   AND a.appointment_status IN ('PENDING_VERIFICATION','ACTIVE','ON_LEAVE')) THEN
   INSERT INTO enterprise_org.leadership_appointments (person_id, position_code, appointment_status, effective_from, effective_until,
     approved_by_iam_user_id, approval_reference, approved_at)
   VALUES (v_person, r.position_code, 'ACTIVE', current_date, current_date + $DAYS, v_admin,
     'STAGING_PILOT:' || to_char(clock_timestamp(), 'YYYY-MM-DD') || ':EOC_BINDING:' || v_bind.binding_id, clock_timestamp());
  END IF;
 END LOOP;
END \$\$;
COMMIT;
SQL
  q <<< "$CHECK_SQL"
  echo "APPOINTMENTS APPLIED (module access still needs the two-approver EOC grants)" ;;
end)
  [ "${CONFIRM:-}" = "END-PILOT-APPOINTMENTS" ] || { echo "set CONFIRM=END-PILOT-APPOINTMENTS"; exit 1; }
  q -c "UPDATE enterprise_org.leadership_appointments a SET appointment_status = 'ENDED', effective_until = greatest(a.effective_from, current_date), ended_at = clock_timestamp()
         FROM enterprise_org.leadership_people p JOIN warehouse_identity.users u ON u.user_id = p.iam_user_id
        WHERE a.person_id = p.person_id AND u.username IN ($USERS) AND a.appointment_status IN ('ACTIVE','ON_LEAVE')"
  q <<< "$CHECK_SQL" ;;
*) sed -n '2,13p' "$0"; exit 2 ;;
esac
