#!/usr/bin/env bash
# Pack/Ship Backend Authority V0.2 on PRODUCTION (vfxlrkqgakqqbnbbgecp).
#   rehearse  910 migration + 911 tests in ONE transaction, then ROLLBACK. Nothing is kept. Run this first.
#   apply     CONFIRM=APPLY-PACKSHIP-V02: 910 migration only, COMMIT.
#   verify    read only: objects, triggers, grants and settings after apply.
# Pinned file hashes; prints no secrets.
# Usage: bash /tmp/domain6_scanner/packship_v02/packship_v02.sh rehearse|apply|verify
set -uo pipefail
D=$(cd "$(dirname "$0")" && pwd)
M=$D/910_packship_v02.sql; T=$D/911_packship_v02_tests.sql
SHA_M=e170e6a8b09f4cb3fea59cb768aed32ae8ab18eed9703668d8a48d866ed373bd
SHA_T=85194c0e5226d537c51efea262e3c428500b3e7ce4873230310fdfddc6322ab0
[ "$(sha256sum "$M" | cut -d' ' -f1)" = "$SHA_M" ] || { echo "910 hash mismatch - stopping"; exit 1; }
[ "$(sha256sum "$T" | cut -d' ' -f1)" = "$SHA_T" ] || { echo "911 hash mismatch - stopping"; exit 1; }
cd /srv/arb-system/api || exit 1
eval "$(grep -E '^(PGHOST|PGPORT|PGDATABASE|PGUSER|PGPASSWORD|PGSSLMODE)=' .env | sed -E "s/^([A-Z_]+)=(.*)$/export \1='\2'/")"
case "${PGHOST:-}${PGUSER:-}" in *vfxlrkqgakqqbnbbgecp*) ;; *) echo "not the production database - stopping"; exit 1;; esac
PSQL=(psql -X -q -At -v ON_ERROR_STOP=1)
export PAGER=cat

case "${1:-}" in
rehearse)
  echo "target: production, mode=rehearse (ROLLBACK at the end)"
  { echo "BEGIN; SET LOCAL lock_timeout = '5s'; SET LOCAL statement_timeout = '120s';"
    cat "$M" "$T"; echo "ROLLBACK;"; } | "${PSQL[@]}" 2>&1 | grep -v -E '^NOTICE:  (relation|role|type) .* (already exists|does not exist)'
  rc=${PIPESTATUS[1]}
  [ "$rc" -eq 0 ] && echo "rehearse finished (ROLLBACK) rc=0" || echo "rehearse FAILED rc=$rc - nothing was kept"
  exit "$rc" ;;
apply)
  [ "${CONFIRM:-}" = "APPLY-PACKSHIP-V02" ] || { echo "set CONFIRM=APPLY-PACKSHIP-V02"; exit 1; }
  echo "target: production, mode=apply"
  { echo "BEGIN; SET LOCAL lock_timeout = '5s'; SET LOCAL statement_timeout = '120s';"
    cat "$M"; echo "COMMIT;"; } | "${PSQL[@]}" 2>&1
  rc=${PIPESTATUS[1]}
  [ "$rc" -eq 0 ] && echo "apply COMMITTED" || echo "apply FAILED rc=$rc - nothing was committed"
  exit "$rc" ;;
verify)
  "${PSQL[@]}" <<'SQL'
BEGIN READ ONLY;
SELECT 'functions: ' || count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'warehouse' AND (p.proname LIKE 'packship\_\_%' OR p.proname LIKE 'packship\_%\_v2');
SELECT 'public fn: ' || p.proname || ' api=' || has_function_privilege('tcds_packship_api', p.oid, 'EXECUTE')
       || ' system=' || has_function_privilege('tcds_packship_system', p.oid, 'EXECUTE')
       || ' anon=' || has_function_privilege('anon', p.oid, 'EXECUTE')
       || ' service_role=' || has_function_privilege('service_role', p.oid, 'EXECUTE')
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'warehouse' AND p.proname LIKE 'packship\_%\_v2' ORDER BY 1;
SELECT 'table: ' || c.relname || ' rows=' || (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM warehouse.%I', c.relname), false, true, '')))[1]::text
  FROM pg_class c WHERE c.relnamespace = 'warehouse'::regnamespace AND c.relname LIKE 'packship\_%' AND c.relkind = 'r' ORDER BY 1;
SELECT 'trigger: ' || tgrelid::regclass || ' ' || tgname FROM pg_trigger
 WHERE tgname LIKE 'trg\_packship%' OR tgname LIKE 'trg\_packing%' OR tgname = 'trg_packages_bump_row_version' ORDER BY 1;
SELECT 'setting: ' || setting_key || ' = ' || setting_value::text FROM warehouse.packship_settings ORDER BY 1;
SELECT 'role: ' || rolname || ' login=' || rolcanlogin FROM pg_roles WHERE rolname LIKE 'tcds\_packship%' ORDER BY 1;
ROLLBACK;
SQL
  ;;
*) echo "usage: $0 rehearse|apply|verify"; exit 1 ;;
esac
