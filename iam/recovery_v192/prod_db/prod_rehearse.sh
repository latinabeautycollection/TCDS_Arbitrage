#!/usr/bin/env bash
# PRODUCTION rollout of the warehouse password-recovery database chain (TCDS 603-645).
#   preflight          read-only: package hashes, production project, nothing installed yet, memberships, connections;
#                      saves staging's catalog fingerprint
#   rehearse           CONFIRM=REHEARSE-ON-PROD   ONE txn: chain -> compare with staging -> ROLLBACK (nothing kept)
#   rollback-rehearse  CONFIRM=REHEARSE-ROLLBACK  ONE txn: chain -> every rollback in reverse (645..603) -> production must
#                      equal its starting state exactly (catalog + seeded role rows) -> ROLLBACK (nothing kept)
#   install            CONFIRM=INSTALL-ON-PROD    ONE txn: chain -> staging comparison INSIDE the txn -> COMMIT only if it
#                      passes, otherwise ROLLBACK. Saves the before-state for uninstall.
#   uninstall          CONFIRM=UNINSTALL-ON-PROD  ONE txn: every rollback in reverse -> must equal the saved before-state
#                      -> COMMIT only if identical. Refuses once real data exists (approvals, passkeys, enrolled emails).
#   status             read-only: which parts are installed
# Chain (staging order): 603+603a | 616 | V1.5 604,604a,608,610,612,614,617 + 620 | 618 | 621 | 622 | 623 |
#   v13_pre+624+625+v13_post | 626 | 628 | 630 | 644_pre,634,635,637,640,641,644 | 645
# While a transaction is open it holds locks on users/employees/passkeys/auth_sessions/webauthn evidence: sign-ins wait
# (the 2026-11-24 rehearsal took 41 s). lock_timeout makes it stop instead of queueing behind anyone.
# Copy first (Mac): scp -r ~/Downloads/prod_recovery apifydev@139.177.200.80:/tmp/      Prints no secrets.
set -euo pipefail
PKG=/tmp/prod_recovery; OUT=$HOME/prod_rehearsal; PROD_REF=vfxlrkqgakqqbnbbgecp; STG_REF=kqcdqtazcqaawdkmcfed
mkdir -p "$OUT"; chmod 700 "$OUT"; umask 077
(cd "$PKG" && sha256sum -c --quiet sha.txt) || { echo "package files differ from the reviewed copy - stopping"; exit 1; }
cd /srv/arb-system/api
eval "$(grep -E '^(PGHOST|PGPORT|PGDATABASE|PGUSER|PGPASSWORD|PGSSLMODE)=' .env | sed -E "s/^([A-Z_]+)=(.*)$/export \1='\2'/")"
case "$PGHOST $PGUSER" in *"$PROD_REF"*) ;; *) echo ".env database is not production ($PROD_REF) - stopping"; exit 1;; esac
P_HOST=$PGHOST P_PORT=${PGPORT:-5432} P_USER=$PGUSER
pq() { PGHOST=$P_HOST PGPORT=$P_PORT PGUSER=$P_USER PAGER=cat psql -X -q -At -v ON_ERROR_STOP=1 "$@"; }
pro() { PGOPTIONS='-c default_transaction_read_only=on' pq "$@"; }
sro() { PGOPTIONS='-c default_transaction_read_only=on' PGHOST=db.$STG_REF.supabase.co PGPORT=5432 PGDATABASE=postgres PGUSER=postgres PAGER=cat psql -X -q -At -v ON_ERROR_STOP=1 "$@"; }
B=$OUT/body; mkdir -p "$B"
for f in "$PKG"/chain/*.sql "$PKG"/rollback/*.sql; do grep -vxE 'BEGIN;|COMMIT;' "$f" > "$B/$(basename "$f")"; done
# catalog query as a temp table: snap <name>  (+ <name>_roles: hash and count of warehouse_identity.roles rows)
CATQ=$(grep -v '^--' "$PKG/catalog.sql" | sed '$ s/;[[:space:]]*$//')
snap() { printf 'SET LOCAL search_path = pg_catalog, pg_temp;\nCREATE TEMP TABLE %s AS SELECT x AS line FROM (\n%s\n) q(x);\n' "$1" "$CATQ"
  printf "CREATE TEMP TABLE %s_roles AS SELECT md5(coalesce(string_agg(r::text, '|' ORDER BY r.role_code),'')) AS h, count(*) AS n FROM warehouse_identity.roles r;\nRESET search_path;\n" "$1"; }
MARKERS="SELECT concat_ws(' ', 'enterprise_org='||(to_regclass('enterprise_org.leadership_people') IS NOT NULL),
  'contacts='||(to_regclass('warehouse_identity.user_recovery_contacts') IS NOT NULL), 'epochs='||(to_regclass('warehouse_identity.iam_session_epochs_v15') IS NOT NULL),
  'central='||(to_regclass('warehouse_identity.central_passkeys') IS NOT NULL), 'v192='||(to_regclass('warehouse_identity.recovery_v192_ledger') IS NOT NULL),
  'v645='||(to_regclass('warehouse_identity.recovery_contact_policy_v645') IS NOT NULL),
  'roles='||(SELECT count(*) FROM pg_roles WHERE rolname IN ('tcds_identity_central_verifier','tcds_identity_central_admin','tcds_eoc_binding_admin')))"
NONE="enterprise_org=false contacts=false epochs=false central=false v192=false v645=false roles=0"
ALL="enterprise_org=true contacts=true epochs=true central=true v192=true v645=true roles=3"

open_txn() { cat <<SQL
\\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout = '3s'; SET LOCAL statement_timeout = '60s'; SET LOCAL idle_in_transaction_session_timeout = '180s';
SELECT 'started '||clock_timestamp()::time(0);
SQL
}
chain_sql() { cat <<SQL
\\echo == 603 + 603a leadership directory
\\i $B/enterprise_org_leadership_v0_3.sql
\\i $B/enterprise_org_leadership_v0_3a_fixes.sql
RESET search_path;
\\echo == 616 read-only preflight
\\i $B/616_recovery_v14_readonly_preflight.sql
RESET search_path;
\\echo == V1.5 604 604a 608 610 612 614 617 + 620
SET LOCAL search_path = pg_catalog, pg_temp;
\\i $B/604_iam_recovery_contacts_and_challenges.sql
\\i $B/604a_iam_recovery_scoped_runtime.sql
\\i $B/608_recovery_v1_1_security_addendum.sql
\\i $B/610_recovery_v1_2_strict_verification.sql
\\i $B/612_recovery_v1_3_state_and_receipt_repair.sql
\\i $B/614_recovery_v14_account_binding_and_rate_limits.sql
\\i $B/617_iam_session_epochs_v15.sql
SET LOCAL search_path = pg_catalog, pg_temp;
\\i $B/620_recovery_v15_privileged_interface.sql
\\echo == 618 certification
\\i $B/618_recovery_v15_readonly_certification.sql
RESET search_path;
\\echo == 621 reset guard
\\i $B/621_recovery_v15_reset_guard.sql
RESET search_path;
\\echo == 622 session epoch events
\\i $B/622_iam_session_epoch_events.sql
RESET search_path;
\\echo == 623 EOC bridge
\\i $B/623_eoc_iam_bridge.sql
RESET search_path;
\\echo == 624 + 625 (v13 wrapper)
SET LOCAL lock_timeout = '3s';
\\i $B/v13_pre.sql
\\i $B/624_eoc_governed_binding_approvals_v13.sql
\\i $B/625_eoc_bridge_retention_v13.sql
\\i $B/v13_post.sql
RESET search_path;
\\echo == 626 central passkeys
\\i $B/626_central_passkey_ceremony.sql
RESET search_path;
\\echo == 628 central binding approval
\\i $B/628_central_binding_approval.sql
RESET search_path;
\\echo == 630 central grant approval
\\i $B/630_central_grant_approval.sql
RESET search_path;
\\echo == V1.9.2 644_pre 634 635 637 640 641 644
\\i $B/644_pre_install_ledger.sql
\\i $B/634_recovery_runtime_v18_STAGING_ONLY.sql
\\i $B/635_strict_otp_first_gate_STAGING_ONLY.sql
\\i $B/637_recovery_runtime_hardening_STAGING_ONLY.sql
\\i $B/640_browser_bound_otp_claim_STAGING_ONLY.sql
\\i $B/641_issuance_retry_state_STAGING_ONLY.sql
\\i $B/644_recovery_v192_runtime_interface.sql
SET LOCAL search_path = pg_catalog, pg_temp;
SELECT 'self-check 644: functions='||count(*)||' secure='||bool_and(p.prosecdef AND pg_get_userbyid(p.proowner)='tcds_identity_function_owner'
  AND has_function_privilege('tcds_login_api',p.oid,'EXECUTE') AND NOT has_function_privilege('anon',p.oid,'EXECUTE'))
 FROM pg_proc p WHERE p.pronamespace='warehouse_identity'::regnamespace AND p.proname LIKE 'recovery\\_%\\_v192';
RESET search_path;
\\echo == 645 recovery-email enrollment
\\i $B/645_recovery_contact_enrollment.sql
SET LOCAL search_path = pg_catalog, pg_temp;
SELECT 'self-check 645: functions='||count(*)||' secure='||bool_and(p.prosecdef AND pg_get_userbyid(p.proowner)='tcds_identity_function_owner'
  AND NOT has_function_privilege('anon',p.oid,'EXECUTE'))
 FROM pg_proc p WHERE p.pronamespace='warehouse_identity'::regnamespace AND (p.proname LIKE 'recovery\\_%\\_v645' OR p.proname LIKE 'central\\_%\\_v645');
SELECT 'seeded approver roles: '||string_agg(role_code,', ' ORDER BY role_code) FROM warehouse_identity.roles
 WHERE role_code IN ('EOC_IDENTITY_BINDING_APPROVER','EOC_MODULE_GRANT_APPROVER','IAM_RECOVERY_DESTINATION_APPROVER');
RESET search_path;
SQL
}
rollback_sql() { cat <<SQL
\\echo == rollback 645
\\i $B/645_rollback.sql
RESET search_path;
\\echo == rollback 644 (whole V1.9.2 bundle, restores the 621 guard)
\\i $B/644_rollback_full.sql
RESET search_path;
\\echo == rollback 630
\\i $B/630_rollback.sql
RESET search_path;
\\echo == rollback 628
\\i $B/628_rollback.sql
RESET search_path;
\\echo == rollback 626
\\i $B/626_rollback.sql
RESET search_path;
\\echo == rollback 624 + 625
\\i $B/v13_rollback.sql
RESET search_path;
\\echo == rollback 623
\\i $B/623_eoc_iam_bridge.rollback.sql
RESET search_path;
\\echo == rollback 622
\\i $B/622_iam_session_epoch_events.rollback.sql
RESET search_path;
\\echo == rollback 621
\\i $B/621_recovery_v15_reset_guard.rollback.sql
RESET search_path;
\\echo == rollback 620 + V1.5 (619)
SET LOCAL search_path = pg_catalog, pg_temp;
\\i $B/620_recovery_v15_privileged_interface.rollback.sql
SET LOCAL search_path = pg_catalog, pg_temp;
\\i $B/619_recovery_v15_full_staging_rollback.sql
RESET search_path;
\\echo == rollback 603 + 603a
\\i $B/603_enterprise_org_leadership.rollback.sql
RESET search_path;
SQL
}
# Gate inside the session: staging (stg), before (p0), after (p1). Sets gate_ok / gate_n.
gate_sql() { cat <<SQL
SET LOCAL search_path = pg_catalog, pg_temp;
CREATE TEMP TABLE stg(line text);
\\copy stg FROM '$OUT/staging.cat'
CREATE TEMP VIEW gk AS
 WITH s AS (SELECT split_part(line,'|',1)||'|'||split_part(line,'|',2) k, split_part(line,'|',3) h FROM stg),
      a AS (SELECT split_part(line,'|',1)||'|'||split_part(line,'|',2) k, split_part(line,'|',3) h FROM p0),
      b AS (SELECT split_part(line,'|',1)||'|'||split_part(line,'|',2) k, split_part(line,'|',3) h FROM p1)
 SELECT 'MISSING-ON-PROD|'||s.k AS p FROM s WHERE s.k NOT LIKE '%tcds_login_central%' AND NOT EXISTS (SELECT 1 FROM b WHERE b.k=s.k)
 UNION ALL SELECT 'DIFFERS|'||s.k FROM s JOIN b USING (k) WHERE s.k NOT LIKE '%tcds_login_central%' AND s.h<>b.h
   AND NOT EXISTS (SELECT 1 FROM a WHERE a.k=s.k AND a.h=b.h)
 UNION ALL SELECT 'REMOVED-FROM-PROD|'||a.k FROM a WHERE NOT EXISTS (SELECT 1 FROM b WHERE b.k=a.k)
 UNION ALL SELECT 'CHANGED-PROD-ONLY|'||a.k FROM a JOIN b USING (k) WHERE a.h<>b.h AND NOT EXISTS (SELECT 1 FROM s WHERE s.k=a.k)
 UNION ALL SELECT 'EXTRA-NOT-ON-STAGING|'||b.k FROM b WHERE NOT EXISTS (SELECT 1 FROM a WHERE a.k=b.k) AND NOT EXISTS (SELECT 1 FROM s WHERE s.k=b.k);
SELECT count(*) = 0 AS gate_ok, count(*) AS gate_n FROM gk \\gset
\\copy (SELECT p FROM gk ORDER BY 1) TO '$OUT/gate.txt'
\\copy (SELECT line FROM p0 ORDER BY 1) TO '$OUT/p0.cat'
\\copy (SELECT line FROM p1 ORDER BY 1) TO '$OUT/p1.cat'
SELECT 'staging comparison: '||:gate_n||' problems | transaction open '||round(extract(epoch FROM clock_timestamp()-xact_start)::numeric,1)||'s'
  FROM pg_stat_activity WHERE pid=pg_backend_pid();
RESET search_path;
SQL
}
# Exact equality between two snapshots (catalog lines + role rows). Sets same_ok / same_n.
same_sql() { cat <<SQL
SET LOCAL search_path = pg_catalog, pg_temp;
CREATE TEMP VIEW sd AS
 (SELECT 'ONLY-BEFORE|'||line AS d FROM $1 EXCEPT SELECT 'ONLY-BEFORE|'||line FROM $2)
 UNION ALL (SELECT 'ONLY-AFTER|'||line FROM $2 EXCEPT SELECT 'ONLY-AFTER|'||line FROM $1)
 UNION ALL SELECT 'ROLE-ROWS-DIFFER|warehouse_identity.roles|'||x.n||'->'||y.n FROM ${1}_roles x, ${2}_roles y WHERE x.h<>y.h;
SELECT count(*) = 0 AS same_ok, count(*) AS same_n FROM sd \\gset
\\copy (SELECT split_part(d,'|',1)||'|'||split_part(d,'|',2)||'|'||split_part(d,'|',3) FROM sd ORDER BY 1) TO '$OUT/same.txt'
SELECT 'equal to the starting state: '||:'same_ok'||' ('||:same_n||' differences) | transaction open '
  ||round(extract(epoch FROM clock_timestamp()-xact_start)::numeric,1)||'s' FROM pg_stat_activity WHERE pid=pg_backend_pid();
RESET search_path;
SQL
}
run() { set +e; pq -f "$1" > "$OUT/run.log" 2>&1; RC=$?; set -e
  grep -vE '^\s*$' "$OUT/run.log" | grep -E '^(==|started|ROLLED|COMMITTED|NOT COMMITTED|self-check|seeded|staging comparison|equal to)|ERROR|FATAL' | sed 's/^/   /' | head -80 || true; }
show_gate() { if [ -s "$OUT/gate.txt" ]; then echo "   !! $(wc -l < "$OUT/gate.txt") problems:"; cut -d'|' -f1-3 "$OUT/gate.txt" | sed -E 's/\(.*\)$/()/; s/^/      /' | head -80; fi; }
need() { [ "${CONFIRM:-}" = "$1" ] || { echo "set CONFIRM=$1"; exit 1; }; }
fresh() { echo "== production now (fresh session): $(pro -c "$MARKERS")"; }

case "${1:-}" in
status) fresh
  [ -f "$OUT/before_install.cat" ] && echo "   saved before-install state: $(wc -l < "$OUT/before_install.cat") entries" || echo "   no saved before-install state" ;;

preflight)
  echo "== production (read-only)"
  echo "   $(pro -c "SELECT split_part(version(),' ',2)||' | '||pg_size_pretty(pg_database_size(current_database()))||' | read_only='||current_setting('transaction_read_only')")"
  M=$(pro -c "$MARKERS"); echo "   chain objects present: $M"
  [ "$M" = "$NONE" ] && echo "   ok nothing from the chain is installed yet" || echo "   !! something from the chain already exists - stop and review"
  echo "   postgres membership in the function owner: $(pro -c "SELECT coalesce(string_agg('inherit='||inherit_option||' set='||set_option||' grantor='||pg_get_userbyid(grantor),'; '),'none') FROM pg_auth_members WHERE roleid='tcds_identity_function_owner'::regrole AND member='postgres'::regrole")"
  echo "   connections now: $(pro -c "SELECT coalesce(string_agg(usename||'='||n,', ' ORDER BY usename),'-') FROM (SELECT usename, count(*) n FROM pg_stat_activity WHERE datname=current_database() AND usename IS NOT NULL GROUP BY 1) x")"
  echo "   open transactions older than 10s: $(pro -c "SELECT count(*) FROM pg_stat_activity WHERE xact_start < now()-interval '10 seconds' AND pid<>pg_backend_pid() AND datname=current_database()")"
  echo "   warehouse sign-ins in the last 15 min: $(pro -c "SELECT count(*) FROM warehouse_identity.auth_sessions WHERE issued_at > now()-interval '15 minutes'" 2>/dev/null || echo '?')"
  # Same search_path as the in-transaction snapshots (snap), so names and definitions print identically.
  { echo "SET search_path = pg_catalog, pg_temp;"; cat "$PKG/catalog.sql"; } | sro -f - | sort > "$OUT/staging.cat"; echo "== staging catalog: $(wc -l < "$OUT/staging.cat") entries saved"
  echo "PREFLIGHT DONE (nothing changed)" ;;

rehearse|rollback-rehearse)
  if [ "$1" = rehearse ]; then need REHEARSE-ON-PROD; else need REHEARSE-ROLLBACK; fi
  [ -s "$OUT/staging.cat" ] || { echo "run preflight first"; exit 1; }
  [ "$(pro -c "$MARKERS")" = "$NONE" ] || { echo "chain objects already present on production - stopping"; exit 1; }
  rm -f "$OUT/gate.txt" "$OUT/same.txt" "$OUT/p0.cat" "$OUT/p1.cat"
  { open_txn; snap p0; chain_sql; snap p1; gate_sql
    if [ "$1" = rollback-rehearse ]; then rollback_sql; snap p2; same_sql p0 p2; fi
    printf '%s\n' 'ROLLBACK;' '\echo ROLLED BACK'; } > "$OUT/$1.sql"
  echo "== $1 on production (one transaction, ROLLBACK)"; run "$OUT/$1.sql"
  M=$(pro -c "$MARKERS"); fresh
  [ "$M" = "$NONE" ] && echo "   ok production unchanged" || { echo "   !! PRODUCTION CHANGED - stop and report"; exit 1; }
  [ $RC = 0 ] || { echo "STOPPED at the step above (full log ~/prod_rehearsal/run.log) - nothing was kept"; exit 1; }
  show_gate
  if [ "$1" = rollback-rehearse ]; then
    if [ -s "$OUT/same.txt" ]; then echo "   !! rollback left differences:"; sed 's/^/      /' "$OUT/same.txt" | head -60; echo "ROLLBACK REHEARSAL: NOT CLEAN (nothing was kept)"; exit 1; fi
    [ -s "$OUT/gate.txt" ] && { echo "ROLLBACK REHEARSAL: rollback clean, but the staging comparison failed"; exit 1; }
    echo "ROLLBACK REHEARSAL PASSED: install == staging, and the rollbacks returned production exactly to its starting state (nothing was kept)"
  else
    [ -s "$OUT/gate.txt" ] && { echo "REHEARSAL RAN, GATE NOT MET (nothing was kept)"; exit 1; }
    echo "REHEARSAL PASSED (nothing was kept)"
  fi ;;

install)
  need INSTALL-ON-PROD
  [ -s "$OUT/staging.cat" ] || { echo "run preflight first"; exit 1; }
  [ "$(pro -c "$MARKERS")" = "$NONE" ] || { echo "chain objects already present on production - stopping"; exit 1; }
  rm -f "$OUT/gate.txt" "$OUT/p0.cat" "$OUT/p1.cat" "$OUT"/before_install.*.tmp
  { open_txn; snap p0; chain_sql; snap p1; gate_sql
    cat <<SQL
\\copy (SELECT line FROM p0 ORDER BY 1) TO '$OUT/before_install.cat.tmp'
\\copy (SELECT h||'|'||n FROM p0_roles) TO '$OUT/before_install.roles.tmp'
\\if :gate_ok
COMMIT;
\\echo COMMITTED
\\else
ROLLBACK;
\\echo NOT COMMITTED - staging comparison failed, rolled back
\\endif
SQL
  } > "$OUT/install.sql"
  echo "== INSTALL on production (one transaction; commits only if it matches staging)"; run "$OUT/install.sql"
  M=$(pro -c "$MARKERS"); fresh
  if [ "$M" = "$ALL" ] && grep -q '^COMMITTED' "$OUT/run.log"; then
    mv "$OUT/before_install.cat.tmp" "$OUT/before_install.cat"; mv "$OUT/before_install.roles.tmp" "$OUT/before_install.roles"
    echo "INSTALLED ON PRODUCTION (before-state saved for uninstall: ~/prod_rehearsal/before_install.cat)"
  elif [ "$M" = "$NONE" ]; then rm -f "$OUT"/before_install.*.tmp; show_gate; echo "NOT INSTALLED - production unchanged (log ~/prod_rehearsal/run.log)"; exit 1
  else echo "!! UNEXPECTED STATE: $M - stop and report"; exit 1; fi ;;

uninstall)
  need UNINSTALL-ON-PROD
  [ -s "$OUT/before_install.cat" ] || { echo "no saved before-install state - stopping"; exit 1; }
  [ "$(pro -c "$MARKERS")" = "$ALL" ] || { echo "chain is not fully installed - stopping"; exit 1; }
  rm -f "$OUT/same.txt"
  { open_txn
    cat <<SQL
SET LOCAL search_path = pg_catalog, pg_temp;
CREATE TEMP TABLE pb(line text);
\\copy pb FROM '$OUT/before_install.cat'
CREATE TEMP TABLE pb_r(v text);
\\copy pb_r FROM '$OUT/before_install.roles'
CREATE TEMP TABLE pb_roles AS SELECT split_part(v,'|',1) AS h, split_part(v,'|',2)::bigint AS n FROM pb_r;
RESET search_path;
SQL
    rollback_sql; snap pu; same_sql pb pu
    cat <<SQL
\\if :same_ok
COMMIT;
\\echo COMMITTED
\\else
ROLLBACK;
\\echo NOT COMMITTED - result differs from the saved before-state, rolled back
\\endif
SQL
  } > "$OUT/uninstall.sql"
  echo "== UNINSTALL on production (one transaction; commits only if production returns to the saved before-state)"; run "$OUT/uninstall.sql"
  fresh; if [ -s "$OUT/same.txt" ]; then sed 's/^/      /' "$OUT/same.txt" | head -40; fi ;;

*) sed -n '2,18p' "$0"; exit 2 ;;
esac
