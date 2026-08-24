\set ON_ERROR_STOP on
DO $$
DECLARE missing text[];
BEGIN
 SELECT array_agg(x) INTO missing FROM unnest(ARRAY[
  'operational_events','notification_deliveries','notification_decisions','delivery_reconciliation_tasks_10c',
  'incidents','incident_escalation_emissions_10d','communication_assurance_runs_10e'
 ]) x WHERE to_regclass('operations.'||x) IS NULL;
 IF missing IS NOT NULL THEN RAISE EXCEPTION '10F prerequisite objects missing: %',missing; END IF;
END $$;

DO $$ BEGIN
 IF to_regprocedure('operations.resolve_authoritative_notification_policy(uuid)') IS NULL THEN RAISE EXCEPTION 'reviewed 10B missing'; END IF;
 IF to_regprocedure('operations.record_provider_acceptance_10c(uuid,uuid,text,text,text,integer,jsonb)') IS NULL THEN RAISE EXCEPTION 'reviewed 10C missing'; END IF;
 IF to_regprocedure('operations.validate_incident_escalation_binding_for_event_10d(uuid,text,text,timestamptz)') IS NULL THEN RAISE EXCEPTION 'latest reviewed 10D missing'; END IF;
 IF to_regprocedure('operations.mark_assurance_event_emitted_10e(uuid,text,uuid)') IS NULL THEN RAISE EXCEPTION 'latest reviewed 10E missing'; END IF;
END $$;
\echo 'PASS: Domain 10F prerequisites present.'
