#!/usr/bin/env bash
# STAGING ONLY. Installs (and keeps) Recovery V1.5 (vendor 604,604a,608,610,612,614,617) + our 620 on kqcdqtazcqaawdkmcfed,
# so the dev team's login-v2-api consume patch can be tested against it.
#   install    one transaction: catalog snapshot saved -> V1.5 -> 620 -> self-checks -> COMMIT
#   verify     read-only checks + rolled-back probes as tcds_login_api
#   uninstall  one transaction: 620 rollback -> vendor 619 -> catalog must equal the saved snapshot (CONFIRM=UNINSTALL-STG-RECOVERY)
# Needs /tmp/recov15 (vendor SQL + sha.txt + install.sql from recov15_rehearse.sh, and the 620 files).
# Usage: bash /tmp/recov15/stg_recovery_install.sh <cmd>   (run from /srv/arb-system/api)
set -euo pipefail
cd /srv/arb-system/api
eval "$(grep -E '^(PGHOST|PGPORT|PGDATABASE|PGUSER|PGPASSWORD|PGSSLMODE)=' .env | sed -E "s/^([A-Z_]+)=(.*)$/export \1='\2'/")"
export PGHOST=db.kqcdqtazcqaawdkmcfed.supabase.co PGPORT=5432 PGDATABASE=postgres PGUSER=postgres
[ "$PGHOST" = "db.kqcdqtazcqaawdkmcfed.supabase.co" ] || { echo "not the staging host - stopping"; exit 1; }
D=/tmp/recov15
STATE=$HOME/stg_login/recovery_install
q() { PAGER=cat psql -X -At -v ON_ERROR_STOP=1 "$@"; }

cat > $D/snap.sql <<'SQL'
CREATE OR REPLACE FUNCTION pg_temp.snap() RETURNS SETOF text LANGUAGE sql AS $s$
 SELECT 'rel:'||c.relname||':'||c.relkind::text FROM pg_class c WHERE c.relnamespace='warehouse_identity'::regnamespace
 UNION ALL SELECT 'col:'||c.relname||'.'||a.attname||':'||format_type(a.atttypid,a.atttypmod)
   FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid
   WHERE c.relnamespace='warehouse_identity'::regnamespace AND c.relkind IN ('r','p') AND a.attnum>0 AND NOT a.attisdropped
 UNION ALL SELECT 'fn:'||p.oid::regprocedure::text||':'||pg_get_userbyid(p.proowner)||':'||coalesce(p.proacl::text,'-')
   FROM pg_proc p WHERE p.pronamespace='warehouse_identity'::regnamespace
 UNION ALL SELECT 'acl:'||c.relname||':'||coalesce(c.relacl::text,'-') FROM pg_class c
   WHERE c.relnamespace='warehouse_identity'::regnamespace AND c.relkind='r'
 UNION ALL SELECT 'trg:'||c.relname||':'||t.tgname FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
   WHERE c.relnamespace='warehouse_identity'::regnamespace AND NOT t.tgisinternal
 UNION ALL SELECT 'con:'||coalesce(c.relname,'-')||':'||k.conname||':'||pg_get_constraintdef(k.oid)
   FROM pg_constraint k LEFT JOIN pg_class c ON c.oid=k.conrelid WHERE k.connamespace='warehouse_identity'::regnamespace
 UNION ALL SELECT 'pol:'||tablename||':'||policyname FROM pg_policies WHERE schemaname='warehouse_identity'
 UNION ALL SELECT 'role:'||rolname FROM pg_roles WHERE rolname LIKE 'iam\_%'
 UNION ALL SELECT 'member:'||pg_get_userbyid(roleid)||'>'||pg_get_userbyid(member)||' by '||pg_get_userbyid(grantor)
   ||':'||inherit_option::text||':'||set_option::text||':'||admin_option::text
   FROM pg_auth_members WHERE pg_get_userbyid(member)='postgres' AND pg_get_userbyid(roleid)='tcds_identity_function_owner'
$s$;
SQL

files_ok() {
  (cd $D && sha256sum -c --quiet sha.txt)
  [ -f $D/install.sql ] || { echo "missing $D/install.sql (run recov15_rehearse.sh once)"; exit 1; }
  for f in 620_recovery_v15_privileged_interface 620_recovery_v15_privileged_interface.rollback 619_recovery_v15_full_staging_rollback; do
    grep -vxE 'BEGIN;|COMMIT;' $D/$f.sql > $D/$f.body.sql
  done
  sha256sum $D/620_recovery_v15_privileged_interface.sql $D/620_recovery_v15_privileged_interface.rollback.sql
}

case "${1:-}" in
install)
  files_ok
  [ -z "$(q -c "SELECT to_regclass('warehouse_identity.user_recovery_contacts')")" ] || { echo "already installed on staging"; exit 1; }
  mkdir -p "$STATE"; chmod 700 "$STATE"
  q -c "SELECT 1" >/dev/null
  # Snapshot BEFORE, written by the same session that installs.
  q -q <<SQL
BEGIN;
SET LOCAL search_path = pg_catalog, pg_temp;
\i $D/snap.sql
\o $STATE/catalog_before.txt
SELECT x FROM pg_temp.snap() x ORDER BY 1;
\o
\echo == installing V1.5 (604,604a,608,610,612,614,617) + 620
\i $D/install.sql
SET LOCAL search_path = pg_catalog, pg_temp;
\i $D/620_recovery_v15_privileged_interface.body.sql
SET LOCAL search_path = pg_catalog, pg_temp;
DO \$chk\$
BEGIN
 IF (SELECT count(*) FROM pg_class c WHERE c.relnamespace='warehouse_identity'::regnamespace AND c.relkind='r'
     AND (c.relname LIKE 'recovery\_%' OR c.relname IN ('user_recovery_contacts','iam_session_epochs_v15','supervised_recovery_proof_consumptions_v1'))
     AND c.relrowsecurity AND c.relforcerowsecurity) <> 9 THEN RAISE EXCEPTION 'STG_INSTALL_EXPECTED_9_FORCED_RLS_TABLES'; END IF;
 IF to_regprocedure('warehouse_identity.iam_advance_session_epoch_v15(uuid,text,uuid,uuid,uuid)') IS NULL THEN RAISE EXCEPTION 'STG_INSTALL_620_MISSING'; END IF;
END \$chk\$;
COMMIT;
SQL
  sha256sum $D/*.sql > "$STATE/installed_files.sha256"
  echo "INSTALLED ON STAGING at $(date -u +%FT%TZ) (snapshot: $STATE/catalog_before.txt, $(wc -l < "$STATE/catalog_before.txt") entries)"
  bash "$0" verify
  ;;
verify)
  q <<'SQL'
BEGIN;
SET LOCAL search_path = pg_catalog, pg_temp;
SELECT 'table | ' || c.relname || ' rls=' || (c.relrowsecurity AND c.relforcerowsecurity)
  || ' rows=' || (xpath('/row/n/text()', query_to_xml(format('SELECT count(*) AS n FROM warehouse_identity.%I', c.relname), false, true, '')))[1]::text
  || ' anon/auth/service=' || (has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE') OR has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE') OR has_table_privilege('service_role',c.oid,'SELECT,INSERT,UPDATE,DELETE'))
  || ' login_api=' || has_table_privilege('tcds_login_api',c.oid,'SELECT,INSERT,UPDATE,DELETE')
FROM pg_class c WHERE c.relnamespace='warehouse_identity'::regnamespace AND c.relkind='r'
  AND (c.relname LIKE 'recovery\_%' OR c.relname IN ('user_recovery_contacts','iam_session_epochs_v15','supervised_recovery_proof_consumptions_v1'))
ORDER BY 1;
SELECT 'fn | ' || p.proname || ' owner=' || pg_get_userbyid(p.proowner) || ' definer=' || p.prosecdef
  || ' login_api=' || has_function_privilege('tcds_login_api',p.oid,'EXECUTE') || ' public=' || has_function_privilege('public',p.oid,'EXECUTE')
FROM pg_proc p WHERE p.pronamespace='warehouse_identity'::regnamespace AND p.proname LIKE '%\_v15' ORDER BY 1;
SELECT 'runtime_role | exists=' || EXISTS(SELECT 1 FROM pg_roles WHERE rolname='iam_recovery_runtime');
GRANT tcds_login_api TO postgres WITH SET TRUE;
SET LOCAL ROLE tcds_login_api;
DO $l$
DECLARE r record;
BEGIN
 BEGIN PERFORM count(*) FROM warehouse_identity.recovery_proofs_v1; RAISE NOTICE 'login_api direct read: ALLOWED (bad)';
 EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'login_api direct read: denied (ok)'; END;
 BEGIN PERFORM warehouse_identity.recovery_consume_supplemental_proof_v15(gen_random_uuid(),gen_random_uuid(),gen_random_uuid());
 EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'consume fn as login_api: %', SQLERRM; END;
 SELECT * INTO r FROM warehouse_identity.iam_session_epoch_status_v15(gen_random_uuid());
 RAISE NOTICE 'status fn as login_api: active=% epoch=%', r.user_active, r.epoch;
END $l$;
ROLLBACK;
SQL
  echo "VERIFY DONE (probes rolled back)"
  ;;
uninstall)
  [ "${CONFIRM:-}" = "UNINSTALL-STG-RECOVERY" ] || { echo "set CONFIRM=UNINSTALL-STG-RECOVERY"; exit 1; }
  files_ok
  [ -f "$STATE/catalog_before.txt" ] || { echo "no saved snapshot in $STATE"; exit 1; }
  q -q <<SQL
BEGIN;
SET LOCAL search_path = pg_catalog, pg_temp;
\i $D/snap.sql
\i $D/620_recovery_v15_privileged_interface.rollback.body.sql
SET LOCAL search_path = pg_catalog, pg_temp;
\i $D/619_recovery_v15_full_staging_rollback.body.sql
SET LOCAL search_path = pg_catalog, pg_temp;
\o $STATE/catalog_after_uninstall.txt
SELECT x FROM pg_temp.snap() x ORDER BY 1;
\o
COMMIT;
SQL
  if diff -q "$STATE/catalog_before.txt" "$STATE/catalog_after_uninstall.txt" >/dev/null; then
    echo "UNINSTALLED: catalog identical to the pre-install snapshot"
  else
    echo "UNINSTALLED, BUT catalog differs from the snapshot:"; diff "$STATE/catalog_before.txt" "$STATE/catalog_after_uninstall.txt" | head -20
  fi
  ;;
*) echo "usage: $0 install|verify|uninstall"; exit 2;;
esac
