BEGIN;

CREATE TEMP TABLE shipping_v3_final_smoke_results (
  test_group text,
  test_name text,
  test_status text CHECK (test_status IN ('PASS','WARN','FAIL')),
  severity text CHECK (severity IN ('LOW','MEDIUM','HIGH','CRITICAL')),
  message text,
  created_at timestamptz DEFAULT now()
) ON COMMIT PRESERVE ROWS;

WITH expected(table_name) AS (
  VALUES ('shipping_evidence'), ('shipping_capture_signal_outbox'), ('process_runs'), ('process_steps'), ('forensic_events')
)
INSERT INTO shipping_v3_final_smoke_results
SELECT 'TABLE', e.table_name, CASE WHEN t.table_name IS NULL THEN 'FAIL' ELSE 'PASS' END, 'CRITICAL',
       CASE WHEN t.table_name IS NULL THEN 'Missing required table' ELSE 'Table exists' END
FROM expected e
LEFT JOIN information_schema.tables t
  ON t.table_schema='arb' AND t.table_name=e.table_name;

WITH expected(column_name) AS (
  VALUES
    ('process_run_id'),('process_step_id'),('forensic_event_id'),('entity_type'),('entity_pk'),
    ('source_listing_normalized_id'),('carrier_code'),('service_code'),('quoted_label_cost_usd'),('payload_json'),('created_at')
)
INSERT INTO shipping_v3_final_smoke_results
SELECT 'FORENSIC_CONTRACT', 'shipping_evidence.'||e.column_name,
       CASE WHEN c.column_name IS NULL THEN 'FAIL' ELSE 'PASS' END,
       'CRITICAL',
       CASE WHEN c.column_name IS NULL THEN 'Domain 1 shipping_evidence contract column missing' ELSE 'Column exists' END
FROM expected e
LEFT JOIN information_schema.columns c
  ON c.table_schema='arb' AND c.table_name='shipping_evidence' AND c.column_name=e.column_name;

WITH expected(column_name) AS (
  VALUES
    ('signal_hash'),('status'),('process_run_id'),('process_step_id'),('candidate_id'),
    ('source_listing_normalized_id'),('entity_type'),('entity_pk'),('selected_carrier_code'),
    ('selected_service_code'),('quoted_label_cost_usd'),('payload_json'),('available_at')
)
INSERT INTO shipping_v3_final_smoke_results
SELECT 'OUTBOX_CONTRACT', 'shipping_capture_signal_outbox.'||e.column_name,
       CASE WHEN c.column_name IS NULL THEN 'FAIL' ELSE 'PASS' END,
       'CRITICAL',
       CASE WHEN c.column_name IS NULL THEN 'Outbox contract column missing' ELSE 'Column exists' END
FROM expected e
LEFT JOIN information_schema.columns c
  ON c.table_schema='arb' AND c.table_name='shipping_capture_signal_outbox' AND c.column_name=e.column_name;

INSERT INTO shipping_v3_final_smoke_results
SELECT 'FUNCTION','fn_enqueue_shipping_capture_signal',
       CASE WHEN EXISTS (
         SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
         WHERE n.nspname='arb' AND p.proname='fn_enqueue_shipping_capture_signal'
       ) THEN 'PASS' ELSE 'FAIL' END,
       'CRITICAL',
       'Function presence check';

INSERT INTO shipping_v3_final_smoke_results
SELECT 'PROCESS_REGISTRY','forensic.capture_shipping',
       CASE WHEN EXISTS (SELECT 1 FROM arb.process_registry WHERE process_name='forensic.capture_shipping' AND active_flag=true)
       THEN 'PASS' ELSE 'FAIL' END,
       'CRITICAL',
       'Process registry row check';

DO $$
DECLARE v_id bigint;
BEGIN
  BEGIN
    SELECT arb.fn_enqueue_shipping_capture_signal(jsonb_build_object(
      'entity_type','listing',
      'entity_pk','0',
      'sourceListingId','0',
      'candidate_id','0',
      'source','shipengine',
      'selected_carrier_code','SMOKE',
      'selected_service_code','SMOKE',
      'quoted_label_cost_usd','0',
      'decision_hash','final-relay-smoke'
    )) INTO v_id;
    INSERT INTO shipping_v3_final_smoke_results
    VALUES ('FUNCTION_RUNTIME','fn_enqueue_shipping_capture_signal','PASS','CRITICAL','Function accepted smoke payload id='||v_id,now());
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO shipping_v3_final_smoke_results
    VALUES ('FUNCTION_RUNTIME','fn_enqueue_shipping_capture_signal','FAIL','CRITICAL',SQLERRM,now());
  END;
END $$;

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT table_name
    FROM information_schema.views
    WHERE table_schema='arb'
      AND table_name IN ('v_domain3_shipping_evidence_signals','v_shipping_intelligence_v3_capture_outbox_health')
  LOOP
    BEGIN
      EXECUTE format('SELECT * FROM arb.%I LIMIT 0', r.table_name);
      INSERT INTO shipping_v3_final_smoke_results VALUES ('VIEW_COMPILE','compile:'||r.table_name,'PASS','HIGH','View compiles',now());
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO shipping_v3_final_smoke_results VALUES ('VIEW_COMPILE','compile:'||r.table_name,'FAIL','HIGH',SQLERRM,now());
    END;
  END LOOP;
END $$;

SELECT count(*) AS total_checks,
       count(*) FILTER (WHERE test_status='PASS') AS pass_count,
       count(*) FILTER (WHERE test_status='WARN') AS warn_count,
       count(*) FILTER (WHERE test_status='FAIL') AS fail_count
FROM shipping_v3_final_smoke_results;

SELECT * FROM shipping_v3_final_smoke_results WHERE test_status <> 'PASS'
ORDER BY severity DESC, test_group, test_name;

DO $$
DECLARE fail_count int;
BEGIN
  SELECT count(*) INTO fail_count FROM shipping_v3_final_smoke_results WHERE test_status='FAIL';
  IF fail_count > 0 THEN
    RAISE EXCEPTION 'Domain 3 Shipping V3 final relay smoke failed with % failures', fail_count;
  END IF;
END $$;

COMMIT;
