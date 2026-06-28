BEGIN;

CREATE TEMP TABLE fedex_smoke_results (
  test_group text NOT NULL,
  test_name text NOT NULL,
  test_status text NOT NULL CHECK (test_status IN ('PASS','WARN','FAIL')),
  severity text NOT NULL CHECK (severity IN ('LOW','MEDIUM','HIGH','CRITICAL')),
  message text,
  details_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
) ON COMMIT PRESERVE ROWS;

DO $$
DECLARE
  v_band text;
  v_score numeric;
BEGIN
  SELECT arb.fedex_claim_readiness_band(91) INTO v_band;
  INSERT INTO fedex_smoke_results VALUES ('FUNCTION_EXEC','fedex_claim_readiness_band',
    CASE WHEN v_band='READY_TO_SUBMIT' THEN 'PASS' ELSE 'FAIL' END,
    'HIGH','band=' || coalesce(v_band,'null'),'{}',now());

  SELECT arb.fedex_rate_value_score(12,10,3,20) INTO v_score;
  INSERT INTO fedex_smoke_results VALUES ('FUNCTION_EXEC','fedex_rate_value_score',
    CASE WHEN v_score BETWEEN 0 AND 100 THEN 'PASS' ELSE 'FAIL' END,
    'HIGH','score=' || coalesce(v_score::text,'null'),'{}',now());
END $$;

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('fedex_api_ledger'),
    ('fedex_rate_quote_events'),
    ('fedex_label_artifacts'),
    ('fedex_tracking_snapshots'),
    ('fedex_claims'),
    ('fedex_webhook_events'),
    ('fedex_billing_adjustments')
  ) t(table_name)
  LOOP
    BEGIN
      EXECUTE format('SELECT count(*) FROM arb.%I', r.table_name);
      INSERT INTO fedex_smoke_results VALUES ('QUERYABILITY','count:' || r.table_name,'PASS','HIGH','Count query succeeded.','{}',now());
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO fedex_smoke_results VALUES ('QUERYABILITY','count:' || r.table_name,'FAIL','HIGH',SQLERRM,'{}',now());
    END;
  END LOOP;
END $$;

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT table_name FROM information_schema.views WHERE table_schema='arb' AND table_name LIKE 'v_fedex_%'
  LOOP
    BEGIN
      EXECUTE format('SELECT * FROM arb.%I LIMIT 0', r.table_name);
      INSERT INTO fedex_smoke_results VALUES ('VIEW_COMPILE','compile:' || r.table_name,'PASS','HIGH','View compiles.','{}',now());
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO fedex_smoke_results VALUES ('VIEW_COMPILE','compile:' || r.table_name,'FAIL','HIGH',SQLERRM,'{}',now());
    END;
  END LOOP;
END $$;

INSERT INTO arb.fedex_smoke_test_results (test_group, test_name, test_status, severity, message, details_json)
SELECT test_group, test_name, test_status, severity, message, details_json
FROM fedex_smoke_results;

SELECT
  count(*) total_checks,
  count(*) FILTER (WHERE test_status='PASS') pass_count,
  count(*) FILTER (WHERE test_status='WARN') warn_count,
  count(*) FILTER (WHERE test_status='FAIL') fail_count
FROM fedex_smoke_results;

SELECT * FROM fedex_smoke_results WHERE test_status <> 'PASS' ORDER BY severity, test_group, test_name;

DO $$
DECLARE fail_count int;
BEGIN
  SELECT count(*) INTO fail_count FROM fedex_smoke_results WHERE test_status='FAIL';
  IF fail_count > 0 THEN
    RAISE EXCEPTION 'FedEx Green Tier 1 smoke failed with % failures', fail_count;
  END IF;
END $$;

COMMIT;
