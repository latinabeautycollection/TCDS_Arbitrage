#!/usr/bin/env bash
# Warehouse Control capture-authority snapshot function (930) on PRODUCTION (vfxlrkqgakqqbnbbgecp).
# Adds one read-only function + role tcds_scanner_snapshot_api (granted to tcds_login_packship). No table changes.
#   rehearse  930 + 931 tests in ONE transaction, then ROLLBACK. Run first.
#   apply     CONFIRM=APPLY-CAPTURE-SNAPSHOT: 930 only, COMMIT.
#   verify    read only: function, grants, and what LV2TEST resolves to now (NOT_FOUND until the seed is applied).
#   rollback  CONFIRM=ROLLBACK-CAPTURE-SNAPSHOT: drop the function and the role.
# Pinned file hashes; prints no secrets.
# Usage: bash /tmp/domain6_scanner/capture_snapshot_v1/capture_snapshot_v1.sh rehearse|apply|verify|rollback
set -uo pipefail
D=$(cd "$(dirname "$0")" && pwd)
( cd "$D" && sha256sum -c --quiet - ) <<'SUMS' || { echo "file hash mismatch - stopping"; exit 1; }
7b5320a3535088551c4a8f3cf6f85cfd31396bbd895ac6c12e26fa06a30246ec  930_capture_snapshot_v1.sql
3f37e638e1aa3ddec4d06660cb3b57ac03eac71e1178e8921ceee82b2405669e  930_rollback.sql
31e093d0937da9a121974fc82eca3f4ff3ff2d6f86ecd396ca7e9a4cb4df21b7  931_capture_snapshot_v1_tests.sql
SUMS
cd /srv/arb-system/api || exit 1
eval "$(grep -E '^(PGHOST|PGPORT|PGDATABASE|PGUSER|PGPASSWORD|PGSSLMODE)=' .env | sed -E "s/^([A-Z_]+)=(.*)$/export \1='\2'/")"
case "${PGHOST:-}${PGUSER:-}" in *vfxlrkqgakqqbnbbgecp*) ;; *) echo "not the production database - stopping"; exit 1;; esac
PSQL=(psql -X -q -At -v ON_ERROR_STOP=1)
export PAGER=cat
HDR="BEGIN; SET LOCAL lock_timeout = '5s'; SET LOCAL statement_timeout = '60s';"

run() {  # $1 label, $2 end (COMMIT/ROLLBACK), files...
  local label=$1 end=$2; shift 2
  { echo "$HDR"; for f in "$@"; do cat "$D/$f"; done; echo "$end;"; } | "${PSQL[@]}" 2>&1 | grep -v -E '^NOTICE:  (relation|role|type) .* (already exists|does not exist)'
  local rc=${PIPESTATUS[1]}
  [ "$rc" -eq 0 ] && echo "$label finished ($end) rc=0" || echo "$label FAILED rc=$rc - nothing was kept"
  return "$rc"
}

case "${1:-}" in
rehearse) echo "target: production, mode=rehearse"; run rehearse ROLLBACK 930_capture_snapshot_v1.sql 931_capture_snapshot_v1_tests.sql ;;
apply)
  [ "${CONFIRM:-}" = "APPLY-CAPTURE-SNAPSHOT" ] || { echo "set CONFIRM=APPLY-CAPTURE-SNAPSHOT"; exit 1; }
  echo "target: production, mode=apply"; run apply COMMIT 930_capture_snapshot_v1.sql ;;
rollback)
  [ "${CONFIRM:-}" = "ROLLBACK-CAPTURE-SNAPSHOT" ] || { echo "set CONFIRM=ROLLBACK-CAPTURE-SNAPSHOT"; exit 1; }
  echo "target: production, mode=rollback"; run rollback COMMIT 930_rollback.sql ;;
verify)
  "${PSQL[@]}" <<'SQL'
BEGIN READ ONLY;
SELECT 'function: ' || coalesce((SELECT p.oid::regprocedure::text || ' owner=' || pg_get_userbyid(p.proowner) || ' acl=' || p.proacl::text
  FROM pg_proc p WHERE p.oid = to_regprocedure('warehouse_control.get_capture_authority_snapshot_v1(uuid,uuid)')), 'NOT INSTALLED');
SELECT 'tcds_login_packship can execute: ' || has_function_privilege('tcds_login_packship',
  'warehouse_control.get_capture_authority_snapshot_v1(uuid,uuid)', 'EXECUTE')
  WHERE to_regprocedure('warehouse_control.get_capture_authority_snapshot_v1(uuid,uuid)') IS NOT NULL;
SELECT 'LV2TEST facility default now: ' || warehouse_control.get_capture_authority_snapshot_v1(NULL, 'b1a24146-8493-4b45-9fac-0b78eb4497d5')::text
  WHERE to_regprocedure('warehouse_control.get_capture_authority_snapshot_v1(uuid,uuid)') IS NOT NULL;
ROLLBACK;
SQL
  ;;
*) echo "usage: $0 rehearse|apply|verify|rollback"; exit 2 ;;
esac
