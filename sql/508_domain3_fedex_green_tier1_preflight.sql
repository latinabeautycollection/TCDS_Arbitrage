BEGIN;

CREATE TEMP TABLE fedex_preflight_results (
  test_group text NOT NULL,
  test_name text NOT NULL,
  test_status text NOT NULL CHECK (test_status IN ('PASS','WARN','FAIL')),
  severity text NOT NULL CHECK (severity IN ('LOW','MEDIUM','HIGH','CRITICAL')),
  message text,
  details_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
) ON COMMIT PRESERVE ROWS;

WITH expected(table_name) AS (
  VALUES
    ('fedex_oauth_token_cache'),
    ('fedex_api_ledger'),
    ('fedex_address_validation_snapshots'),
    ('fedex_service_availability_snapshots'),
    ('fedex_rate_quote_events'),
    ('fedex_rate_quote_line_items'),
    ('fedex_label_artifacts'),
    ('fedex_tracking_snapshots'),
    ('fedex_tracking_event_details'),
    ('fedex_notifications'),
    ('fedex_proof_of_delivery'),
    ('fedex_returns'),
    ('fedex_claims'),
    ('fedex_pickup_requests'),
    ('fedex_webhook_events'),
    ('fedex_billing_adjustments'),
    ('fedex_preflight_results'),
    ('fedex_smoke_test_results')
)
INSERT INTO fedex_preflight_results
SELECT 'TABLE', 'required:' || e.table_name,
       CASE WHEN t.table_name IS NULL THEN 'FAIL' ELSE 'PASS' END,
       'CRITICAL',
       CASE WHEN t.table_name IS NULL THEN 'Missing FedEx table.' ELSE 'Table exists.' END,
       '{}'::jsonb,
       now()
FROM expected e
LEFT JOIN information_schema.tables t ON t.table_schema='arb' AND t.table_name=e.table_name;

WITH expected(view_name) AS (
  VALUES
    ('v_fedex_oauth_latest'),
    ('v_fedex_address_validation_latest'),
    ('v_fedex_rate_quote_latest'),
    ('v_fedex_tracking_latest'),
    ('v_fedex_claim_dashboard'),
    ('v_fedex_profit_protection_dashboard')
)
INSERT INTO fedex_preflight_results
SELECT 'VIEW', 'required:' || e.view_name,
       CASE WHEN v.table_name IS NULL THEN 'FAIL' ELSE 'PASS' END,
       'HIGH',
       CASE WHEN v.table_name IS NULL THEN 'Missing FedEx view.' ELSE 'View exists.' END,
       '{}'::jsonb,
       now()
FROM expected e
LEFT JOIN information_schema.views v ON v.table_schema='arb' AND v.table_name=e.view_name;

WITH expected(function_name) AS (
  VALUES ('fedex_claim_readiness_band'), ('fedex_rate_value_score')
)
INSERT INTO fedex_preflight_results
SELECT 'FUNCTION', 'required:' || e.function_name,
       CASE WHEN p.proname IS NULL THEN 'FAIL' ELSE 'PASS' END,
       'HIGH',
       CASE WHEN p.proname IS NULL THEN 'Missing FedEx function.' ELSE 'Function exists.' END,
       '{}'::jsonb,
       now()
FROM expected e
LEFT JOIN pg_proc p ON p.proname=e.function_name
LEFT JOIN pg_namespace n ON n.oid=p.pronamespace AND n.nspname='arb'
WHERE n.nspname='arb' OR p.proname IS NULL;

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT table_name FROM information_schema.views WHERE table_schema='arb' AND table_name LIKE 'v_fedex_%'
  LOOP
    BEGIN
      EXECUTE format('SELECT * FROM arb.%I LIMIT 0', r.table_name);
      INSERT INTO fedex_preflight_results VALUES ('VIEW_COMPILE','compile:' || r.table_name,'PASS','HIGH','View compiles.','{}',now());
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO fedex_preflight_results VALUES ('VIEW_COMPILE','compile:' || r.table_name,'FAIL','HIGH',SQLERRM,'{}',now());
    END;
  END LOOP;
END $$;

INSERT INTO fedex_preflight_results
SELECT 'SEED', 'carrier_seed_FEDEX',
       CASE WHEN count(*) = 1 THEN 'PASS' ELSE 'FAIL' END,
       'CRITICAL',
       'FEDEX carrier seed count=' || count(*)::text,
       '{}'::jsonb,
       now()
FROM arb.shipping_carriers
WHERE carrier_code='FEDEX' AND enabled=true;

INSERT INTO fedex_preflight_results
SELECT 'SEED', 'process_registry_fedex_count',
       CASE WHEN count(*) >= 18 THEN 'PASS' ELSE 'FAIL' END,
       'CRITICAL',
       'FedEx process seed count=' || count(*)::text,
       '{}'::jsonb,
       now()
FROM arb.process_registry
WHERE process_name LIKE 'domain3.shipping.fedex.%';

INSERT INTO arb.fedex_preflight_results (test_group, test_name, test_status, severity, message, details_json)
SELECT test_group, test_name, test_status, severity, message, details_json
FROM fedex_preflight_results;

SELECT
  count(*) total_checks,
  count(*) FILTER (WHERE test_status='PASS') pass_count,
  count(*) FILTER (WHERE test_status='WARN') warn_count,
  count(*) FILTER (WHERE test_status='FAIL') fail_count
FROM fedex_preflight_results;

SELECT * FROM fedex_preflight_results WHERE test_status <> 'PASS' ORDER BY severity, test_group, test_name;

DO $$
DECLARE fail_count int;
BEGIN
  SELECT count(*) INTO fail_count FROM fedex_preflight_results WHERE test_status='FAIL';
  IF fail_count > 0 THEN
    RAISE EXCEPTION 'FedEx Green Tier 1 preflight failed with % failures', fail_count;
  END IF;
END $$;

COMMIT;
