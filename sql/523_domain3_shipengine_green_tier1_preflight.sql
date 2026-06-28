BEGIN;

CREATE TEMP TABLE shipengine_preflight_results (
  test_group text NOT NULL,
  test_name text NOT NULL,
  test_status text NOT NULL CHECK (test_status IN ('PASS','WARN','FAIL')),
  severity text NOT NULL CHECK (severity IN ('LOW','MEDIUM','HIGH','CRITICAL')),
  message text,
  created_at timestamptz NOT NULL DEFAULT now()
) ON COMMIT PRESERVE ROWS;

WITH expected(table_name) AS (
  VALUES
    ('shipengine_api_key_events'),('shipengine_api_error_events'),('shipengine_carrier_account_snapshots'),
    ('shipengine_address_validation_events'),('shipengine_recognition_events'),('shipengine_shipment_events'),
    ('shipengine_rate_events'),('shipengine_label_events'),('shipengine_tracking_events'),
    ('shipengine_webhook_subscriptions'),('shipengine_webhook_events'),('shipengine_pickup_events'),
    ('shipengine_manifest_events'),('shipengine_warehouse_events'),('shipengine_service_point_events'),
    ('shipengine_insurance_events'),('shipengine_decision_events')
)
INSERT INTO shipengine_preflight_results
SELECT 'TABLE','required:'||e.table_name,CASE WHEN t.table_name IS NULL THEN 'FAIL' ELSE 'PASS' END,'CRITICAL',
       CASE WHEN t.table_name IS NULL THEN 'Missing ShipEngine table.' ELSE 'Table exists.' END,now()
FROM expected e
LEFT JOIN information_schema.tables t ON t.table_schema='arb' AND t.table_name=e.table_name;

WITH expected(view_name) AS (
  VALUES
    ('v_shipengine_latest_labels'),('v_shipengine_latest_tracking'),('v_shipengine_best_rates'),
    ('v_shipengine_active_webhooks'),('v_shipengine_profit_protection_dashboard')
)
INSERT INTO shipengine_preflight_results
SELECT 'VIEW','required:'||e.view_name,CASE WHEN v.table_name IS NULL THEN 'FAIL' ELSE 'PASS' END,'HIGH',
       CASE WHEN v.table_name IS NULL THEN 'Missing ShipEngine view.' ELSE 'View exists.' END,now()
FROM expected e
LEFT JOIN information_schema.views v ON v.table_schema='arb' AND v.table_name=e.view_name;

WITH expected(function_name) AS (
  VALUES ('shipengine_error_severity'),('shipengine_tracking_exception_code'),('shipengine_score_rate_profit')
)
INSERT INTO shipengine_preflight_results
SELECT 'FUNCTION','required:'||e.function_name,CASE WHEN p.proname IS NULL THEN 'FAIL' ELSE 'PASS' END,'HIGH',
       CASE WHEN p.proname IS NULL THEN 'Missing ShipEngine function.' ELSE 'Function exists.' END,now()
FROM expected e
LEFT JOIN pg_proc p ON p.proname=e.function_name
LEFT JOIN pg_namespace n ON n.oid=p.pronamespace AND n.nspname='arb'
WHERE n.nspname='arb' OR p.proname IS NULL;

INSERT INTO shipengine_preflight_results
SELECT 'SEED','process_registry_shipengine_count',CASE WHEN count(*) >= 20 THEN 'PASS' ELSE 'FAIL' END,'CRITICAL',
       'ShipEngine process seed count='||count(*)::text,now()
FROM arb.process_registry WHERE process_name LIKE 'domain3.shipping.shipengine.%';

INSERT INTO shipengine_preflight_results
SELECT 'SEED','shipping_carrier_shipengine_exists',CASE WHEN count(*) = 1 THEN 'PASS' ELSE 'FAIL' END,'CRITICAL',
       'ShipEngine carrier count='||count(*)::text,now()
FROM arb.shipping_carriers WHERE carrier_code='SHIPENGINE';

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT table_name FROM information_schema.views WHERE table_schema='arb' AND table_name LIKE 'v_shipengine_%'
  LOOP
    BEGIN
      EXECUTE format('SELECT * FROM arb.%I LIMIT 0', r.table_name);
      INSERT INTO shipengine_preflight_results VALUES ('VIEW_COMPILE','compile:'||r.table_name,'PASS','HIGH','View compiles.',now());
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO shipengine_preflight_results VALUES ('VIEW_COMPILE','compile:'||r.table_name,'FAIL','HIGH',SQLERRM,now());
    END;
  END LOOP;
END $$;

SELECT count(*) AS total_checks,
       count(*) FILTER (WHERE test_status='PASS') AS pass_count,
       count(*) FILTER (WHERE test_status='WARN') AS warn_count,
       count(*) FILTER (WHERE test_status='FAIL') AS fail_count
FROM shipengine_preflight_results;

SELECT * FROM shipengine_preflight_results WHERE test_status <> 'PASS' ORDER BY severity,test_group,test_name;

DO $$
DECLARE fail_count int;
BEGIN
  SELECT count(*) INTO fail_count FROM shipengine_preflight_results WHERE test_status='FAIL';
  IF fail_count > 0 THEN
    RAISE EXCEPTION 'ShipEngine Green Tier 1 preflight failed with % failures', fail_count;
  END IF;
END $$;

COMMIT;
