#!/usr/bin/env bash
# EOC staging DB (crydmokyojaynmrtxkym): set the password of login eoc_iam_bff_stg from a SCRAM-SHA-256 VERIFIER that
# Codex generated on the acquisition server (the password itself never left that server). Then retire our local copy
# of the old generated credential, which no longer works.
# Usage: VER='SCRAM-SHA-256$4096:...' CONFIRM=SET-EOC-VERIFIER bash /tmp/recov15/eoc_db/eocdb_set_verifier.sh
set -euo pipefail
[ "${CONFIRM:-}" = "SET-EOC-VERIFIER" ] || { echo "set CONFIRM=SET-EOC-VERIFIER"; exit 1; }
re='^SCRAM-SHA-256\$4096:[A-Za-z0-9+/=]{24}\$[A-Za-z0-9+/=]{44}:[A-Za-z0-9+/=]{44}$'
[[ "${VER:-}" =~ $re ]] || { echo "VER is not a SCRAM-SHA-256 verifier - stopping"; exit 1; }
cd /srv/arb-system/api
eval "$(grep -E '^(PGPASSWORD|PGSSLMODE)=' .env | sed -E "s/^([A-Z_]+)=(.*)$/export \1='\2'/")"
export PGHOST=db.crydmokyojaynmrtxkym.supabase.co PGPORT=5432 PGDATABASE=postgres PGUSER=postgres PGCONNECT_TIMEOUT=10 PAGER=cat
[ -z "$(psql -X -At -c "SELECT 1 WHERE to_regnamespace('warehouse_identity') IS NOT NULL")" ] || { echo "wrong database - stopping"; exit 1; }
psql -X -q -v ON_ERROR_STOP=1 -v ver="$VER" <<'SQL'
ALTER ROLE eoc_iam_bff_stg PASSWORD :'ver';
SQL
psql -X -At -c "SELECT 'login ' || rolname || ' canlogin=' || rolcanlogin || ' verifier_set=' || (rolpassword LIKE 'SCRAM-SHA-256$%') FROM pg_authid WHERE rolname = 'eoc_iam_bff_stg'" 2>/dev/null \
  || psql -X -At -c "SELECT 'login eoc_iam_bff_stg present: ' || EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'eoc_iam_bff_stg')"
if [ -f "$HOME/stg_login/eoc_retail_db.env" ]; then shred -u "$HOME/stg_login/eoc_retail_db.env"; echo "old local credential removed (it no longer works)"; fi
echo "DONE: eoc_iam_bff_stg now uses Codex's password; ask Codex to run the connectivity check"
