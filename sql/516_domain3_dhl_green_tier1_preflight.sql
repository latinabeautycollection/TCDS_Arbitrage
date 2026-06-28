BEGIN;

CREATE TEMP TABLE dhl_preflight_results (
  test_group text NOT NULL,
  test_name text NOT NULL,
  test_status text NOT NULL CHECK (test_status IN ('PASS','WARN','FAIL')),
  severity text NOT NULL CHECK (severity IN ('LOW','MEDIUM','HIGH','CRITICAL')),
  message text,
  created_at timestamptz NOT NULL DEFAULT now()
) ON COMMIT PRESERVE ROWS;

WITH expected(table_name) AS (
  VALUES
    ('dhl_api_key_events'),('dhl_api_error_events'),('dhl_tracking_snapshots'),('dhl_tracking_event_details'),
    ('dhl_tracking_webhook_subscriptions'),('dhl_tracking_webhook_events'),('dhl_return_label_events'),
    ('dhl_location_search_events'),('dhl_freight_oauth_token_events'),('dhl_freight_price_quote_events'),
    ('dhl_freight_booking_events'),('dhl_lane_learning_metrics'),('dhl_decision_events')
)
INSERT INTO dhl_preflight_results
SELECT 'TABLE','required:'||e.table_name,CASE WHEN t.table_name IS NULL THEN 'FAIL' ELSE 'PASS' END,'CRITICAL',
       CASE WHEN t.table_name IS NULL THEN 'Missing DHL table.' ELSE 'Table exists.' END,now()
FROM expected e
LEFT JOIN information_schema.tables t ON t.table_schema='arb' AND t.table_name=e.table_name;

WITH expected(view_name) AS (
  VALUES
    ('v_dhl_tracking_latest'),('v_dhl_return_label_latest'),('v_dhl_webhook_subscriptions_active'),
    ('v_dhl_freight_quote_latest'),('v_dhl_profit_protection_dashboard'),('v_dhl_learning_dashboard')
)
INSERT INTO dhl_preflight_results
SELECT 'VIEW','required:'||e.view_name,CASE WHEN v.table_name IS NULL THEN 'FAIL' ELSE 'PASS' END,'HIGH',
       CASE WHEN v.table_name IS NULL THEN 'Missing DHL view.' ELSE 'View exists.' END,now()
FROM expected e
LEFT JOIN information_schema.views v ON v.table_schema='arb' AND v.table_name=e.view_name;

WITH expected(function_name) AS (
  VALUES ('dhl_error_severity'),('dhl_delivery_exception_code'),('dhl_score_tracking_risk')
)
INSERT INTO dhl_preflight_results
SELECT 'FUNCTION','required:'||e.function_name,CASE WHEN p.proname IS NULL THEN 'FAIL' ELSE 'PASS' END,'HIGH',
       CASE WHEN p.proname IS NULL THEN 'Missing DHL function.' ELSE 'Function exists.' END,now()
FROM expected e
LEFT JOIN pg_proc p ON p.proname=e.function_name
LEFT JOIN pg_namespace n ON n.oid=p.pronamespace AND n.nspname='arb'
WHERE n.nspname='arb' OR p.proname IS NULL;

INSERT INTO dhl_preflight_results
SELECT 'SEED','process_registry_dhl_count',CASE WHEN count(*) >= 17 THEN 'PASS' ELSE 'FAIL' END,'CRITICAL',
       'DHL process seed count='||count(*)::text,now()
FROM arb.process_registry WHERE process_name LIKE 'domain3.shipping.dhl.%';

INSERT INTO dhl_preflight_results
SELECT 'SEED','shipping_carrier_dhl_exists',CASE WHEN count(*) = 1 THEN 'PASS' ELSE 'FAIL' END,'CRITICAL',
       'DHL carrier count='||count(*)::text,now()
FROM arb.shipping_carriers WHERE carrier_code='DHL';

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT table_name FROM information_schema.views WHERE table_schema='arb' AND table_name LIKE 'v_dhl_%'
  LOOP
    BEGIN
      EXECUTE format('SELECT * FROM arb.%I LIMIT 0', r.table_name);
      INSERT INTO dhl_preflight_results VALUES ('VIEW_COMPILE','compile:'||r.table_name,'PASS','HIGH','View compiles.',now());
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO dhl_preflight_results VALUES ('VIEW_COMPILE','compile:'||r.table_name,'FAIL','HIGH',SQLERRM,now());
    END;
  END LOOP;
END $$;

SELECT count(*) AS total_checks,
       count(*) FILTER (WHERE test_status='PASS') AS pass_count,
       count(*) FILTER (WHERE test_status='WARN') AS warn_count,
       count(*) FILTER (WHERE test_status='FAIL') AS fail_count
FROM dhl_preflight_results;

SELECT * FROM dhl_preflight_results WHERE test_status <> 'PASS' ORDER BY severity,test_group,test_name;

DO $$
DECLARE fail_count int;
BEGIN
  SELECT count(*) INTO fail_count FROM dhl_preflight_results WHERE test_status='FAIL';
  IF fail_count > 0 THEN
    RAISE EXCEPTION 'DHL Green Tier 1 preflight failed with % failures', fail_count;
  END IF;
END $$;

COMMIT;
