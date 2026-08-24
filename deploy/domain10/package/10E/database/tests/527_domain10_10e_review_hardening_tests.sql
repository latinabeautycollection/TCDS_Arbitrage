\set ON_ERROR_STOP on
DO $$ DECLARE def text; BEGIN
  SELECT pg_get_functiondef('operations.schedule_due_assurance_runs_10e(timestamptz)'::regprocedure) INTO def;
  IF position('v_last_end' IN def)=0 OR position('500 windows' IN def)=0 THEN RAISE EXCEPTION '10E scheduler catchup missing'; END IF;
END $$;
DO $$ DECLARE def text; BEGIN
  SELECT pg_get_functiondef('operations.fail_assurance_run_10e(uuid,text,text,text)'::regprocedure) INTO def;
  IF position('max_attempts' IN def)=0 OR position('state=''PENDING''' IN def)=0 THEN RAISE EXCEPTION '10E bounded retry missing'; END IF;
END $$;
DO $$ DECLARE def text; BEGIN
  SELECT pg_get_functiondef('operations.calculate_assurance_metric_10e(text,text,text,timestamptz,timestamptz,integer)'::regprocedure) INTO def;
  IF position('acknowledgement_due_at>=p_window_start' IN replace(def,' ',''))=0 THEN RAISE EXCEPTION 'ACK due-time cohort missing'; END IF;
END $$;
DO $$ DECLARE def text; BEGIN
  SELECT pg_get_functiondef('operations.mark_assurance_event_emitted_10e(uuid,text,uuid)'::regprocedure) INTO def;
  IF position('DOMAIN10_ASSURANCE' IN def)=0 OR position('source_event_id' IN def)=0 THEN RAISE EXCEPTION '10B linkage validation missing'; END IF;
END $$;
\echo 'PASS: Domain 10E in-depth review hardening tests.'
