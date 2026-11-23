#!/usr/bin/env bash
# STAGING ONLY (kqcdqtazcqaawdkmcfed). Recovery-email enrollment (TCDS 645) on top of the installed 644.
#   status                                  read-only
#   install    CONFIRM=INSTALL-STG-645      saves a catalog snapshot, then ONE transaction: 645 -> self-check -> COMMIT
#   verify                                  read-only posture + the full 645 functional flow, ROLLED BACK
#   uninstall  CONFIRM=UNINSTALL-STG-645    ONE transaction: 645_rollback -> catalog must equal the saved snapshot -> COMMIT
#                                           only if identical (otherwise ROLLBACK, nothing changes)
#   commit     CONFIRM=COMMIT-645           adds the 645 files to iam/recovery_v192/ on develop, merges main --no-ff
#                                           (only if main has nothing develop lacks); no co-author trailer
# Needs /tmp/recov192 (sql/, sha.txt, flow645.sql, v192_645_rehearse.sh, this file, README.md). Prints no secrets.
set -euo pipefail
D=/tmp/recov192; STATE=$HOME/stg_login/recovery_v192; REPO=/srv/arb-system/api
mkdir -p "$STATE"; chmod 700 "$STATE"
(cd $D && sha256sum -c --quiet sha.txt) && echo "files: sha256 ok"

db() {
  cd /srv/arb-system/api
  eval "$(grep -E '^(PGHOST|PGPORT|PGDATABASE|PGUSER|PGPASSWORD|PGSSLMODE)=' .env | sed -E "s/^([A-Z_]+)=(.*)$/export \1='\2'/")"
  export PGHOST=db.kqcdqtazcqaawdkmcfed.supabase.co PGPORT=5432 PGDATABASE=postgres PGUSER=postgres
  [ "$PGHOST" = "db.kqcdqtazcqaawdkmcfed.supabase.co" ] || { echo "not the staging host - stopping"; exit 1; }
  rm -rf $D/body; mkdir -p $D/body
  for f in $D/sql/*.sql; do grep -vxE 'BEGIN;|COMMIT;' "$f" > "$D/body/$(basename "$f")"; done
  cp $D/flow645.sql $D/body/flow645.sql
  cat > $D/body/snap645.sql <<'SQL'
CREATE OR REPLACE FUNCTION pg_temp.snap() RETURNS SETOF text LANGUAGE sql AS $s$
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
SQL
}
q() { PAGER=cat psql -X -q -A -F ' | ' -v ON_ERROR_STOP=1 "$@" 2>&1 | grep -vE '^$' | sed -E 's/^psql:[^ ]+ (ERROR|NOTICE|WARNING): +/\1: /'; }
installed() { PAGER=cat psql -X -At -c "SELECT to_regclass('warehouse_identity.recovery_contact_enrollments_v645') IS NOT NULL"; }

case "${1:-}" in
status)
  db; echo "645 installed: $(installed)"
  [ "$(installed)" = t ] && PAGER=cat psql -X -At -F ' | ' <<'SQL'
SELECT 'policy: required_approvals='||required_approvals||' eligible_delay_minutes='||eligible_delay_minutes FROM warehouse_identity.recovery_contact_policy_v645;
SELECT 'enrollments: '||coalesce(string_agg(status||'='||n,', '),'none') FROM (SELECT status, count(*) n FROM warehouse_identity.recovery_contact_enrollments_v645 GROUP BY 1) s;
SELECT 'approvers: '||count(*) FROM warehouse_identity.user_role_assignments ra JOIN warehouse_identity.roles r ON r.role_id=ra.role_id
 WHERE r.role_code='IAM_RECOVERY_DESTINATION_APPROVER' AND ra.revoked_at IS NULL AND (ra.valid_until IS NULL OR ra.valid_until>now());
SQL
  [ -f "$STATE/catalog_before_645.txt" ] && echo "saved snapshot: $(wc -l < "$STATE/catalog_before_645.txt") entries" || echo "saved snapshot: none" ;;

install)
  [ "${CONFIRM:-}" = INSTALL-STG-645 ] || { echo "set CONFIRM=INSTALL-STG-645"; exit 1; }
  db; [ "$(installed)" = f ] || { echo "645 already installed - stopping"; exit 1; }
  [ "$(PAGER=cat psql -X -At -c "SELECT current_setting('default_transaction_read_only')")" = off ] || { echo "staging is read-only (disk protection?) - stopping"; exit 1; }
  echo "== saving catalog snapshot"
  PAGER=cat psql -X -q -At -v ON_ERROR_STOP=1 -f $D/body/snap645.sql -c "SELECT x FROM pg_temp.snap() x ORDER BY 1" > "$STATE/catalog_before_645.txt.tmp"
  mv "$STATE/catalog_before_645.txt.tmp" "$STATE/catalog_before_645.txt"; chmod 600 "$STATE/catalog_before_645.txt"
  echo "   $(wc -l < "$STATE/catalog_before_645.txt") entries"
  q <<SQL
BEGIN;
\\ir $D/body/645_recovery_contact_enrollment.sql
SET LOCAL search_path = pg_catalog, pg_temp;
SELECT 'self-check: v645 functions='||count(*)||' secure='||bool_and(p.prosecdef AND pg_get_userbyid(p.proowner)='tcds_identity_function_owner'
  AND NOT has_function_privilege('anon',p.oid,'EXECUTE')) AS check
 FROM pg_proc p WHERE p.pronamespace='warehouse_identity'::regnamespace AND (p.proname LIKE 'recovery\\_%\\_v645' OR p.proname LIKE 'central\\_%\\_v645');
COMMIT;
\\echo INSTALLED 645 ON STAGING (committed) - approver role assigned to nobody yet
SQL
  ;;

verify)
  db; [ "$(installed)" = t ] || { echo "645 not installed"; exit 1; }
  q <<SQL
\\pset footer off
BEGIN;
SET LOCAL search_path = pg_catalog, pg_temp;
SELECT 'functions='||count(*)||' definer='||bool_and(p.prosecdef)||' owner_ok='||bool_and(pg_get_userbyid(p.proowner)='tcds_identity_function_owner')
  ||' anon/public_exec='||bool_or(has_function_privilege('anon',p.oid,'EXECUTE') OR has_function_privilege('public',p.oid,'EXECUTE')) AS posture
 FROM pg_proc p WHERE p.pronamespace='warehouse_identity'::regnamespace AND (p.proname LIKE 'recovery\\_%\\_v645' OR p.proname LIKE 'central\\_%\\_v645');
\\echo == functional flow (rolled back)
\\ir $D/body/flow645.sql
ROLLBACK;
\\echo VERIFY DONE (rolled back, nothing changed)
SQL
  ;;

uninstall)
  [ "${CONFIRM:-}" = UNINSTALL-STG-645 ] || { echo "set CONFIRM=UNINSTALL-STG-645"; exit 1; }
  db; [ "$(installed)" = t ] || { echo "645 not installed"; exit 1; }
  [ -f "$STATE/catalog_before_645.txt" ] || { echo "no saved snapshot - stopping"; exit 1; }
  q <<SQL
\\pset footer off
BEGIN;
\\ir $D/body/645_rollback.sql
SET LOCAL search_path = pg_catalog, pg_temp;
\\ir $D/body/snap645.sql
CREATE TEMP TABLE snap_before(x text);
\\copy snap_before FROM '$STATE/catalog_before_645.txt' WITH (FORMAT csv, DELIMITER E'\\x01', QUOTE E'\\x02')
CREATE TEMP TABLE snap_after AS SELECT x FROM pg_temp.snap() x;
SELECT 'LEFT BEHIND + '||x AS diff FROM (SELECT x FROM snap_after EXCEPT SELECT x FROM snap_before) a
UNION ALL SELECT 'REMOVED     - '||x FROM (SELECT x FROM snap_before EXCEPT SELECT x FROM snap_after) b ORDER BY 1;
SELECT NOT EXISTS((SELECT x FROM snap_after EXCEPT SELECT x FROM snap_before) UNION ALL (SELECT x FROM snap_before EXCEPT SELECT x FROM snap_after)) AS identical \\gset
\\if :identical
COMMIT;
\\echo UNINSTALLED 645 - catalog identical to the saved snapshot (committed)
\\else
ROLLBACK;
\\echo !! catalog would differ from the snapshot - ROLLED BACK, nothing changed
\\endif
SQL
  ;;

commit)
  [ "${CONFIRM:-}" = COMMIT-645 ] || { echo "set CONFIRM=COMMIT-645"; exit 1; }
  FILES=(sql/645_recovery_contact_enrollment.sql sql/645_rollback.sql flow645.sql v192_645_rehearse.sh stg_645.sh sha.txt README.md)
  for f in "${FILES[@]}"; do [ -f "$D/$f" ] || { echo "missing $D/$f"; exit 1; }; done
  if grep -nIE "postgres(ql)?://[^:/ ]+:[^@ ]+@|PGPASSWORD=['\"]?[^'\"\$ ]{6,}|(SECRET|PEPPER|HASH_KEY|MASTER_KEY|PRIVATE_KEY)[A-Z_]*\s*[:=]\s*['\"][^'\"\$]{8,}" "${FILES[@]/#/$D/}"; then
    echo "possible secret above - stopping"; exit 1; fi
  cd "$REPO"; DEST=iam/recovery_v192
  [ "$(git rev-parse --abbrev-ref HEAD)" = develop ] || { echo "repo is not on develop - stopping"; exit 1; }
  [ -z "$(git status --porcelain --untracked-files=no)" ] || { echo "tracked files modified in the checkout - stopping"; exit 1; }
  git fetch -q origin; [ "$(git rev-list --count origin/develop..HEAD)" = 0 ] || { echo "local develop has unpushed commits - stopping"; exit 1; }
  git merge -q --ff-only origin/develop
  [ -d "$DEST/sql" ] || { echo "$DEST missing - stopping"; exit 1; }
  [ -e "$DEST/sql/645_recovery_contact_enrollment.sql" ] && { echo "645 already committed ($(git log --oneline -1 -- "$DEST/sql/645_recovery_contact_enrollment.sql"))"; exit 0; }
  BASE=$(git rev-parse HEAD)
  for f in "${FILES[@]}"; do mkdir -p "$DEST/$(dirname "$f")"; cp -p "$D/$f" "$DEST/$f"; git add -- "$DEST/$f"; done
  [ "$(git diff --cached --name-only | wc -l)" -le 7 ] || { git reset -q; echo "unexpected file set - stopping"; exit 1; }
  git commit -q -m "feat(iam): recovery-email enrollment (TCDS 645), staging rehearsal 27/27" -m "Employees add their own recovery email while signed in and confirm it with an emailed code; an approver then
approves it with a central passkey (login-stg ceremony, 626/628 pattern) before it can be used for a password reset.
Decided 2026-11-22: one approver (Anthony) for now - recovery_contact_policy_v645.required_approvals = 1; 2 later is
one UPDATE. The vendor recovery_destination_reviews_v11 table and its two-approver CHECK are untouched and unused.
- Role IAM_RECOVERY_DESTINATION_APPROVER (global assignment), enrollments + approvals tables, challenge purpose
  RECOVERY_CONTACT_APPROVAL; 12 SECURITY DEFINER functions: 6 for tcds_login_api (overview, start, code load/settle,
  cancel, pending id), 3 for tcds_identity_central_verifier (info, approval begin, finalize), 3 internal.
- Approval makes the email VERIFIED + eligible, revokes the user's other email contacts, writes a security event.
- The code email goes through the 644 delivery worker; at most 5 enrollment starts per user per 24 h.
Staging rehearsal: functional 27/27; full rollback catalog-identical twice (v192_645_rehearse.sh). Tool: stg_645.sh." -- "$DEST"
  git push -q origin develop; echo "develop: $(git log --oneline -1)"
  if [ -z "$(git diff --name-only "$BASE" origin/main)" ]; then
    rm -rf /tmp/wt-main-645; git worktree prune; git worktree add -q /tmp/wt-main-645 origin/main
    git -C /tmp/wt-main-645 merge --no-ff -q -m "Merge develop: recovery-email enrollment (TCDS 645)" origin/develop
    git -C /tmp/wt-main-645 push -q origin HEAD:main; git worktree remove /tmp/wt-main-645; echo "main merged"
  else echo "!! main has file changes develop did not have - main left untouched"; git diff --name-only "$BASE" origin/main | head; fi
  git fetch -q origin; echo "develop=$(git rev-parse --short origin/develop) main=$(git rev-parse --short origin/main) branch=$(git rev-parse --abbrev-ref HEAD)" ;;
*) sed -n '2,12p' "$0"; exit 2 ;;
esac
