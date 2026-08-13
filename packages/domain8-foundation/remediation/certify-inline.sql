-- Domain 8 inline certification — replaces the shipped certify scripts, which
-- reference psql variables (:'tenant_id') INSIDE DO $$ blocks. psql does not
-- substitute inside dollar-quoted bodies -> "syntax error at or near ':'".
-- This reads the tenant from app.tenant_id via current_setting(). Run with:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f certify-inline.sql
SET app.tenant_id='00000000-0000-0000-0000-000000000008';
DO $$
DECLARE v_fail text[] := ARRAY[]::text[]; v_n bigint; v_t uuid := current_setting('app.tenant_id')::uuid;
BEGIN
  SELECT count(*) INTO v_n FROM information_schema.tables WHERE table_schema='return_defense'
    AND table_name IN ('policy_versions','model_versions','risk_thresholds','reason_code_catalog',
    'control_definitions','idempotency_keys','domain_events','outbox_events','audit_log','schema_contract_versions');
  IF v_n<>10 THEN v_fail:=array_append(v_fail,'required tables '||v_n||' != 10'); END IF;
  SELECT count(*) INTO v_n FROM return_defense.policy_versions WHERE status='ACTIVE' AND tenant_id=v_t;
  IF v_n<1 THEN v_fail:=array_append(v_fail,'no active policy'); END IF;
  SELECT count(*) INTO v_n FROM return_defense.risk_thresholds WHERE active AND tenant_id=v_t;
  IF v_n<>10 THEN v_fail:=array_append(v_fail,'active thresholds '||v_n||' != 10'); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='return_defense' AND c.relname='policy_versions' AND c.relrowsecurity AND c.relforcerowsecurity)
    THEN v_fail:=array_append(v_fail,'policy_versions RLS not forced'); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_domain_events_no_update' AND NOT tgisinternal)
    THEN v_fail:=array_append(v_fail,'domain_events immutability trigger missing'); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_audit_log_no_delete' AND NOT tgisinternal)
    THEN v_fail:=array_append(v_fail,'audit_log delete protection missing'); END IF;
  IF array_length(v_fail,1) IS NOT NULL THEN RAISE EXCEPTION 'Domain 8 certification FAILED: %', array_to_string(v_fail,'; '); END IF;
  RAISE NOTICE 'Domain 8 foundation certification: PASS';
END $$;
SELECT 'PASS' status,
  (SELECT count(*) FROM return_defense.policy_versions WHERE status='ACTIVE') active_policies,
  (SELECT count(*) FROM return_defense.risk_thresholds  WHERE active) active_thresholds,
  (SELECT count(*) FROM return_defense.reason_code_catalog WHERE active) reason_codes,
  (SELECT count(*) FROM return_defense.control_definitions WHERE active) controls;
