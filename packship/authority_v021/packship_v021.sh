#!/usr/bin/env bash
# Pack/Ship V0.2.1 (additive task snapshot) on PRODUCTION (vfxlrkqgakqqbnbbgecp). Replaces one internal function,
# warehouse.packship__snapshot; same signature, owner and grants. No table or grant changes.
#   rehearse  912 + the full V0.2 suite (911) + the V0.2.1 tests (913) in ONE transaction, then ROLLBACK. Run first.
#   apply     CONFIRM=APPLY-PACKSHIP-V021: 912 only, COMMIT.
#   verify    read only: snapshot version marker, owner/ACL, API role still has no table access.
#   rollback  CONFIRM=ROLLBACK-PACKSHIP-V021: restore the exact V0.2 function (912_rollback.sql), COMMIT.
# Pinned file hashes; prints no secrets.
# Usage: bash /tmp/domain6_scanner/packship_v021/packship_v021.sh rehearse|apply|verify|rollback
set -uo pipefail
D=$(cd "$(dirname "$0")" && pwd)
M=$D/912_packship_v021_snapshot.sql; RB=$D/912_rollback.sql; T1=$D/911_packship_v02_tests.sql; T2=$D/913_packship_v021_tests.sql
( cd "$D" && sha256sum -c --quiet - ) <<'SUMS' || { echo "file hash mismatch - stopping"; exit 1; }
ba3a4019094525e1f3ffbeaae75599bb34e45cc2b86ff5ec7f257e48fa00870d  912_packship_v021_snapshot.sql
63cabc7c52c683d20b90365eac6b84c5ed360c0b19768e456cf7f08f60b48e0a  912_rollback.sql
85194c0e5226d537c51efea262e3c428500b3e7ce4873230310fdfddc6322ab0  911_packship_v02_tests.sql
8c85996231a1191d221c5d41094b239c0161a234b22f60cceead1dfd8c9bdb2d  913_packship_v021_tests.sql
SUMS
cd /srv/arb-system/api || exit 1
eval "$(grep -E '^(PGHOST|PGPORT|PGDATABASE|PGUSER|PGPASSWORD|PGSSLMODE)=' .env | sed -E "s/^([A-Z_]+)=(.*)$/export \1='\2'/")"
case "${PGHOST:-}${PGUSER:-}" in *vfxlrkqgakqqbnbbgecp*) ;; *) echo "not the production database - stopping"; exit 1;; esac
PSQL=(psql -X -q -At -v ON_ERROR_STOP=1)
export PAGER=cat
HDR="BEGIN; SET LOCAL lock_timeout = '5s'; SET LOCAL statement_timeout = '120s';"

case "${1:-}" in
rehearse)
  echo "target: production, mode=rehearse (ROLLBACK at the end)"
  { echo "$HDR"; cat "$M" "$T1" "$T2"; echo "ROLLBACK;"; } | "${PSQL[@]}" 2>&1 | grep -v -E '^NOTICE:  (relation|role|type) .* (already exists|does not exist)'
  rc=${PIPESTATUS[1]}
  [ "$rc" -eq 0 ] && echo "rehearse finished (ROLLBACK) rc=0" || echo "rehearse FAILED rc=$rc - nothing was kept"
  exit "$rc" ;;
apply)
  [ "${CONFIRM:-}" = "APPLY-PACKSHIP-V021" ] || { echo "set CONFIRM=APPLY-PACKSHIP-V021"; exit 1; }
  echo "target: production, mode=apply"
  { echo "$HDR"; cat "$M"; echo "COMMIT;"; } | "${PSQL[@]}" 2>&1
  rc=${PIPESTATUS[1]}
  [ "$rc" -eq 0 ] && echo "apply COMMITTED" || echo "apply FAILED rc=$rc - nothing was committed"
  exit "$rc" ;;
rollback)
  [ "${CONFIRM:-}" = "ROLLBACK-PACKSHIP-V021" ] || { echo "set CONFIRM=ROLLBACK-PACKSHIP-V021"; exit 1; }
  echo "target: production, mode=rollback (restore V0.2 snapshot)"
  { echo "$HDR"; cat "$RB"; echo "COMMIT;"; } | "${PSQL[@]}" 2>&1
  rc=${PIPESTATUS[1]}
  [ "$rc" -eq 0 ] && echo "rollback COMMITTED" || echo "rollback FAILED rc=$rc - nothing was committed"
  exit "$rc" ;;
verify)
  "${PSQL[@]}" <<'SQL'
BEGIN READ ONLY;
SELECT 'snapshot version: ' || CASE WHEN pg_get_functiondef(p.oid) LIKE '%''snapshotVersion'', ''0.2.1''%' THEN '0.2.1' ELSE 'V0.2 (not applied)' END
       || ' owner=' || pg_get_userbyid(p.proowner) || ' acl=' || coalesce(p.proacl::text, 'default')
  FROM pg_proc p WHERE p.oid = 'warehouse.packship__snapshot(uuid, warehouse.packship_actor_t)'::regprocedure;
SELECT 'api role table access (all should be false): '
       || has_table_privilege('tcds_packship_api', 'warehouse.facilities', 'SELECT') || ' '
       || has_table_privilege('tcds_packship_api', 'warehouse.product_profiles', 'SELECT') || ' '
       || has_table_privilege('tcds_packship_api', 'warehouse_control.station_readiness_current', 'SELECT') || ' '
       || has_table_privilege('tcds_packship_api', 'warehouse_control.print_jobs', 'SELECT');
SELECT 'get_task_v2 api=' || has_function_privilege('tcds_packship_api', 'warehouse.packship_get_task_v2(uuid,uuid)', 'EXECUTE')
       || ' anon=' || has_function_privilege('anon', 'warehouse.packship_get_task_v2(uuid,uuid)', 'EXECUTE');
SELECT 'stored operation results (replays return the snapshot stored at the time): ' || count(*) FROM warehouse.packship_operations;
ROLLBACK;
SQL
  ;;
*) echo "usage: $0 rehearse|apply|verify|rollback"; exit 1 ;;
esac
