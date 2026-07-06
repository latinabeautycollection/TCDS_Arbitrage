BEGIN;

CREATE TEMP TABLE shipping_destination_model_smoke_results (
  test_group text,
  test_name text,
  test_status text CHECK (test_status IN ('PASS','WARN','FAIL')),
  severity text CHECK (severity IN ('LOW','MEDIUM','HIGH','CRITICAL')),
  message text,
  created_at timestamptz DEFAULT now()
) ON COMMIT PRESERVE ROWS;

WITH expected(table_name) AS (
  VALUES
    ('shipping_warehouse_profiles'),
    ('shipping_destination_zone_models'),
    ('shipping_destination_weighted_zips'),
    ('shipping_destination_category_weights'),
    ('shipping_destination_seasonal_adjustments'),
    ('shipping_destination_weight_history'),
    ('shipping_weighted_rate_batches'),
    ('shipping_weighted_rate_results'),
    ('shipping_cost_prediction_events'),
    ('shipping_destination_digital_twin_runs')
)
INSERT INTO shipping_destination_model_smoke_results
SELECT 'TABLE','required:'||e.table_name,CASE WHEN t.table_name IS NULL THEN 'FAIL' ELSE 'PASS' END,'CRITICAL',
       CASE WHEN t.table_name IS NULL THEN 'Missing table.' ELSE 'Table exists.' END,now()
FROM expected e
LEFT JOIN information_schema.tables t ON t.table_schema='arb' AND t.table_name=e.table_name;

INSERT INTO shipping_destination_model_smoke_results
SELECT 'WAREHOUSE','default_warehouse',
       CASE WHEN EXISTS (SELECT 1 FROM arb.shipping_warehouse_profiles WHERE is_default=true AND is_active=true) THEN 'PASS' ELSE 'FAIL' END,
       'CRITICAL',
       'Exactly one active default warehouse should exist.',
       now();

INSERT INTO shipping_destination_model_smoke_results
SELECT 'DESTINATION_MODEL','default_model_weight_sum',
       CASE WHEN EXISTS (SELECT 1 FROM arb.v_shipping_destination_model_health WHERE is_default=true AND health_status='PASS') THEN 'PASS' ELSE 'FAIL' END,
       'CRITICAL',
       coalesce((SELECT health_status || ' weight_sum=' || active_weight_sum || ' count=' || active_zip_count FROM arb.v_shipping_destination_model_health WHERE is_default=true LIMIT 1),'No default destination model.'),
       now();

INSERT INTO shipping_destination_model_smoke_results
SELECT 'DESTINATION_MODEL','origin_destinations_count',
       CASE WHEN (SELECT count(*) FROM arb.v_shipping_default_origin_and_destinations) >= 18 THEN 'PASS' ELSE 'FAIL' END,
       'HIGH',
       'Default origin and weighted destinations view must return all 18 representative destinations.',
       now();

WITH expected(fn_name) AS (
  VALUES
    ('fn_get_default_shipping_warehouse'),
    ('fn_get_weighted_destination_zip_model'),
    ('fn_calculate_weighted_rate_summary'),
    ('fn_record_shipping_cost_prediction_event'),
    ('fn_learn_shipping_destination_weights_from_orders')
)
INSERT INTO shipping_destination_model_smoke_results
SELECT 'FUNCTION','required:'||e.fn_name,
       CASE WHEN EXISTS (
          SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
          WHERE n.nspname='arb' AND p.proname=e.fn_name
       ) THEN 'PASS' ELSE 'FAIL' END,
       'CRITICAL',
       'Function presence check.',
       now()
FROM expected e;

WITH expected(view_name) AS (
  VALUES
    ('v_shipping_default_origin_and_destinations'),
    ('v_shipping_destination_model_health'),
    ('v_shipping_destination_prediction_accuracy'),
    ('v_shipping_destination_digital_twin_latest')
)
INSERT INTO shipping_destination_model_smoke_results
SELECT 'VIEW','required:'||e.view_name,CASE WHEN v.table_name IS NULL THEN 'FAIL' ELSE 'PASS' END,'HIGH',
       CASE WHEN v.table_name IS NULL THEN 'Missing view.' ELSE 'View exists.' END,now()
FROM expected e
LEFT JOIN information_schema.views v ON v.table_schema='arb' AND v.table_name=e.view_name;

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT table_name FROM information_schema.views
    WHERE table_schema='arb'
      AND table_name IN (
        'v_shipping_default_origin_and_destinations',
        'v_shipping_destination_model_health',
        'v_shipping_destination_prediction_accuracy',
        'v_shipping_destination_digital_twin_latest'
      )
  LOOP
    BEGIN
      EXECUTE format('SELECT * FROM arb.%I LIMIT 0', r.table_name);
      INSERT INTO shipping_destination_model_smoke_results VALUES ('VIEW_COMPILE','compile:'||r.table_name,'PASS','HIGH','View compiles.',now());
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO shipping_destination_model_smoke_results VALUES ('VIEW_COMPILE','compile:'||r.table_name,'FAIL','HIGH',SQLERRM,now());
    END;
  END LOOP;
END $$;

DO $$
DECLARE v_id bigint;
BEGIN
  BEGIN
    SELECT arb.fn_record_shipping_cost_prediction_event(jsonb_build_object(
      'candidate_id','0',
      'model_key','smoke',
      'predicted_cost_usd','10.00',
      'quoted_cost_usd','11.00',
      'carrier_code','SMOKE'
    )) INTO v_id;
    INSERT INTO shipping_destination_model_smoke_results VALUES ('FUNCTION_RUNTIME','fn_record_shipping_cost_prediction_event','PASS','CRITICAL','Function accepted smoke payload id='||v_id,now());
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO shipping_destination_model_smoke_results VALUES ('FUNCTION_RUNTIME','fn_record_shipping_cost_prediction_event','FAIL','CRITICAL',SQLERRM,now());
  END;
END $$;

SELECT count(*) AS total_checks,
       count(*) FILTER (WHERE test_status='PASS') AS pass_count,
       count(*) FILTER (WHERE test_status='WARN') AS warn_count,
       count(*) FILTER (WHERE test_status='FAIL') AS fail_count
FROM shipping_destination_model_smoke_results;

SELECT * FROM shipping_destination_model_smoke_results WHERE test_status <> 'PASS' ORDER BY severity DESC, test_group, test_name;

DO $$
DECLARE fail_count int;
BEGIN
  SELECT count(*) INTO fail_count FROM shipping_destination_model_smoke_results WHERE test_status='FAIL';
  IF fail_count > 0 THEN
    RAISE EXCEPTION 'Shipping Destination Model Engine smoke failed with % failures', fail_count;
  END IF;
END $$;

COMMIT;
