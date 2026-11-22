#!/usr/bin/env bash
# STAGING ONLY (kqcdqtazcqaawdkmcfed). Installs and KEEPS Recovery V1.9.2 (vendor 634, 635, 637, 640, 641) + our 644,
# so the login-v2-api adapter can be built and tested against it.
#   install    saves a catalog snapshot, then ONE transaction: 644_pre -> vendor -> 644 -> self-check -> COMMIT
#   verify     read-only posture + the full functional flow as tcds_login_api inside a transaction that is ROLLED BACK
#   uninstall  CONFIRM=UNINSTALL-STG-V192: ONE transaction: 644_rollback_full -> catalog must equal the saved snapshot
#              -> COMMIT only if identical (otherwise ROLLBACK, nothing changes)
#   status     read-only: installed or not
# NOTE: after install, the 635 guard REQUIRES an OTP proof for every staging reset. The old item-3 baseline
#       (stg_testuser.sh http-reset without a proof) will now get OTP_PROOF_REQUIRED - that is the intended behaviour.
# Needs /tmp/recov192 (sql/, sha.txt, flow644.sql). Prints no secrets. Run from anywhere on the server.
set -euo pipefail
cd /srv/arb-system/api
eval "$(grep -E '^(PGHOST|PGPORT|PGDATABASE|PGUSER|PGPASSWORD|PGSSLMODE)=' .env | sed -E "s/^([A-Z_]+)=(.*)$/export \1='\2'/")"
export PGHOST=db.kqcdqtazcqaawdkmcfed.supabase.co PGPORT=5432 PGDATABASE=postgres PGUSER=postgres
[ "$PGHOST" = "db.kqcdqtazcqaawdkmcfed.supabase.co" ] || { echo "not the staging host - stopping"; exit 1; }
D=/tmp/recov192
STATE=$HOME/stg_login/recovery_v192
mkdir -p "$STATE"; chmod 700 "$STATE"
(cd $D && sha256sum -c --quiet sha.txt) && echo "files: sha256 ok"
rm -rf $D/body; mkdir -p $D/body
for f in $D/sql/*.sql; do grep -vxE 'BEGIN;|COMMIT;' "$f" > "$D/body/$(basename "$f")"; done
cp $D/flow644.sql $D/body/flow644.sql
q() { PAGER=cat psql -X -q -A -F ' | ' -v ON_ERROR_STOP=1 "$@" 2>&1 | grep -vE '^$' | sed -E 's/^psql:[^ ]+ (ERROR|NOTICE|WARNING): +/\1: /'; }

cat > $D/body/snap.sql <<'SQL'
CREATE OR REPLACE FUNCTION pg_temp.snap() RETURNS SETOF text LANGUAGE sql AS $s$
 SELECT 'rel:'||c.relname||':'||c.relkind::text FROM pg_class c WHERE c.relnamespace='warehouse_identity'::regnamespace
 UNION ALL SELECT 'col:'||c.relname||'.'||a.attname||':'||format_type(a.atttypid,a.atttypmod)
   FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid
   WHERE c.relnamespace='warehouse_identity'::regnamespace AND c.relkind IN ('r','p') AND a.attnum>0 AND NOT a.attisdropped
 UNION ALL SELECT 'fn:'||p.oid::regprocedure::text||':'||pg_get_userbyid(p.proowner)||':'||coalesce(p.proacl::text,'-')||':'||md5(pg_get_functiondef(p.oid))
   FROM pg_proc p WHERE p.pronamespace='warehouse_identity'::regnamespace AND p.prokind='f'
 UNION ALL SELECT 'acl:'||c.relname||':'||coalesce(c.relacl::text,'-') FROM pg_class c
   WHERE c.relnamespace='warehouse_identity'::regnamespace AND c.relkind='r'
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
 UNION ALL SELECT 'role:'||rolname FROM pg_roles WHERE rolname LIKE 'tcds\_recovery%'
 UNION ALL SELECT 'schemaacl:'||coalesce(nspacl::text,'-') FROM pg_namespace WHERE nspname='warehouse_identity'
$s$;
SQL

installed() { PAGER=cat psql -X -At -c "SELECT to_regclass('warehouse_identity.recovery_v192_ledger') IS NOT NULL"; }

case "${1:-}" in
status)
  echo "installed: $(installed)"
  PAGER=cat psql -X -At -F ' | ' <<'SQL'
SELECT 'v192 functions: '||count(*) FROM pg_proc WHERE pronamespace='warehouse_identity'::regnamespace AND proname LIKE 'recovery\_%\_v192';
SELECT 'guard requires OTP proof (635): '||(position('NO_SUPPLEMENTAL' IN pg_get_functiondef('warehouse_identity.recovery_reset_guard_v15(uuid,uuid)'::regprocedure))=0);
SELECT 'ledger recorded: '||coalesce((SELECT min(recorded_at)::text FROM warehouse_identity.recovery_v192_ledger),'-')
 WHERE to_regclass('warehouse_identity.recovery_v192_ledger') IS NOT NULL;
SQL
  [ -f "$STATE/catalog_before.txt" ] && echo "saved snapshot: $STATE/catalog_before.txt ($(wc -l < "$STATE/catalog_before.txt") entries)" || echo "saved snapshot: none" ;;

install)
  [ "$(installed)" = "f" ] || { echo "already installed - stopping"; exit 1; }
  echo "== saving catalog snapshot"
  PAGER=cat psql -X -q -At -v ON_ERROR_STOP=1 -f $D/body/snap.sql -c "SELECT x FROM pg_temp.snap() x ORDER BY 1" > "$STATE/catalog_before.txt.tmp"
  # psql -f then -c run in one session; the snapshot lines are the only output
  mv "$STATE/catalog_before.txt.tmp" "$STATE/catalog_before.txt"; chmod 600 "$STATE/catalog_before.txt"
  echo "   $(wc -l < "$STATE/catalog_before.txt") entries -> $STATE/catalog_before.txt"
  q <<SQL
BEGIN;
\\ir $D/body/644_pre_install_ledger.sql
\\ir $D/body/634_recovery_runtime_v18_STAGING_ONLY.sql
\\ir $D/body/635_strict_otp_first_gate_STAGING_ONLY.sql
\\ir $D/body/637_recovery_runtime_hardening_STAGING_ONLY.sql
\\ir $D/body/640_browser_bound_otp_claim_STAGING_ONLY.sql
\\ir $D/body/641_issuance_retry_state_STAGING_ONLY.sql
\\ir $D/body/644_recovery_v192_runtime_interface.sql
SET LOCAL search_path = pg_catalog, pg_temp;
SELECT 'self-check: v192 functions='||count(*)||' all definer+owner+login_api='||bool_and(p.prosecdef AND pg_get_userbyid(p.proowner)='tcds_identity_function_owner'
  AND has_function_privilege('tcds_login_api',p.oid,'EXECUTE') AND NOT has_function_privilege('anon',p.oid,'EXECUTE')) AS check
 FROM pg_proc p WHERE p.pronamespace='warehouse_identity'::regnamespace AND p.proname LIKE 'recovery\\_%\\_v192';
COMMIT;
\\echo INSTALLED ON STAGING (committed)
SQL
  ;;

verify)
  [ "$(installed)" = "t" ] || { echo "not installed - run install first"; exit 1; }
  q <<SQL
\\pset footer off
BEGIN;
SET LOCAL search_path = pg_catalog, pg_temp;
SELECT 'functions='||count(*)||' definer='||bool_and(p.prosecdef)||' owner_ok='||bool_and(pg_get_userbyid(p.proowner)='tcds_identity_function_owner')
  ||' login_api_exec='||bool_and(has_function_privilege('tcds_login_api',p.oid,'EXECUTE'))
  ||' others_exec='||bool_or(has_function_privilege('anon',p.oid,'EXECUTE') OR has_function_privilege('authenticated',p.oid,'EXECUTE')
     OR has_function_privilege('service_role',p.oid,'EXECUTE') OR has_function_privilege('public',p.oid,'EXECUTE')) AS posture
 FROM pg_proc p WHERE p.pronamespace='warehouse_identity'::regnamespace AND p.proname LIKE 'recovery\\_%\\_v192';
SELECT 'live rows: jobs='||(SELECT count(*) FROM warehouse_identity.recovery_issuance_jobs_v19)
  ||' outbox='||(SELECT count(*) FROM warehouse_identity.recovery_secret_outbox_v18)
  ||' invitations='||(SELECT count(*) FROM warehouse_identity.recovery_invitation_refs_v18)
  ||' bindings='||(SELECT count(*) FROM warehouse_identity.recovery_claim_bindings_v191)
  ||' contacts='||(SELECT count(*) FROM warehouse_identity.user_recovery_contacts) AS state;
DO \$m\$ BEGIN IF NOT pg_has_role('postgres','tcds_login_api','SET') THEN EXECUTE 'GRANT tcds_login_api TO postgres WITH SET TRUE, INHERIT FALSE'; END IF; END \$m\$;
\\echo == functional flow (rolled back)
\\ir $D/body/flow644.sql
ROLLBACK;
\\echo VERIFY DONE (rolled back, nothing changed)
SQL
  ;;

uninstall)
  [ "${CONFIRM:-}" = "UNINSTALL-STG-V192" ] || { echo "set CONFIRM=UNINSTALL-STG-V192"; exit 1; }
  [ "$(installed)" = "t" ] || { echo "not installed"; exit 1; }
  [ -f "$STATE/catalog_before.txt" ] || { echo "no saved snapshot at $STATE/catalog_before.txt - stopping"; exit 1; }
  q <<SQL
\\pset footer off
BEGIN;
\\ir $D/body/644_rollback_full.sql
SET LOCAL search_path = pg_catalog, pg_temp;
\\ir $D/body/snap.sql
CREATE TEMP TABLE before(x text);
\\copy before FROM '$STATE/catalog_before.txt' WITH (FORMAT csv, DELIMITER E'\\x01', QUOTE E'\\x02')
CREATE TEMP TABLE after AS SELECT x FROM pg_temp.snap() x;
SELECT 'LEFT BEHIND + '||x AS diff FROM (SELECT x FROM after EXCEPT SELECT x FROM before) a
UNION ALL SELECT 'REMOVED     - '||x FROM (SELECT x FROM before EXCEPT SELECT x FROM after) b ORDER BY 1;
SELECT NOT EXISTS((SELECT x FROM after EXCEPT SELECT x FROM before) UNION ALL (SELECT x FROM before EXCEPT SELECT x FROM after)) AS identical \\gset
\\if :identical
COMMIT;
\\echo UNINSTALLED - catalog identical to the saved snapshot (committed)
\\else
ROLLBACK;
\\echo !! catalog would differ from the snapshot - ROLLED BACK, nothing changed
\\endif
SQL
  ;;
*) sed -n '2,12p' "$0"; exit 2 ;;
esac
