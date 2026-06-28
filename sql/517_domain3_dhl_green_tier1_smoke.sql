BEGIN;

CREATE TEMP TABLE dhl_smoke_results (
  test_group text NOT NULL,
  test_name text NOT NULL,
  test_status text NOT NULL CHECK (test_status IN ('PASS','WARN','FAIL')),
  severity text NOT NULL CHECK (severity IN ('LOW','MEDIUM','HIGH','CRITICAL')),
  message text,
  created_at timestamptz NOT NULL DEFAULT now()
) ON COMMIT PRESERVE ROWS;

DO $$
DECLARE v_error text; v_exception text; v_score numeric;
BEGIN
  SELECT arb.dhl_error_severity(429) INTO v_error;
  INSERT INTO dhl_smoke_results VALUES ('FUNCTION_EXEC','dhl_error_severity',CASE WHEN v_error='TRANSIENT' THEN 'PASS' ELSE 'FAIL' END,'CRITICAL','severity='||coalesce(v_error,'null'),now());

  SELECT arb.dhl_delivery_exception_code('delivered','Shipment delivered') INTO v_exception;
  INSERT INTO dhl_smoke_results VALUES ('FUNCTION_EXEC','dhl_delivery_exception_code',CASE WHEN v_exception='DELIVERED' THEN 'PASS' ELSE 'FAIL' END,'HIGH','exception='||coalesce(v_exception,'null'),now());

  SELECT arb.dhl_score_tracking_risk('transit','ARRIVED AT CUSTOMS',2) INTO v_score;
  INSERT INTO dhl_smoke_results VALUES ('FUNCTION_EXEC','dhl_score_tracking_risk',CASE WHEN v_score BETWEEN 0 AND 100 THEN 'PASS' ELSE 'FAIL' END,'HIGH','score='||coalesce(v_score::text,'null'),now());
END $$;

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('dhl_tracking_snapshots'),('dhl_tracking_webhook_subscriptions'),('dhl_tracking_webhook_events'),
      ('dhl_return_label_events'),('dhl_location_search_events'),('dhl_freight_price_quote_events'),('dhl_decision_events')
    ) t(table_name)
  LOOP
    BEGIN
      EXECUTE format('SELECT count(*) FROM arb.%I', r.table_name);
      INSERT INTO dhl_smoke_results VALUES ('QUERYABILITY','count:'||r.table_name,'PASS','HIGH','Count query succeeded.',now());
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO dhl_smoke_results VALUES ('QUERYABILITY','count:'||r.table_name,'FAIL','HIGH',SQLERRM,now());
    END;
  END LOOP;
END $$;

SELECT count(*) AS total_checks,
       count(*) FILTER (WHERE test_status='PASS') AS pass_count,
       count(*) FILTER (WHERE test_status='WARN') AS warn_count,
       count(*) FILTER (WHERE test_status='FAIL') AS fail_count
FROM dhl_smoke_results;

SELECT * FROM dhl_smoke_results WHERE test_status <> 'PASS' ORDER BY severity,test_group,test_name;

DO $$
DECLARE fail_count int;
BEGIN
  SELECT count(*) INTO fail_count FROM dhl_smoke_results WHERE test_status='FAIL';
  IF fail_count > 0 THEN
    RAISE EXCEPTION 'DHL Green Tier 1 smoke failed with % failures', fail_count;
  END IF;
END $$;

COMMIT;
