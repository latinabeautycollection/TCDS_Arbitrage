-- TCDS Domain 8 Slice 8A.1 rollback
-- WARNING: destructive. Requires explicit deployment variable.
--
-- Run:
--   psql "$DATABASE_URL" -v domain8_confirm_rollback='DROP_DOMAIN8_8A1' \
--     -f scripts/rollback-domain8-foundation.sql

\if :{?domain8_confirm_rollback}
\else
\echo 'Missing -v domain8_confirm_rollback=DROP_DOMAIN8_8A1'
\quit 3
\endif

SELECT CASE
    WHEN :'domain8_confirm_rollback' = 'DROP_DOMAIN8_8A1' THEN true
    ELSE pg_catalog.set_config(
        'domain8.rollback.error',
        'Invalid rollback confirmation token',
        false
    )::boolean
END;

BEGIN;

DROP SCHEMA IF EXISTS return_defense CASCADE;

COMMIT;
