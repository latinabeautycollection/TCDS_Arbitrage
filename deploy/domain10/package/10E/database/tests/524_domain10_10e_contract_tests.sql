\set ON_ERROR_STOP on

DO $$
BEGIN
  IF to_regclass('operations.communication_assurance_runs_10e') IS NULL THEN
    RAISE EXCEPTION '10E assurance runs table missing';
  END IF;
  IF to_regclass('operations.communication_assurance_episodes_10e') IS NULL THEN
    RAISE EXCEPTION '10E assurance episodes table missing';
  END IF;
  IF to_regclass('operations.communication_assurance_events_10e') IS NULL THEN
    RAISE EXCEPTION '10E assurance events table missing';
  END IF;
END $$;

-- 10E claim functions must use SKIP LOCKED.
DO $$
DECLARE def text;
BEGIN
  SELECT pg_get_functiondef(
    'operations.claim_assurance_runs_10e(text,integer,integer)'::regprocedure
  ) INTO def;
  IF position('SKIP LOCKED' IN upper(def))=0 THEN
    RAISE EXCEPTION '10E assurance-run claim lacks SKIP LOCKED';
  END IF;

  SELECT pg_get_functiondef(
    'operations.claim_assurance_events_10e(text,integer,integer)'::regprocedure
  ) INTO def;
  IF position('SKIP LOCKED' IN upper(def))=0 THEN
    RAISE EXCEPTION '10E assurance-event claim lacks SKIP LOCKED';
  END IF;
END $$;

-- Metric calculator reads 10A-10D truth and does not mutate it.
DO $$
DECLARE def text;
BEGIN
  SELECT pg_get_functiondef(
    'operations.calculate_assurance_metric_10e(text,text,text,timestamptz,timestamptz,integer)'::regprocedure
  ) INTO def;
  IF position('notification_deliveries' IN def)=0
     OR position('incident_escalation_emissions_10d' IN def)=0 THEN
    RAISE EXCEPTION '10E metric calculator is not integrated with required truth sources';
  END IF;
END $$;

-- PUBLIC cannot execute mutation/control functions.
DO $$
BEGIN
  IF has_function_privilege(
    'public','operations.evaluate_assurance_run_10e(uuid,text)','EXECUTE'
  ) THEN RAISE EXCEPTION 'PUBLIC can evaluate 10E assurance runs'; END IF;

  IF has_function_privilege(
    'public','operations.mark_assurance_event_emitted_10e(uuid,text,uuid)','EXECUTE'
  ) THEN RAISE EXCEPTION 'PUBLIC can mutate 10E event evidence'; END IF;
END $$;

\echo 'PASS: Domain 10E PostgreSQL contract tests.'
