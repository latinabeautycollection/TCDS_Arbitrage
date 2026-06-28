BEGIN;

CREATE TEMP TABLE shipengine_smoke_results (
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
  SELECT arb.shipengine_error_severity(429) INTO v_error;
  INSERT INTO shipengine_smoke_results VALUES ('FUNCTION_EXEC','shipengine_error_severity',CASE WHEN v_error='TRANSIENT' THEN 'PASS' ELSE 'FAIL' END,'CRITICAL','severity='||coalesce(v_error,'null'),now());

  SELECT arb.shipengine_tracking_exception_code('DE','DELIVERED',NULL) INTO v_exception;
  INSERT INTO shipengine_smoke_results VALUES ('FUNCTION_EXEC','shipengine_tracking_exception_code',CASE WHEN v_exception='DELIVERED' THEN 'PASS' ELSE 'FAIL' END,'HIGH','exception='||coalesce(v_exception,'null'),now());

  SELECT arb.shipengine_score_rate_profit(8,12) INTO v_score;
  INSERT INTO shipengine_smoke_results VALUES ('FUNCTION_EXEC','shipengine_score_rate_profit',CASE WHEN v_score BETWEEN 0 AND 100 THEN 'PASS' ELSE 'FAIL' END,'HIGH','score='||coalesce(v_score::text,'null'),now());
END $$;

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('shipengine_rate_events'),('shipengine_label_events'),('shipengine_tracking_events'),
      ('shipengine_webhook_subscriptions'),('shipengine_webhook_events'),('shipengine_decision_events')
    ) t(table_name)
  LOOP
    BEGIN
      EXECUTE format('SELECT count(*) FROM arb.%I', r.table_name);
      INSERT INTO shipengine_smoke_results VALUES ('QUERYABILITY','count:'||r.table_name,'PASS','HIGH','Count query succeeded.',now());
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO shipengine_smoke_results VALUES ('QUERYABILITY','count:'||r.table_name,'FAIL','HIGH',SQLERRM,now());
    END;
  END LOOP;
END $$;

SELECT count(*) AS total_checks,
       count(*) FILTER (WHERE test_status='PASS') AS pass_count,
       count(*) FILTER (WHERE test_status='WARN') AS warn_count,
       count(*) FILTER (WHERE test_status='FAIL') AS fail_count
FROM shipengine_smoke_results;

SELECT * FROM shipengine_smoke_results WHERE test_status <> 'PASS' ORDER BY severity,test_group,test_name;

DO $$
DECLARE fail_count int;
BEGIN
  SELECT count(*) INTO fail_count FROM shipengine_smoke_results WHERE test_status='FAIL';
  IF fail_count > 0 THEN
    RAISE EXCEPTION 'ShipEngine Green Tier 1 smoke failed with % failures', fail_count;
  END IF;
END $$;

COMMIT;
