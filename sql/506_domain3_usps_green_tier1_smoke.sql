BEGIN;
CREATE TEMP TABLE usps_smoke_results (
  test_group text, test_name text, test_status text CHECK (test_status IN ('PASS','WARN','FAIL')),
  severity text CHECK (severity IN ('LOW','MEDIUM','HIGH','CRITICAL')), message text, created_at timestamptz DEFAULT now()
) ON COMMIT PRESERVE ROWS;

DO $$
DECLARE v_score numeric; v_band text; v_exception text;
BEGIN
 SELECT arb.usps_score_rate_option(10,8,20,3) INTO v_score;
 INSERT INTO usps_smoke_results VALUES ('FUNCTION_EXEC','usps_score_rate_option',CASE WHEN v_score BETWEEN 0 AND 100 THEN 'PASS' ELSE 'FAIL' END,'CRITICAL','score='||coalesce(v_score::text,'null'),now());
 SELECT arb.usps_claim_readiness_band(91) INTO v_band;
 INSERT INTO usps_smoke_results VALUES ('FUNCTION_EXEC','usps_claim_readiness_band',CASE WHEN v_band='READY_TO_SUBMIT' THEN 'PASS' ELSE 'FAIL' END,'HIGH','band='||coalesce(v_band,'null'),now());
 SELECT arb.usps_delivery_exception_code(null,null,'Your item was delivered') INTO v_exception;
 INSERT INTO usps_smoke_results VALUES ('FUNCTION_EXEC','usps_delivery_exception_code',CASE WHEN v_exception='DELIVERED' THEN 'PASS' ELSE 'FAIL' END,'HIGH','exception='||coalesce(v_exception,'null'),now());
END $$;

DO $$
DECLARE r record;
BEGIN
 FOR r IN SELECT * FROM (VALUES ('usps_decision_events'),('usps_claim_readiness_scores'),('usps_lane_learning_metrics'),('usps_hub_risk_metrics'),('usps_api_drift_events')) t(table_name)
 LOOP
   BEGIN
     EXECUTE format('SELECT count(*) FROM arb.%I', r.table_name);
     INSERT INTO usps_smoke_results VALUES ('QUERYABILITY','count:'||r.table_name,'PASS','HIGH','Count query succeeded',now());
   EXCEPTION WHEN OTHERS THEN
     INSERT INTO usps_smoke_results VALUES ('QUERYABILITY','count:'||r.table_name,'FAIL','HIGH',SQLERRM,now());
   END;
 END LOOP;
END $$;

SELECT count(*) total_checks, count(*) FILTER (WHERE test_status='PASS') pass_count,
count(*) FILTER (WHERE test_status='WARN') warn_count, count(*) FILTER (WHERE test_status='FAIL') fail_count
FROM usps_smoke_results;

SELECT * FROM usps_smoke_results WHERE test_status <> 'PASS' ORDER BY severity,test_group,test_name;

DO $$
DECLARE fail_count int;
BEGIN
 SELECT count(*) INTO fail_count FROM usps_smoke_results WHERE test_status='FAIL';
 IF fail_count > 0 THEN RAISE EXCEPTION 'USPS Green Tier 1 smoke failed with % failures', fail_count; END IF;
END $$;
COMMIT;
