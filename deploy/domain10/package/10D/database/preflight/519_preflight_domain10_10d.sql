\set ON_ERROR_STOP on
DO $$
BEGIN
 IF to_regclass('operations.incidents') IS NULL OR to_regclass('operations.incident_escalation_executions') IS NULL THEN RAISE EXCEPTION 'Reviewed 10A incident contract missing'; END IF;
 IF to_regclass('operations.notification_decisions') IS NULL OR to_regprocedure('operations.resolve_authorized_audience(uuid,text,text,timestamptz)') IS NULL THEN RAISE EXCEPTION 'Reviewed 10B contract missing'; END IF;
 IF to_regclass('operations.delivery_reconciliation_tasks_10c') IS NULL OR to_regprocedure('operations.record_provider_acceptance_10c(uuid,uuid,text,text,text,integer,jsonb)') IS NULL THEN RAISE EXCEPTION 'Reviewed 10C contract missing'; END IF;
END $$;
\echo 'PASS: 10D prerequisites present.'


DO $$
BEGIN
  IF to_regprocedure('operations.severity_rank(text)') IS NULL THEN
    RAISE EXCEPTION 'Reviewed 10A severity_rank(text) prerequisite missing';
  END IF;
END $$;
