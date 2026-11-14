#!/usr/bin/env bash
# CENTRAL IAM STAGING ONLY (kqcdqtazcqaawdkmcfed). Domain 6.4 V1.3 IAM-side migrations: vendor 624 + 625 UNCHANGED,
# wrapped by v13_pre.sql (preflight + temporary schema CREATE, the Supabase PG17 fix) and v13_post.sql (restore +
# self-verify); our own rollback (v13_rollback.sql) because the package ships none for 624/625.
#   rehearse   one transaction: snapshot -> pre+624+625+post -> tests -> rollback script -> snapshot must be identical
#              -> ROLLBACK. Nothing is kept.
#   install    CONFIRM=INSTALL-V13-IAM: pre+624+625+post in one transaction, COMMIT
#   test       tests inside a transaction that is rolled back
#   uninstall  CONFIRM=UNINSTALL-V13-IAM: v13_rollback.sql (refuses while any V1.3 row exists)
# Usage: bash /tmp/recov15/v13iam/stg_v13_iam.sh rehearse|install|test|uninstall
set -euo pipefail
cd /srv/arb-system/api
eval "$(grep -E '^(PGHOST|PGPORT|PGDATABASE|PGUSER|PGPASSWORD|PGSSLMODE)=' .env | sed -E "s/^([A-Z_]+)=(.*)$/export \1='\2'/")"
export PGHOST=db.kqcdqtazcqaawdkmcfed.supabase.co PGPORT=5432 PGDATABASE=postgres PGUSER=postgres PAGER=cat
[ "$PGHOST" = "db.kqcdqtazcqaawdkmcfed.supabase.co" ] || { echo "not the staging host - stopping"; exit 1; }
D=/tmp/recov15/v13iam
q() { psql -X -At -v ON_ERROR_STOP=1 "$@"; }
installed() { [ -n "$(q -c "SELECT to_regclass('warehouse_identity.eoc_binding_approvals_v13')")" ]; }

( cd $D && sha256sum -c --quiet - ) <<'SUMS' || { echo "vendor 624/625 differ from the V1.3 package - stopping"; exit 1; }
b4171bcf4a9c4c326fde7a0b39fa1c06d6f70645ea1e4b8c1cf8313cad3d75a3  624_eoc_governed_binding_approvals_v13.sql
d2d95de1df261f2c0ee058be58156e84a8d5bec1141e81f06215cb5b3a532ae0  625_eoc_bridge_retention_v13.sql
SUMS
body() { grep -vxE 'BEGIN;|COMMIT;' "$1"; }
{ cat $D/v13_pre.sql; body $D/624_eoc_governed_binding_approvals_v13.sql; body $D/625_eoc_bridge_retention_v13.sql
  cat $D/v13_post.sql; } > $D/install.body.sql

cat > $D/snap.sql <<'SQL'
CREATE OR REPLACE FUNCTION pg_temp.snap() RETURNS SETOF text LANGUAGE sql AS $s$
 SELECT 'role:'||rolname||':'||rolcanlogin||rolinherit||rolcreaterole||rolbypassrls FROM pg_roles
 UNION ALL SELECT 'member:'||pg_get_userbyid(roleid)||'>'||pg_get_userbyid(member)||' by '||pg_get_userbyid(grantor)
   ||':'||inherit_option||set_option||admin_option FROM pg_auth_members
 UNION ALL SELECT 'schema:'||nspname||':'||pg_get_userbyid(nspowner)||':'||coalesce(nspacl::text,'-') FROM pg_namespace
 UNION ALL SELECT 'policy:'||schemaname||'.'||tablename||':'||policyname FROM pg_policies
 UNION ALL SELECT 'rel:'||c.oid::regclass::text||':'||c.relkind::text||':'||coalesce(c.relacl::text,'-') FROM pg_class c
   WHERE c.relnamespace IN ('warehouse_identity'::regnamespace, 'enterprise_org'::regnamespace)
 UNION ALL SELECT 'col:'||a.attrelid::regclass::text||'.'||a.attname||':'||a.attacl::text FROM pg_attribute a
   JOIN pg_class c ON c.oid = a.attrelid WHERE a.attacl IS NOT NULL
   AND c.relnamespace IN ('warehouse_identity'::regnamespace, 'enterprise_org'::regnamespace)
 UNION ALL SELECT 'fn:'||p.oid::regprocedure::text||':'||pg_get_userbyid(p.proowner)||':'||coalesce(p.proacl::text,'-')
   FROM pg_proc p WHERE p.pronamespace = 'warehouse_identity'::regnamespace
 UNION ALL SELECT 'approle:'||role_code FROM warehouse_identity.roles
$s$;
SQL

case "${1:-}" in
rehearse)
  installed && { echo "624/625 already installed - rehearse runs only on a clean state"; exit 1; }
  q -q <<SQL 2>&1
BEGIN;
SET LOCAL lock_timeout = '5s';
\i $D/snap.sql
CREATE TEMP TABLE before ON COMMIT DROP AS SELECT x FROM pg_temp.snap() x;
\i $D/install.body.sql
\echo == pre + 624 + 625 + post installed and self-verified inside the rehearsal transaction
SAVEPOINT t;
\i $D/v13_test.sql
ROLLBACK TO SAVEPOINT t;
\i $D/v13_rollback.sql
\echo == rollback script ran inside the rehearsal transaction
SELECT 'missing_after_rollback | ' || x FROM (SELECT x FROM before EXCEPT SELECT x FROM pg_temp.snap() x) d;
SELECT 'extra_after_rollback | ' || x FROM (SELECT x FROM pg_temp.snap() x EXCEPT SELECT x FROM before) d;
SELECT 'catalog_identical=' || NOT EXISTS (SELECT x FROM before EXCEPT SELECT x FROM pg_temp.snap() x
                                         UNION ALL SELECT x FROM pg_temp.snap() x EXCEPT SELECT x FROM before);
ROLLBACK;
SQL
  echo "REHEARSAL DONE (nothing kept)"
  ;;
install)
  [ "${CONFIRM:-}" = "INSTALL-V13-IAM" ] || { echo "set CONFIRM=INSTALL-V13-IAM"; exit 1; }
  installed && { echo "already installed"; exit 1; }
  { echo 'BEGIN;'; echo "SET LOCAL lock_timeout = '5s';"; cat $D/install.body.sql; echo 'COMMIT;'; } | q -q
  echo "624 + 625 INSTALLED ON IAM STAGING at $(date -u +%FT%TZ)"
  ;;
test)
  installed || { echo "not installed"; exit 1; }
  printf 'BEGIN;\n\\i %s\nROLLBACK;\n' "$D/v13_test.sql" | q -q 2>&1
  ;;
uninstall)
  [ "${CONFIRM:-}" = "UNINSTALL-V13-IAM" ] || { echo "set CONFIRM=UNINSTALL-V13-IAM"; exit 1; }
  { echo 'BEGIN;'; cat $D/v13_rollback.sql; echo 'COMMIT;'; } | q -q
  echo "624 + 625 ROLLED BACK on IAM staging"
  ;;
*) echo "usage: $0 rehearse|install|test|uninstall"; exit 2 ;;
esac
