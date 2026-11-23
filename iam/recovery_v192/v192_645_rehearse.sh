#!/usr/bin/env bash
# STAGING ONLY (kqcdqtazcqaawdkmcfed, where 644 is installed). Rehearses OUR 645 (recovery-email enrollment + central
# passkey approval) in ONE transaction that always ends in ROLLBACK - nothing is kept:
#   645 -> security checks -> functional flow (flow645.sql: employee start/code as tcds_login_api, approvals as
#   tcds_identity_central_verifier with central passkeys enrolled through 626; policy 1 and 2 approvers; cancel; limits)
#   -> 645_rollback -> catalog equal to the start -> install again -> rollback again -> equal again -> ROLLBACK.
# Prints no secrets. Copy first (from the Mac):
#   scp -r ~/Downloads/recov192/{v192_645_rehearse.sh,flow645.sql,sha.txt,sql} apifydev@139.177.200.80:/tmp/recov192/
# Run on the server: bash /tmp/recov192/v192_645_rehearse.sh
set -euo pipefail
cd /srv/arb-system/api
eval "$(grep -E '^(PGHOST|PGPORT|PGDATABASE|PGUSER|PGPASSWORD|PGSSLMODE)=' .env | sed -E "s/^([A-Z_]+)=(.*)$/export \1='\2'/")"
export PGHOST=db.kqcdqtazcqaawdkmcfed.supabase.co PGPORT=5432 PGDATABASE=postgres PGUSER=postgres
[ "$PGHOST" = "db.kqcdqtazcqaawdkmcfed.supabase.co" ] || { echo "not the staging host - stopping"; exit 1; }
D=/tmp/recov192
(cd $D && sha256sum -c --quiet sha.txt) && echo "files: sha256 ok"
rm -rf $D/body; mkdir -p $D/body
for f in $D/sql/*.sql; do grep -vxE 'BEGIN;|COMMIT;' "$f" > "$D/body/$(basename "$f")"; done
cp $D/flow645.sql $D/body/flow645.sql
echo "target | host=$PGHOST (staging)"

compare() { cat <<EOF
DROP TABLE IF EXISTS snapn; CREATE TEMP TABLE snapn AS SELECT x FROM pg_temp.snap() x;
SELECT 'LEFT BEHIND + '||x AS diff FROM (SELECT x FROM snapn EXCEPT SELECT x FROM snap0) a
UNION ALL SELECT 'REMOVED     - '||x FROM (SELECT x FROM snap0 EXCEPT SELECT x FROM snapn) b ORDER BY 1;
SELECT 'rollback $1: catalog identical to start = '||(NOT EXISTS((SELECT x FROM snapn EXCEPT SELECT x FROM snap0)
  UNION ALL (SELECT x FROM snap0 EXCEPT SELECT x FROM snapn)))::text
  ||' | approver role rows left = '||(SELECT count(*) FROM warehouse_identity.roles WHERE role_code='IAM_RECOVERY_DESTINATION_APPROVER') AS verdict;
EOF
}

{
cat <<'SQL'
\set ON_ERROR_STOP 1
\pset footer off
\pset null '-'
BEGIN;
SET LOCAL search_path = pg_catalog, pg_temp;
CREATE FUNCTION pg_temp.snap() RETURNS SETOF text LANGUAGE sql AS $s$
 SELECT 'rel:'||c.relname||':'||c.relkind::text FROM pg_class c WHERE c.relnamespace='warehouse_identity'::regnamespace
 UNION ALL SELECT 'col:'||c.relname||'.'||a.attname||':'||format_type(a.atttypid,a.atttypmod)
   FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid
   WHERE c.relnamespace='warehouse_identity'::regnamespace AND c.relkind IN ('r','p') AND a.attnum>0 AND NOT a.attisdropped
 UNION ALL SELECT 'fn:'||p.oid::regprocedure::text||':'||pg_get_userbyid(p.proowner)||':'||coalesce(p.proacl::text,'-')||':'||md5(pg_get_functiondef(p.oid))
   FROM pg_proc p WHERE p.pronamespace='warehouse_identity'::regnamespace AND p.prokind='f'
 UNION ALL SELECT 'acl:'||c.relname||':'||coalesce(c.relacl::text,'-') FROM pg_class c
   WHERE c.relnamespace='warehouse_identity'::regnamespace AND c.relkind='r'
 UNION ALL SELECT 'acl:security_events:'||coalesce(relacl::text,'-') FROM pg_class WHERE oid='warehouse_audit.security_events'::regclass
 UNION ALL SELECT 'colacl:'||c.relname||'.'||a.attname||':'||a.attacl::text FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid
   WHERE c.relnamespace='warehouse_identity'::regnamespace AND a.attacl IS NOT NULL
 UNION ALL SELECT 'trg:'||c.relname||':'||t.tgname FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
   WHERE c.relnamespace='warehouse_identity'::regnamespace AND NOT t.tgisinternal
 UNION ALL SELECT 'con:'||coalesce(c.relname,'-')||':'||k.conname||':'||pg_get_constraintdef(k.oid)
   FROM pg_constraint k LEFT JOIN pg_class c ON c.oid=k.conrelid WHERE k.connamespace='warehouse_identity'::regnamespace
 UNION ALL SELECT 'idx:'||indexrelid::regclass::text||':'||pg_get_indexdef(indexrelid) FROM pg_index i JOIN pg_class c ON c.oid=i.indrelid
   WHERE c.relnamespace='warehouse_identity'::regnamespace
 UNION ALL SELECT 'pol:'||tablename||':'||policyname||':'||roles::text||':'||cmd FROM pg_policies WHERE schemaname='warehouse_identity'
 UNION ALL SELECT 'rls:'||c.relname||':'||c.relrowsecurity||':'||c.relforcerowsecurity FROM pg_class c
   WHERE c.relnamespace='warehouse_identity'::regnamespace AND c.relkind='r'
 UNION ALL SELECT 'ledger:'||item||':'||value FROM warehouse_identity.recovery_v192_ledger WHERE item NOT IN ('guard_def')
$s$;
SELECT 'facts: 644 installed='||(to_regclass('warehouse_identity.recovery_v192_ledger') IS NOT NULL)
  ||' 626 central passkeys='||(to_regclass('warehouse_identity.central_passkeys') IS NOT NULL)
  ||' challenge purposes='||(SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname='central_challenge_context_purpose_check'
       AND conrelid='warehouse_identity.central_challenge_context'::regclass)
  ||' security_events cols ok='||(SELECT count(*)=8 FROM pg_attribute WHERE attrelid='warehouse_audit.security_events'::regclass
       AND attname IN ('event_type','severity','actor_user_id','entity_type','entity_id','request_id','correlation_id','details')) AS facts;
SELECT 'security_events check: '||conname||' '||left(pg_get_constraintdef(oid),200) AS audit_checks FROM pg_constraint
 WHERE conrelid='warehouse_audit.security_events'::regclass AND contype='c';
CREATE TEMP TABLE snap0 AS SELECT x FROM pg_temp.snap() x;
SELECT 'catalog snapshot: '||count(*)||' entries' AS snap0 FROM snap0;

\echo == install 1: 645
\ir body/645_recovery_contact_enrollment.sql
SET LOCAL search_path = pg_catalog, pg_temp;
\echo INSTALLED 1
\echo
\echo ==== SECURITY CHECKS
SELECT 'v645 functions='||count(*)||' definer='||bool_and(p.prosecdef)||' owner_ok='||bool_and(pg_get_userbyid(p.proowner)='tcds_identity_function_owner')
  ||' anon/public_exec='||bool_or(has_function_privilege('anon',p.oid,'EXECUTE') OR has_function_privilege('public',p.oid,'EXECUTE'))
  ||' search_path_pinned='||bool_and(p.proconfig::text LIKE '%search_path=pg_catalog%') AS functions
 FROM pg_proc p WHERE p.pronamespace='warehouse_identity'::regnamespace AND (p.proname LIKE 'recovery\_%\_v645' OR p.proname LIKE 'central\_%\_v645');
SELECT p.proname AS fn, has_function_privilege('tcds_login_api',p.oid,'EXECUTE') AS login_api, has_function_privilege('tcds_identity_central_verifier',p.oid,'EXECUTE') AS verifier
 FROM pg_proc p WHERE p.pronamespace='warehouse_identity'::regnamespace AND (p.proname LIKE 'recovery\_%\_v645' OR p.proname LIKE 'central\_%\_v645') ORDER BY 1;
SELECT t AS new_table, has_table_privilege('tcds_login_api','warehouse_identity.'||t,'SELECT') AS login_api_select,
  has_table_privilege('anon','warehouse_identity.'||t,'SELECT') AS anon_select,
  (SELECT relforcerowsecurity FROM pg_class WHERE oid=('warehouse_identity.'||t)::regclass) AS force_rls
 FROM unnest(ARRAY['recovery_contact_policy_v645','recovery_contact_enrollments_v645','recovery_contact_approvals_v645']) t;
SELECT 'policy: required_approvals='||required_approvals||' eligible_delay_minutes='||eligible_delay_minutes AS policy FROM warehouse_identity.recovery_contact_policy_v645;
\echo
\echo ==== FUNCTIONAL FLOW (fixture rows only inside this transaction)
SAVEPOINT flow;
\ir body/flow645.sql
ROLLBACK TO SAVEPOINT flow;
SQL
cat <<'SQL'
\echo == full rollback 1 (645_rollback)
\ir body/645_rollback.sql
SET LOCAL search_path = pg_catalog, pg_temp;
SQL
compare 1
cat <<'SQL'
\echo == install 2: 645
\ir body/645_recovery_contact_enrollment.sql
SET LOCAL search_path = pg_catalog, pg_temp;
\echo INSTALLED 2
\echo == full rollback 2 (645_rollback)
\ir body/645_rollback.sql
SET LOCAL search_path = pg_catalog, pg_temp;
SQL
compare 2
cat <<'SQL'
ROLLBACK;
\echo REHEARSAL ROLLED BACK
SQL
} > $D/rehearse645.sql

PAGER=cat psql -X -q -A -F ' | ' -f $D/rehearse645.sql 2>&1 \
 | grep -vE '^$' | sed -E 's/^psql:[^ ]+ (ERROR|NOTICE|WARNING): +/\1: /' || echo "!! rehearsal stopped early (error above) - the transaction was never committed"

echo
echo "==== AFTER: nothing kept on staging (new session, read-only)"
PAGER=cat psql -X -At -F ' | ' <<'SQL'
SELECT 'v645 tables left: '||count(*) FROM pg_class WHERE relnamespace='warehouse_identity'::regnamespace AND relname LIKE '%\_v645';
SELECT 'v645 functions left: '||count(*) FROM pg_proc WHERE pronamespace='warehouse_identity'::regnamespace AND proname LIKE '%\_v645';
SELECT 'approver role left: '||count(*) FROM warehouse_identity.roles WHERE role_code='IAM_RECOVERY_DESTINATION_APPROVER';
SELECT 'c645 fixture users left: '||count(*) FROM warehouse_identity.users WHERE username LIKE 'c645.%';
SELECT 'recovery contacts: '||count(*)||' (verified '||count(*) FILTER (WHERE status='VERIFIED')||')' FROM warehouse_identity.user_recovery_contacts;
SQL
