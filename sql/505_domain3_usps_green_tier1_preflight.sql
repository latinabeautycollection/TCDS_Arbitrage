BEGIN;
CREATE TEMP TABLE usps_preflight_results (
  test_group text, test_name text, test_status text CHECK (test_status IN ('PASS','WARN','FAIL')),
  severity text CHECK (severity IN ('LOW','MEDIUM','HIGH','CRITICAL')), message text, created_at timestamptz DEFAULT now()
) ON COMMIT PRESERVE ROWS;

WITH expected(table_name) AS (
 VALUES ('usps_oauth_token_events'),('usps_oauth_revoke_events'),('address_validation_results'),('usps_rate_quote_events'),
 ('usps_shipping_option_events'),('usps_tracking_requests'),('usps_tracking_snapshots'),('usps_tracking_event_details'),
 ('usps_tracking_notification_requests'),('usps_proof_of_delivery_requests'),('usps_raw_event_ingest'),
 ('usps_lane_learning_metrics'),('usps_hub_risk_metrics'),('usps_package_risk_profiles'),('usps_decision_events'),
 ('usps_claim_readiness_scores'),('usps_api_drift_events'),('usps_ai_review_events')
)
INSERT INTO usps_preflight_results
SELECT 'TABLE','required:'||e.table_name,CASE WHEN t.table_name IS NULL THEN 'FAIL' ELSE 'PASS' END,'CRITICAL',
       CASE WHEN t.table_name IS NULL THEN 'Missing table' ELSE 'Table exists' END,now()
FROM expected e LEFT JOIN information_schema.tables t ON t.table_schema='arb' AND t.table_name=e.table_name;

WITH expected(view_name) AS (
 VALUES ('v_usps_oauth_latest'),('v_address_validation_latest'),('v_usps_rate_quote_latest'),('v_usps_shipping_options_latest'),
 ('v_usps_tracking_latest'),('v_usps_tracking_delivery_exceptions'),('v_usps_profit_protection_dashboard'),('v_usps_learning_dashboard')
)
INSERT INTO usps_preflight_results
SELECT 'VIEW','required:'||e.view_name,CASE WHEN v.table_name IS NULL THEN 'FAIL' ELSE 'PASS' END,'HIGH',
       CASE WHEN v.table_name IS NULL THEN 'Missing view' ELSE 'View exists' END,now()
FROM expected e LEFT JOIN information_schema.views v ON v.table_schema='arb' AND v.table_name=e.view_name;

WITH expected(function_name) AS (VALUES ('usps_score_rate_option'),('usps_claim_readiness_band'),('usps_delivery_exception_code'))
INSERT INTO usps_preflight_results
SELECT 'FUNCTION','required:'||e.function_name,CASE WHEN p.proname IS NULL THEN 'FAIL' ELSE 'PASS' END,'HIGH',
       CASE WHEN p.proname IS NULL THEN 'Missing function' ELSE 'Function exists' END,now()
FROM expected e LEFT JOIN pg_proc p ON p.proname=e.function_name
LEFT JOIN pg_namespace n ON n.oid=p.pronamespace AND n.nspname='arb'
WHERE n.nspname='arb' OR p.proname IS NULL;

INSERT INTO usps_preflight_results
SELECT 'SEED','process_registry_usps_count',CASE WHEN count(*) >= 22 THEN 'PASS' ELSE 'FAIL' END,'CRITICAL',
       'USPS seed count='||count(*)::text,now()
FROM arb.process_registry WHERE process_name LIKE 'domain3.shipping.usps.%';

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT table_name FROM information_schema.views WHERE table_schema='arb' AND table_name LIKE 'v_usps_%'
  LOOP
    BEGIN
      EXECUTE format('SELECT * FROM arb.%I LIMIT 0', r.table_name);
      INSERT INTO usps_preflight_results VALUES ('VIEW_COMPILE','compile:'||r.table_name,'PASS','HIGH','View compiles',now());
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO usps_preflight_results VALUES ('VIEW_COMPILE','compile:'||r.table_name,'FAIL','HIGH',SQLERRM,now());
    END;
  END LOOP;
END $$;

SELECT count(*) total_checks, count(*) FILTER (WHERE test_status='PASS') pass_count,
count(*) FILTER (WHERE test_status='WARN') warn_count, count(*) FILTER (WHERE test_status='FAIL') fail_count
FROM usps_preflight_results;

SELECT * FROM usps_preflight_results WHERE test_status <> 'PASS' ORDER BY severity,test_group,test_name;

DO $$
DECLARE fail_count int;
BEGIN
 SELECT count(*) INTO fail_count FROM usps_preflight_results WHERE test_status='FAIL';
 IF fail_count > 0 THEN RAISE EXCEPTION 'USPS Green Tier 1 preflight failed with % failures', fail_count; END IF;
END $$;
COMMIT;
