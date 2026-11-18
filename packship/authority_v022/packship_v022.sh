#!/usr/bin/env bash
# Pack/Ship V0.2.2 (eligible packaging) on PRODUCTION (vfxlrkqgakqqbnbbgecp). Adds the eligible-packaging list
# (warehouse.packship_list_packaging_options_v2, API role only) and makes packship_select_package_v2 enforce the same
# rule (same signature, owner and grants). No table changes.
#   rehearse  914 + the V0.2 suite (911) + V0.2.1 (913) + V0.2.2 (915) in ONE transaction, then ROLLBACK. Run first.
#   apply     CONFIRM=APPLY-PACKSHIP-V022: 914 only, COMMIT. Do this BEFORE the route update (the new GET needs it).
#   verify    read only: functions, owners/grants, select_package version, which profiles are in date.
#   rollback  CONFIRM=ROLLBACK-PACKSHIP-V022: restore the exact V0.2 select_package and drop the new functions.
#             Roll the routes back first (the GET would otherwise fail).
# Pinned file hashes; prints no secrets.
# Usage: bash /tmp/domain6_scanner/packship_v022/packship_v022.sh rehearse|apply|verify|rollback
set -uo pipefail
D=$(cd "$(dirname "$0")" && pwd)
M=$D/914_packship_v022_packaging.sql; RB=$D/914_rollback.sql
T1=$D/911_packship_v02_tests.sql; T2=$D/913_packship_v021_tests.sql; T3=$D/915_packship_v022_tests.sql
( cd "$D" && sha256sum -c --quiet - ) <<'SUMS' || { echo "file hash mismatch - stopping"; exit 1; }
f6efbf90ca8fab0dbdda2a191831bef40276aeb9ce94647b8b0ae8e2ae13f0f4  914_packship_v022_packaging.sql
376b68f8c9783014cdad4f4c7320cda303a055a1eb67f8528517e9f205c39db8  914_rollback.sql
85194c0e5226d537c51efea262e3c428500b3e7ce4873230310fdfddc6322ab0  911_packship_v02_tests.sql
8c85996231a1191d221c5d41094b239c0161a234b22f60cceead1dfd8c9bdb2d  913_packship_v021_tests.sql
d151a049cb9ff650b3218699718193ab5b6d0851b092e91a53007fc8a0775dc4  915_packship_v022_tests.sql
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
  { echo "$HDR"; cat "$M" "$T1" "$T2" "$T3"; echo "ROLLBACK;"; } | "${PSQL[@]}" 2>&1 | grep -v -E '^NOTICE:  (relation|role|type) .* (already exists|does not exist)'
  rc=${PIPESTATUS[1]}
  [ "$rc" -eq 0 ] && echo "rehearse finished (ROLLBACK) rc=0" || echo "rehearse FAILED rc=$rc - nothing was kept"
  exit "$rc" ;;
apply)
  [ "${CONFIRM:-}" = "APPLY-PACKSHIP-V022" ] || { echo "set CONFIRM=APPLY-PACKSHIP-V022"; exit 1; }
  echo "target: production, mode=apply"
  { echo "$HDR"; cat "$M"; echo "COMMIT;"; } | "${PSQL[@]}" 2>&1
  rc=${PIPESTATUS[1]}
  [ "$rc" -eq 0 ] && echo "apply COMMITTED" || echo "apply FAILED rc=$rc - nothing was committed"
  exit "$rc" ;;
rollback)
  [ "${CONFIRM:-}" = "ROLLBACK-PACKSHIP-V022" ] || { echo "set CONFIRM=ROLLBACK-PACKSHIP-V022"; exit 1; }
  echo "target: production, mode=rollback (restore V0.2 select_package)"
  { echo "$HDR"; cat "$RB"; echo "COMMIT;"; } | "${PSQL[@]}" 2>&1
  rc=${PIPESTATUS[1]}
  [ "$rc" -eq 0 ] && echo "rollback COMMITTED" || echo "rollback FAILED rc=$rc - nothing was committed"
  exit "$rc" ;;
verify)
  "${PSQL[@]}" <<'SQL'
BEGIN READ ONLY;
SELECT 'select_package: ' || CASE md5(prosrc) WHEN '08f30f8c6db4973660958d7c3d7e8b52' THEN 'V0.2.2 (eligibility enforced)'
         WHEN 'ee44a0d78a4a74fde4b3e70c32779f7d' THEN 'V0.2 (914 not applied)' ELSE 'UNKNOWN VERSION' END
       || ' owner=' || pg_get_userbyid(proowner) || ' acl=' || coalesce(proacl::text, 'default')
  FROM pg_proc WHERE oid = 'warehouse.packship_select_package_v2(uuid, uuid, bigint, uuid, text, text, uuid, uuid)'::regprocedure;
SELECT 'list_packaging_options_v2: ' || CASE WHEN to_regprocedure('warehouse.packship_list_packaging_options_v2(uuid, uuid)') IS NULL
         THEN 'missing' ELSE 'present api=' || has_function_privilege('tcds_packship_api', 'warehouse.packship_list_packaging_options_v2(uuid, uuid)', 'EXECUTE')
         || ' anon=' || has_function_privilege('anon', 'warehouse.packship_list_packaging_options_v2(uuid, uuid)', 'EXECUTE')
         || ' service_role=' || has_function_privilege('service_role', 'warehouse.packship_list_packaging_options_v2(uuid, uuid)', 'EXECUTE') END;
SELECT 'helpers present: ' || count(*) || ' (expect 2)' FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'warehouse' AND p.proname IN ('packship__packaging_basis', 'packship__eligible_profiles');
SELECT 'api role packaging_profiles SELECT (expect false): ' || has_table_privilege('tcds_packship_api', 'warehouse.packaging_profiles', 'SELECT');
SELECT 'in-date profiles: ' || coalesce(string_agg(profile_code || ' v' || version
         || coalesce(' max ' || maximum_weight_oz || 'oz', '') || coalesce(' cat ' || item_category_key, ''), ', ' ORDER BY profile_code), 'none')
  FROM warehouse.packaging_profiles WHERE active AND effective_at <= now() AND (expires_at IS NULL OR expires_at > now());
ROLLBACK;
SQL
  ;;
*) echo "usage: $0 rehearse|apply|verify|rollback"; exit 1 ;;
esac
