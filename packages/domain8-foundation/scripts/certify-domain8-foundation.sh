#!/usr/bin/env bash
set -Eeuo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"

TENANT_ID="${DOMAIN8_TENANT_ID:-00000000-0000-0000-0000-000000000008}"

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -v tenant_id="$TENANT_ID" <<'SQL'
SET app.tenant_id = :'tenant_id';

DO $$
DECLARE
    v_failures text[] := ARRAY[]::text[];
    v_count bigint;
BEGIN
    IF to_regnamespace('return_defense') IS NULL THEN
        v_failures := array_append(v_failures, 'return_defense schema missing');
    END IF;

    SELECT count(*) INTO v_count
    FROM information_schema.tables
    WHERE table_schema = 'return_defense'
      AND table_name IN (
        'policy_versions',
        'model_versions',
        'risk_thresholds',
        'reason_code_catalog',
        'control_definitions',
        'idempotency_keys',
        'domain_events',
        'outbox_events',
        'audit_log',
        'schema_contract_versions'
      );
    IF v_count <> 10 THEN
        v_failures := array_append(v_failures, 'required table count is not 10');
    END IF;

    SELECT count(*) INTO v_count
    FROM return_defense.policy_versions
    WHERE status = 'ACTIVE'
      AND tenant_id = :'tenant_id'::uuid;
    IF v_count < 1 THEN
        v_failures := array_append(v_failures, 'no active policy');
    END IF;

    SELECT count(*) INTO v_count
    FROM return_defense.risk_thresholds
    WHERE active
      AND tenant_id = :'tenant_id'::uuid;
    IF v_count <> 10 THEN
        v_failures := array_append(v_failures, 'expected 10 active gate thresholds');
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'return_defense'
          AND c.relname = 'policy_versions'
          AND c.relrowsecurity
          AND c.relforcerowsecurity
    ) THEN
        v_failures := array_append(v_failures, 'policy_versions RLS not forced');
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'trg_domain_events_no_update'
          AND NOT tgisinternal
    ) THEN
        v_failures := array_append(v_failures, 'domain event immutability trigger missing');
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'trg_audit_log_no_delete'
          AND NOT tgisinternal
    ) THEN
        v_failures := array_append(v_failures, 'audit delete protection missing');
    END IF;

    IF array_length(v_failures, 1) IS NOT NULL THEN
        RAISE EXCEPTION 'Domain 8 foundation certification failed: %',
            array_to_string(v_failures, '; ');
    END IF;
END
$$;

SELECT
    'PASS' AS certification_status,
    count(*) FILTER (WHERE status = 'ACTIVE') AS active_policies,
    (SELECT count(*) FROM return_defense.risk_thresholds WHERE active) AS active_thresholds,
    (SELECT count(*) FROM return_defense.reason_code_catalog WHERE active) AS active_reason_codes,
    (SELECT count(*) FROM return_defense.control_definitions WHERE active) AS active_controls
FROM return_defense.policy_versions;
SQL

echo "Domain 8 foundation certification: PASS"
