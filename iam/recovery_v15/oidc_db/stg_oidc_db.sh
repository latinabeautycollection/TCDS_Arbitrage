#!/usr/bin/env bash
# CENTRAL OIDC ISSUER DATABASE, STAGING ONLY: separate database eoc_oidc on the EOC staging project crydmokyojaynmrtxkym
# (not the Warehouse DB, not the EOC database `postgres`). Vendor 001 -> 002 -> 003 UNCHANGED (sha-pinned), plus our
# oidc_post.sql (database-level lockdown + self-verify), our 001 rollback, and oidc_test.sql.
#   inspect      read only: server, whether eoc_oidc exists, existing roles
#   create-db    CONFIRM=CREATE-OIDC-DB: CREATE DATABASE eoc_oidc (empty) and lock PUBLIC out of it
#   rehearse     in eoc_oidc, one transaction: snapshot -> 001+002+003+post -> tests -> 003rb+002rb+001rb ->
#                snapshot must be identical -> ROLLBACK. Nothing is kept.
#   install      CONFIRM=INSTALL-OIDC-DB: 001+002+003+post, COMMIT
#   test         tests inside a rolled-back transaction (+ login checks if bind-login ran)
#   bind-login   create login eoc_oidc_issuer_stg (member of eoc_oidc_runtime only). Password generated HERE on the
#                Warehouse server (where the issuer runs), stored only as a SCRAM verifier in the DB and in
#                ~/stg_login/eoc_oidc_db.env (0600, never printed)
#   unbind-login CONFIRM=UNBIND-OIDC-LOGIN
#   uninstall    CONFIRM=UNINSTALL-OIDC-DB: vendor 003 + 002 rollbacks + our 001 rollback (refuses while rows exist)
#   drop-db      CONFIRM=DROP-OIDC-DB: drop the (empty) database; refuses while schema eoc_oidc exists
# Usage: bash /tmp/recov15/oidc_db/stg_oidc_db.sh <cmd>
set -euo pipefail
cd /srv/arb-system/api
eval "$(grep -E '^(PGPASSWORD|PGSSLMODE)=' .env | sed -E "s/^([A-Z_]+)=(.*)$/export \1='\2'/")"
export PGHOST=db.crydmokyojaynmrtxkym.supabase.co PGPORT=5432 PGUSER=postgres PGCONNECT_TIMEOUT=10 PAGER=cat
[ "$PGHOST" = "db.crydmokyojaynmrtxkym.supabase.co" ] || { echo "not the EOC staging host - stopping"; exit 1; }
D=/tmp/recov15/oidc_db
S=$HOME/stg_login
ENVF=$S/eoc_oidc_db.env
LOGIN=eoc_oidc_issuer_stg
umask 077
qp() { PGDATABASE=postgres psql -X -At -v ON_ERROR_STOP=1 "$@"; }
qo() { PGDATABASE=eoc_oidc psql -X -At -v ON_ERROR_STOP=1 "$@"; }
db_exists() { [ -n "$(qp -c "SELECT 1 FROM pg_database WHERE datname='eoc_oidc'")" ]; }
installed() { db_exists && [ -n "$(qo -c "SELECT to_regnamespace('eoc_oidc')")" ]; }

( cd $D && sha256sum -c --quiet - ) <<'SUMS' || { echo "vendor issuer SQL differs from the package - stopping"; exit 1; }
b53dbd28b433e860a67fe8a3e06aaea79d7cfe455df74bd84e4b6261594c6182  001_issuer_state.sql
b53bf66667f19b5badb041ef0c9371fda4d150d2687a9ee4ddf286c6c2d6661d  002_issuer_v11_hardening.rollback.sql
c94019410a4556c323bae5db4a22645040653af8c4567c68800c390167ef5533  002_issuer_v11_hardening.sql
382e4f68b81158420abbc0ab3c1e82f1500c8684cc46f4ccfb721e4544dbd842  003_issuer_audit_retention.rollback.sql
a5a9511a418ade2603a1fe0f7e3257216fbc35c8ba42ab60104261ea761792da  003_issuer_audit_retention.sql
SUMS
body() { grep -vxE 'BEGIN;|COMMIT;' "$1"; }
{ body $D/001_issuer_state.sql; body $D/002_issuer_v11_hardening.sql; body $D/003_issuer_audit_retention.sql; cat $D/oidc_post.sql; } > $D/install.body.sql
{ body $D/003_issuer_audit_retention.rollback.sql; body $D/002_issuer_v11_hardening.rollback.sql; cat $D/oidc_001_rollback.sql; } > $D/rollback.body.sql

cat > $D/snap.sql <<'SQL'
CREATE OR REPLACE FUNCTION pg_temp.snap() RETURNS SETOF text LANGUAGE sql AS $s$
 SELECT 'role:'||rolname||':'||rolcanlogin||rolinherit||rolcreaterole||rolbypassrls FROM pg_roles
 UNION ALL SELECT 'member:'||pg_get_userbyid(roleid)||'>'||pg_get_userbyid(member)||':'||inherit_option||set_option||admin_option FROM pg_auth_members
 UNION ALL SELECT 'schema:'||nspname||':'||pg_get_userbyid(nspowner)||':'||coalesce(nspacl::text,'-') FROM pg_namespace
 UNION ALL SELECT 'policy:'||schemaname||'.'||tablename||':'||policyname FROM pg_policies
 UNION ALL SELECT 'rel:'||c.oid::regclass::text||':'||c.relkind::text||':'||coalesce(c.relacl::text,'-') FROM pg_class c
   JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema','pg_toast') AND n.nspname NOT LIKE 'pg_temp%'
 UNION ALL SELECT 'db:'||datname||':'||coalesce(datacl::text,'-') FROM pg_database WHERE datname = 'eoc_oidc'
$s$;
SQL

case "${1:-}" in
inspect)
  qp <<'SQL'
BEGIN READ ONLY;
SELECT 'server ' || current_setting('server_version');
SELECT 'eoc_oidc database exists: ' || EXISTS (SELECT 1 FROM pg_database WHERE datname = 'eoc_oidc');
SELECT 'postgres createdb=' || rolcreatedb || ' bypassrls=' || rolbypassrls FROM pg_roles WHERE rolname = current_user;
SELECT 'existing roles: ' || coalesce(string_agg(rolname, ',' ORDER BY rolname), 'none') FROM pg_roles WHERE rolname LIKE 'eoc\_%';
ROLLBACK;
SQL
  echo "INSPECT DONE (read only)" ;;
create-db)
  [ "${CONFIRM:-}" = "CREATE-OIDC-DB" ] || { echo "set CONFIRM=CREATE-OIDC-DB"; exit 1; }
  db_exists && { echo "database eoc_oidc already exists"; exit 1; }
  qp -c "CREATE DATABASE eoc_oidc"
  qp -c "REVOKE CONNECT, TEMPORARY ON DATABASE eoc_oidc FROM PUBLIC"
  qp -c "SELECT 'created eoc_oidc acl=' || coalesce(datacl::text, '<default>') FROM pg_database WHERE datname = 'eoc_oidc'"
  echo "DATABASE eoc_oidc CREATED (empty, PUBLIC locked out)" ;;
rehearse)
  db_exists || { echo "run create-db first"; exit 1; }
  installed && { echo "already installed - rehearse runs only on a clean state"; exit 1; }
  qo -q <<SQL 2>&1
BEGIN;
SET LOCAL lock_timeout = '5s';
\i $D/snap.sql
CREATE TEMP TABLE before ON COMMIT DROP AS SELECT x FROM pg_temp.snap() x;
\i $D/install.body.sql
\echo == 001 + 002 + 003 + post installed and self-verified inside the rehearsal transaction
SAVEPOINT t;
\i $D/oidc_test.sql
ROLLBACK TO SAVEPOINT t;
\i $D/rollback.body.sql
\echo == vendor 003 + 002 rollbacks and our 001 rollback ran inside the rehearsal transaction
SELECT 'missing_after_rollback | ' || x FROM (SELECT x FROM before EXCEPT SELECT x FROM pg_temp.snap() x) d;
SELECT 'extra_after_rollback | ' || x FROM (SELECT x FROM pg_temp.snap() x EXCEPT SELECT x FROM before) d;
SELECT 'catalog_identical=' || NOT EXISTS (SELECT x FROM before EXCEPT SELECT x FROM pg_temp.snap() x
                                         UNION ALL SELECT x FROM pg_temp.snap() x EXCEPT SELECT x FROM before);
ROLLBACK;
SQL
  echo "REHEARSAL DONE (nothing kept)" ;;
install)
  [ "${CONFIRM:-}" = "INSTALL-OIDC-DB" ] || { echo "set CONFIRM=INSTALL-OIDC-DB"; exit 1; }
  installed && { echo "already installed"; exit 1; }
  { echo 'BEGIN;'; echo "SET LOCAL lock_timeout = '5s';"; cat $D/install.body.sql; echo 'COMMIT;'; } | qo -q
  echo "ISSUER DB (eoc_oidc) INSTALLED at $(date -u +%FT%TZ)" ;;
test)
  installed || { echo "not installed"; exit 1; }
  printf 'BEGIN;\n\\i %s\nROLLBACK;\n' "$D/oidc_test.sql" | qo -q 2>&1
  if [ -f "$ENVF" ]; then
    echo "===== L. issuer login ($LOGIN)"
    lq() { ( . "$ENVF"; PGUSER="$OIDC_DB_USER" PGPASSWORD="$OIDC_DB_PASSWORD" PGDATABASE="$1" psql -X -At -v ON_ERROR_STOP=1 -c "$2" 2>&1 ) | head -1 || true; }
    ck() { printf '%-5s %-78s %s\n' "$( [[ "$2" =~ $3 ]] && echo PASS || echo FAIL)" "$1" "$2"; }
    ck "L1 login to eoc_oidc as the issuer (expect $LOGIN)" "$(lq eoc_oidc 'SELECT current_user')" "^$LOGIN$"
    ck "L2 read artifacts table as the issuer (expect 0)" "$(lq eoc_oidc 'SELECT count(*) FROM eoc_oidc.artifacts')" "^0$"
    ck "L3 read security events (expect permission denied)" "$(lq eoc_oidc 'SELECT count(*) FROM eoc_oidc.issuer_security_events')" "permission denied"
    ck "L4 issuer login cannot read eoc_iam in the EOC database (expect denied)" "$(lq postgres 'SELECT count(*) FROM eoc_iam.sessions')" "permission denied|does not exist"
    ck "L5 issuer login cannot SET ROLE to the EOC runtime (expect denied)" "$(lq eoc_oidc 'SET ROLE eoc_app_runtime')" "permission denied|does not exist"
  else echo "(no $ENVF - login checks skipped; run bind-login first)"; fi ;;
bind-login)
  installed || { echo "not installed"; exit 1; }
  [ -e "$ENVF" ] && { echo "$ENVF exists - already bound?"; exit 1; }
  [ -n "$(qp -c "SELECT 1 FROM pg_roles WHERE rolname='$LOGIN'")" ] && { echo "role $LOGIN exists - stopping"; exit 1; }
  PW=$(openssl rand -hex 32)
  VER=$(PW="$PW" node -e 'const c=require("crypto"),pw=process.env.PW,salt=c.randomBytes(16),it=4096;
    const sp=c.pbkdf2Sync(pw,salt,it,32,"sha256"),h=(k,m)=>c.createHmac("sha256",k).update(m).digest();
    const stored=c.createHash("sha256").update(h(sp,"Client Key")).digest();
    process.stdout.write(`SCRAM-SHA-256$${it}:${salt.toString("base64")}$${stored.toString("base64")}:${h(sp,"Server Key").toString("base64")}`)')
  qo -q -v ver="$VER" <<SQL
BEGIN;
CREATE ROLE $LOGIN LOGIN NOCREATEDB NOCREATEROLE NOBYPASSRLS CONNECTION LIMIT 10 PASSWORD :'ver';
GRANT eoc_oidc_runtime TO $LOGIN WITH INHERIT TRUE, SET FALSE;
ALTER ROLE $LOGIN SET statement_timeout = '5s';
ALTER ROLE $LOGIN SET search_path = pg_catalog;
COMMIT;
SQL
  printf 'OIDC_DB_USER=%s\nOIDC_DB_PASSWORD=%s\nOIDC_DATABASE_URL=postgresql://%s:%s@%s:5432/eoc_oidc?sslmode=require\n' \
    "$LOGIN" "$PW" "$LOGIN" "$PW" "$PGHOST" > "$ENVF"
  chmod 600 "$ENVF"; unset PW VER
  echo "LOGIN $LOGIN CREATED (member of eoc_oidc_runtime only); credentials in $ENVF (not printed)" ;;
unbind-login)
  [ "${CONFIRM:-}" = "UNBIND-OIDC-LOGIN" ] || { echo "set CONFIRM=UNBIND-OIDC-LOGIN"; exit 1; }
  qp -q -c "DROP ROLE IF EXISTS $LOGIN"; [ -f "$ENVF" ] && shred -u "$ENVF"; echo "LOGIN $LOGIN DROPPED" ;;
uninstall)
  [ "${CONFIRM:-}" = "UNINSTALL-OIDC-DB" ] || { echo "set CONFIRM=UNINSTALL-OIDC-DB"; exit 1; }
  { echo 'BEGIN;'; cat $D/rollback.body.sql; echo 'COMMIT;'; } | qo -q
  echo "ISSUER DB SCHEMA ROLLED BACK (database eoc_oidc kept, empty)" ;;
drop-db)
  [ "${CONFIRM:-}" = "DROP-OIDC-DB" ] || { echo "set CONFIRM=DROP-OIDC-DB"; exit 1; }
  installed && { echo "schema eoc_oidc still installed - uninstall first"; exit 1; }
  qp -c "DROP DATABASE IF EXISTS eoc_oidc"; echo "DATABASE eoc_oidc DROPPED" ;;
*) echo "usage: $0 inspect|create-db|rehearse|install|test|bind-login|unbind-login|uninstall|drop-db"; exit 2 ;;
esac
