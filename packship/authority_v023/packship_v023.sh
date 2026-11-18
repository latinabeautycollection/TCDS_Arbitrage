#!/usr/bin/env bash
# Pack/Ship V0.2.3 (manualWeightApproval in the task snapshot) on PRODUCTION (vfxlrkqgakqqbnbbgecp). Replaces one
# internal function, warehouse.packship__snapshot (same signature, owner and grants), built on the 912 version.
# No table or grant changes.
#   rehearse  916 + V0.2 (911) + V0.2.1 (913) + V0.2.2 (915) + V0.2.3 (917) in ONE transaction, then ROLLBACK.
#   apply     CONFIRM=APPLY-PACKSHIP-V023: 916 only, COMMIT. Before the route update (the mapper reads the new key).
#   verify    read only: snapshot version marker, owner/ACL, API role still has no table access.
#   rollback  CONFIRM=ROLLBACK-PACKSHIP-V023: restore the exact 912 snapshot (916_rollback.sql), COMMIT.
# Pinned file hashes; prints no secrets.
# Usage: bash /tmp/domain6_scanner/packship_v023/packship_v023.sh rehearse|apply|verify|rollback
set -uo pipefail
D=$(cd "$(dirname "$0")" && pwd)
M=$D/916_packship_v023_snapshot.sql; RB=$D/916_rollback.sql
T1=$D/911_packship_v02_tests.sql; T2=$D/913_packship_v021_tests.sql; T3=$D/915_packship_v022_tests.sql; T4=$D/917_packship_v023_tests.sql
( cd "$D" && sha256sum -c --quiet - ) <<'SUMS' || { echo "file hash mismatch - stopping"; exit 1; }
8e20eef1abc796331e7d9f9728abbb75ddcb80abc276a152597c30bb91c56cf7  916_packship_v023_snapshot.sql
3f65e6c635ff43d83c48f20a7a73152870e5b36e5ad11a4b7504ea47a4b37f16  916_rollback.sql
85194c0e5226d537c51efea262e3c428500b3e7ce4873230310fdfddc6322ab0  911_packship_v02_tests.sql
8c85996231a1191d221c5d41094b239c0161a234b22f60cceead1dfd8c9bdb2d  913_packship_v021_tests.sql
d151a049cb9ff650b3218699718193ab5b6d0851b092e91a53007fc8a0775dc4  915_packship_v022_tests.sql
e917e84d800bc206f549b819b612acdc61619e21160c8646af12022987c7d460  917_packship_v023_tests.sql
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
  { echo "$HDR"; cat "$M" "$T1" "$T2" "$T3" "$T4"; echo "ROLLBACK;"; } | "${PSQL[@]}" 2>&1 | grep -v -E '^NOTICE:  (relation|role|type) .* (already exists|does not exist)'
  rc=${PIPESTATUS[1]}
  [ "$rc" -eq 0 ] && echo "rehearse finished (ROLLBACK) rc=0" || echo "rehearse FAILED rc=$rc - nothing was kept"
  exit "$rc" ;;
apply)
  [ "${CONFIRM:-}" = "APPLY-PACKSHIP-V023" ] || { echo "set CONFIRM=APPLY-PACKSHIP-V023"; exit 1; }
  echo "target: production, mode=apply"
  { echo "$HDR"; cat "$M"; echo "COMMIT;"; } | "${PSQL[@]}" 2>&1
  rc=${PIPESTATUS[1]}
  [ "$rc" -eq 0 ] && echo "apply COMMITTED" || echo "apply FAILED rc=$rc - nothing was committed"
  exit "$rc" ;;
rollback)
  [ "${CONFIRM:-}" = "ROLLBACK-PACKSHIP-V023" ] || { echo "set CONFIRM=ROLLBACK-PACKSHIP-V023"; exit 1; }
  echo "target: production, mode=rollback (restore 912 snapshot)"
  { echo "$HDR"; cat "$RB"; echo "COMMIT;"; } | "${PSQL[@]}" 2>&1
  rc=${PIPESTATUS[1]}
  [ "$rc" -eq 0 ] && echo "rollback COMMITTED" || echo "rollback FAILED rc=$rc - nothing was committed"
  exit "$rc" ;;
verify)
  "${PSQL[@]}" <<'SQL'
BEGIN READ ONLY;
SELECT 'packship__snapshot: ' || CASE md5(prosrc) WHEN '441a9f5980b0c94bc03ad6bac1ef0139' THEN 'V0.2.3 (manualWeightApproval)'
         WHEN 'a51baa49f4b6af575571dcf74371a23f' THEN 'V0.2.1 (916 not applied)' ELSE 'UNKNOWN VERSION' END
       || ' owner=' || pg_get_userbyid(proowner) || ' acl=' || coalesce(proacl::text, 'default')
  FROM pg_proc WHERE oid = 'warehouse.packship__snapshot(uuid, warehouse.packship_actor_t)'::regprocedure;
SELECT 'select_package still V0.2.2: ' || (md5(prosrc) = '08f30f8c6db4973660958d7c3d7e8b52')
  FROM pg_proc WHERE oid = 'warehouse.packship_select_package_v2(uuid, uuid, bigint, uuid, text, text, uuid, uuid)'::regprocedure;
SELECT 'api role packing_override_decisions SELECT (expect false): ' || has_table_privilege('tcds_packship_api', 'warehouse.packing_override_decisions', 'SELECT');
ROLLBACK;
SQL
  ;;
*) echo "usage: $0 rehearse|apply|verify|rollback"; exit 1 ;;
esac
