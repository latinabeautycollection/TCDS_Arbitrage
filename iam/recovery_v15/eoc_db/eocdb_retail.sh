#!/usr/bin/env bash
# EOC RETAIL STAGING ONLY. EOC 6.4 application schema (eoc_iam): Anthony's 064 -> 071 -> 072 UNCHANGED, wrapped by our
# Supabase PG17 corrections (eoc_v12_pre.sql / eoc_v12_post.sql), on the SEPARATE EOC staging project
# crydmokyojaynmrtxkym (no Warehouse tables), per the dev team's V1.3 separation rule. Same steps as stg_eoc_db.sh.
#   inspect       read only: server version, postgres role attributes, existing eoc_* roles/schema, default privileges
#   rehearse      one transaction: snapshot -> install -> full test -> rollback -> snapshot must be identical -> ROLLBACK
#   install       apply pre + 064 + 071 + 072 + post on staging (one transaction, self-verifying)
#   test          full role-by-role test inside a transaction that is rolled back (+ login checks if bind-login ran)
#   bind-login    create the staging EOC backend login eoc_iam_bff_stg (member of eoc_app_runtime only); password
#                 generated here, stored as a SCRAM verifier, written to ~/stg_login/eoc_db.env (never printed)
#   unbind-login  drop that login (CONFIRM=UNBIND-EOC-LOGIN)
#   uninstall     eoc_v12_rollback.sql (CONFIRM=UNINSTALL-EOC-DB); refuses while any EOC row exists
# Needs /tmp/recov15/eoc_db/*. Usage: bash /tmp/recov15/eoc_db/stg_eoc_db.sh <cmd>
set -euo pipefail
cd /srv/arb-system/api
eval "$(grep -E '^(PGPASSWORD|PGSSLMODE)=' .env | sed -E "s/^([A-Z_]+)=(.*)$/export \1='\2'/")"
export PGHOST=db.crydmokyojaynmrtxkym.supabase.co PGPORT=5432 PGDATABASE=postgres PGUSER=postgres PGCONNECT_TIMEOUT=10
[ "$PGHOST" = "db.crydmokyojaynmrtxkym.supabase.co" ] || { echo "not the EOC staging host - stopping"; exit 1; }
# Separation guard: this database must never hold Warehouse identity tables.
[ -z "$(PAGER=cat psql -X -At -c "SELECT 1 WHERE to_regnamespace('warehouse_identity') IS NOT NULL")" ] || { echo "warehouse_identity found - wrong database, stopping"; exit 1; }
D=/tmp/recov15/eoc_db
S=$HOME/stg_login
ENVF=$S/eoc_retail_db.env
LOGIN=eoc_iam_bff_stg
umask 077
q() { PAGER=cat psql -X -At -v ON_ERROR_STOP=1 "$@"; }
installed() { [ -n "$(q -c "SELECT to_regnamespace('eoc_iam')")" ]; }

# Anthony's files must be byte-identical to the package (sha256 from the V1.2 zip).
verify_vendor() {
  ( cd $D && sha256sum -c --quiet - ) <<'SUMS' || { echo "vendor 064/071/072 differ from the package - stopping"; exit 1; }
3f690fcd12ea3f9da7cbf9bae89052ae05b03ef4c4da186df0ed5e5a088f7108  064_eoc_iam_isolated.sql
6ee7e426d326fb736bf6caeed246c87b9b68190f7119af56303e2ed6b67c6066  071_eoc_runtime_v12_least_privilege.sql
d774698725ef5fadfecf580ed94630b750a4a0ba2a3f729aee8a26d915372840  072_eoc_governed_grants_v12.sql
SUMS
  echo "vendor 064/071/072 match the package"
}
body() { grep -vxE 'BEGIN;|COMMIT;' "$1"; }
compose() {
  verify_vendor
  { body $D/eoc_v12_pre.sql; body $D/064_eoc_iam_isolated.sql; body $D/071_eoc_runtime_v12_least_privilege.sql
    body $D/072_eoc_governed_grants_v12.sql; body $D/eoc_v12_post.sql; } > $D/install.body.sql
  { echo 'BEGIN;'; cat $D/install.body.sql; echo 'COMMIT;'; } > $D/install.composed.sql
  body $D/eoc_v12_rollback.sql > $D/rollback.body.sql
}
summary() { tee /dev/stderr | awk '/^PASS /{p++} /^FAIL /{f++} END{printf "== %d PASS, %d FAIL\n", p, f}' 1>&2; }

cat > $D/snap.sql <<'SQL'
CREATE OR REPLACE FUNCTION pg_temp.snap() RETURNS SETOF text LANGUAGE sql AS $s$
 SELECT 'role:'||rolname||':'||rolcanlogin||rolinherit||rolcreaterole||rolbypassrls FROM pg_roles
 UNION ALL SELECT 'member:'||pg_get_userbyid(roleid)||'>'||pg_get_userbyid(member)||' by '||pg_get_userbyid(grantor)
   ||':'||inherit_option||set_option||admin_option FROM pg_auth_members
 UNION ALL SELECT 'schema:'||nspname||':'||pg_get_userbyid(nspowner)||':'||coalesce(nspacl::text,'-') FROM pg_namespace
 UNION ALL SELECT 'defacl:'||pg_get_userbyid(defaclrole)||':'||defaclnamespace::regnamespace::text||':'||defaclobjtype::text||':'||defaclacl::text FROM pg_default_acl
 UNION ALL SELECT 'policy:'||schemaname||'.'||tablename||':'||policyname FROM pg_policies
$s$;
SQL

case "${1:-}" in
inspect)
  q -F ' | ' <<'SQL'
BEGIN READ ONLY;
SELECT 'server', current_setting('server_version');
SELECT 'postgres', 'createrole='||rolcreaterole||' bypassrls='||rolbypassrls||' superuser='||rolsuper FROM pg_roles WHERE rolname='postgres';
SELECT 'createrole_self_grant', coalesce(nullif(current_setting('createrole_self_grant',true),''),'(empty)');
SELECT 'eoc_iam schema present', (to_regnamespace('eoc_iam') IS NOT NULL)::text;
SELECT 'existing eoc role', rolname FROM pg_roles WHERE rolname LIKE 'eoc\_%' OR rolname LIKE 'iam\_eoc%' ORDER BY 2;
SELECT 'supabase api roles', string_agg(rolname, ',' ORDER BY rolname) FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role');
SELECT 'default_acl', pg_get_userbyid(defaclrole)||' in '||coalesce(nullif(defaclnamespace,0)::regnamespace::text,'(all schemas)')||' '||defaclobjtype::text||' '||defaclacl::text
  FROM pg_default_acl WHERE defaclnamespace = 0 OR pg_get_userbyid(defaclrole) = 'postgres' ORDER BY 2;
SELECT 'gen_random_uuid', p.oid::regprocedure::text FROM pg_proc p WHERE proname='gen_random_uuid' AND pronamespace='pg_catalog'::regnamespace;
ROLLBACK;
SQL
  psql --version
  echo "INSPECT DONE (read only)"
  ;;
rehearse)
  installed && { echo "eoc_iam already installed - rehearse runs only on a clean state"; exit 1; }
  compose
  q -q <<SQL 2>&1 | summary
BEGIN;
SET LOCAL search_path = pg_catalog, pg_temp;
\i $D/snap.sql
CREATE TEMP TABLE before ON COMMIT DROP AS SELECT x FROM pg_temp.snap() x;
\i $D/install.body.sql
\echo == pre + 064 + 071 + 072 + post installed and self-verified inside the rehearsal transaction
SAVEPOINT t;
\i $D/eoc_v12_test.sql
ROLLBACK TO SAVEPOINT t;
\i $D/rollback.body.sql
SET LOCAL search_path = pg_catalog, pg_temp;
\echo == rolled back inside the rehearsal transaction
SELECT 'missing_after_rollback | ' || x FROM (SELECT x FROM before EXCEPT SELECT x FROM pg_temp.snap() x) d;
SELECT 'extra_after_rollback | ' || x FROM (SELECT x FROM pg_temp.snap() x EXCEPT SELECT x FROM before) d;
SELECT 'catalog_identical=' || NOT EXISTS (SELECT x FROM before EXCEPT SELECT x FROM pg_temp.snap() x
                                         UNION ALL SELECT x FROM pg_temp.snap() x EXCEPT SELECT x FROM before);
ROLLBACK;
SQL
  echo "REHEARSAL DONE (nothing kept)"
  ;;
install)
  installed && { echo "eoc_iam already installed"; exit 1; }
  compose
  sha256sum $D/eoc_v12_pre.sql $D/eoc_v12_post.sql $D/eoc_v12_rollback.sql $D/install.composed.sql
  q -q -f $D/install.composed.sql
  q -F ' | ' -c "SELECT 'installed', p.proname, pg_get_userbyid(p.proowner) FROM pg_proc p WHERE p.pronamespace='eoc_iam'::regnamespace ORDER BY 2"
  echo "EOC DB (eoc_iam) INSTALLED ON EOC STAGING (crydmokyojaynmrtxkym) at $(date -u +%FT%TZ)"
  ;;
test)
  installed || { echo "eoc_iam not installed"; exit 1; }
  { printf 'BEGIN;\n\\i %s\nROLLBACK;\n' "$D/eoc_v12_test.sql" | q -q 2>&1
    if [ -f "$ENVF" ]; then
      echo "===== L. staging backend login ($LOGIN, from $ENVF)"
      lq() { ( . "$ENVF"; PGUSER="$EOC_DB_USER" PGPASSWORD="$EOC_DB_PASSWORD" PAGER=cat psql -X -At -v ON_ERROR_STOP=1 -c "$1" 2>&1 ) || true; }
      ck() { printf '%-6s%-77s%s\n' "$( [[ "$2" =~ $3 ]] && echo PASS || echo FAIL)" "$1" "$(echo "$2" | head -1)"; }
      ck "L1 login works, readiness probe (expect $LOGIN true)" "$(lq 'SELECT current_user || chr(32) || eoc_iam.db_ready_v12()')" "^$LOGIN true$"
      ck "L2 direct SELECT on eoc_iam.sessions (expect permission denied)" "$(lq 'SELECT 1 FROM eoc_iam.sessions LIMIT 1')" "permission denied"
      ck "L3 SET ROLE eoc_iam_executor (expect permission denied)" "$(lq 'SET ROLE eoc_iam_executor')" "permission denied"
      ck "L4 no Warehouse identity in this database (expect does not exist)" "$(lq 'SELECT count(*) FROM warehouse_identity.users')" "does not exist"
      ck "L5 no leadership directory in this database (expect does not exist)" "$(lq 'SELECT count(*) FROM enterprise_org.leadership_people')" "does not exist"
    else echo "(no $ENVF - login checks skipped; run bind-login first)"; fi
  } | summary
  echo "EOC DB TEST DONE (rolled back; nothing kept)"
  ;;
bind-login)
  installed || { echo "eoc_iam not installed"; exit 1; }
  [ -e "$ENVF" ] && { echo "$ENVF exists - already bound? (unbind-login first)"; exit 1; }
  [ -n "$(q -c "SELECT 1 FROM pg_roles WHERE rolname='$LOGIN'")" ] && { echo "role $LOGIN exists - stopping"; exit 1; }
  PW=$(openssl rand -hex 32)
  # SCRAM verifier computed here, so the plain password never reaches the server or its statement log.
  VER=$(PW="$PW" node -e 'const c=require("crypto"),pw=process.env.PW,salt=c.randomBytes(16),it=4096;
    const sp=c.pbkdf2Sync(pw,salt,it,32,"sha256"),h=(k,m)=>c.createHmac("sha256",k).update(m).digest();
    const stored=c.createHash("sha256").update(h(sp,"Client Key")).digest();
    process.stdout.write(`SCRAM-SHA-256$${it}:${salt.toString("base64")}$${stored.toString("base64")}:${h(sp,"Server Key").toString("base64")}`)')
  q -q -v ver="$VER" <<SQL
BEGIN;
CREATE ROLE $LOGIN LOGIN NOCREATEDB NOCREATEROLE NOBYPASSRLS CONNECTION LIMIT 10 PASSWORD :'ver';
GRANT eoc_app_runtime TO $LOGIN WITH INHERIT TRUE, SET FALSE;
ALTER ROLE $LOGIN SET statement_timeout = '5s';
ALTER ROLE $LOGIN SET search_path = pg_catalog;
COMMIT;
SQL
  printf 'EOC_DB_USER=%s\nEOC_DB_PASSWORD=%s\nEOC_DATABASE_URL=postgres://%s:%s@%s:5432/postgres?sslmode=require\n' \
    "$LOGIN" "$PW" "$LOGIN" "$PW" "$PGHOST" > "$ENVF"
  chmod 600 "$ENVF"; unset PW VER
  echo "LOGIN $LOGIN CREATED (member of eoc_app_runtime only); credentials in $ENVF (not printed)"
  ;;
unbind-login)
  [ "${CONFIRM:-}" = "UNBIND-EOC-LOGIN" ] || { echo "set CONFIRM=UNBIND-EOC-LOGIN"; exit 1; }
  q -q -c "DROP ROLE IF EXISTS $LOGIN"; rm -f "$ENVF"; echo "LOGIN $LOGIN DROPPED"
  ;;
uninstall)
  [ "${CONFIRM:-}" = "UNINSTALL-EOC-DB" ] || { echo "set CONFIRM=UNINSTALL-EOC-DB"; exit 1; }
  q -q -f $D/eoc_v12_rollback.sql; rm -f "$ENVF"; echo "EOC DB (eoc_iam) ROLLED BACK (login dropped too)"
  ;;
*) echo "usage: $0 inspect|rehearse|install|test|bind-login|unbind-login|uninstall"; exit 2;;
esac
