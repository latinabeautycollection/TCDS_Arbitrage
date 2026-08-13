#!/usr/bin/env bash
set -Eeuo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
DO $$
DECLARE
    v_server integer := current_setting('server_version_num')::integer;
BEGIN
    IF v_server < 150000 THEN
        RAISE EXCEPTION 'PostgreSQL 15+ required. Found %', current_setting('server_version');
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_available_extensions WHERE name = 'pgcrypto'
    ) THEN
        RAISE EXCEPTION 'pgcrypto extension is unavailable';
    END IF;

    IF NOT has_schema_privilege(current_user, 'public', 'USAGE') THEN
        RAISE EXCEPTION 'Current user lacks basic database access';
    END IF;
END
$$;

SELECT
    current_database() AS database_name,
    current_user AS deployment_user,
    current_setting('server_version') AS postgres_version,
    pg_size_pretty(pg_database_size(current_database())) AS database_size;
SQL

echo "Domain 8 foundation preflight: PASS"
