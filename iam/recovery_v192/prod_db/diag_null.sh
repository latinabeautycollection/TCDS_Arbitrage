#!/usr/bin/env bash
# READ-ONLY diagnostic: why some catalog fingerprint lines come out NULL (prod vs staging). Prints no secrets.
set -euo pipefail
cd /srv/arb-system/api
eval "$(grep -E '^(PGHOST|PGPORT|PGDATABASE|PGUSER|PGPASSWORD|PGSSLMODE)=' .env | sed -E "s/^([A-Z_]+)=(.*)$/export \1='\2'/")"
export PGOPTIONS='-c default_transaction_read_only=on'
Q=$(cat <<'SQL'
SELECT p.proname||' | kind='||p.prokind::text||' | args_null='||(pg_get_function_identity_arguments(p.oid) IS NULL)
  ||' | src_null='||(p.prosrc IS NULL)||' | result_null='||(pg_get_function_result(p.oid) IS NULL)
  ||' | owner='||coalesce(pg_get_userbyid(p.proowner),'NULL')||' | acl_items='||coalesce(cardinality(p.proacl)::text,'default')
  ||' | acl_has_null='||coalesce((SELECT bool_or(x IS NULL) FROM unnest(p.proacl) x)::text,'-')
  ||' | args_newline='||(pg_get_function_identity_arguments(p.oid) ~ '[\n\r\t\\]')
FROM pg_proc p WHERE p.pronamespace='warehouse_control'::regnamespace AND p.proname IN ('issue_barcode','record_activity','record_barcode_scan') ORDER BY 1;
SQL
)
CAT=$(grep -v '^--' /tmp/prod_recovery/catalog.sql | sed '$ s/;[[:space:]]*$//')
NUL="SELECT 'catalog lines that are NULL: '||count(*) FILTER (WHERE x IS NULL)||' of '||count(*) FROM ($CAT) q(x);"
COLS="SELECT 'auth_sessions time columns: '||string_agg(column_name,', ') FROM information_schema.columns WHERE table_schema='warehouse_identity' AND table_name='auth_sessions' AND data_type LIKE 'timestamp%';"
echo "== production"; PAGER=cat psql -X -At -c "$Q" -c "$NUL" -c "$COLS"
echo "== staging";    PGHOST=db.kqcdqtazcqaawdkmcfed.supabase.co PGPORT=5432 PGDATABASE=postgres PGUSER=postgres PAGER=cat psql -X -At -c "$Q" -c "$NUL"
