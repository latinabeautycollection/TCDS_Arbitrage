\set ON_ERROR_STOP on

DO $$
DECLARE missing text[];
BEGIN
  SELECT array_agg(name) INTO missing
  FROM unnest(ARRAY[
    'notification_deliveries','delivery_attempts','dead_letters','provider_health',
    'incidents','notification_requests','incident_acknowledgements',
    'notification_decisions','delivery_reconciliation_tasks_10c',
    'incident_escalation_emissions_10d'
  ]) name
  WHERE to_regclass('operations.'||name) IS NULL;

  IF missing IS NOT NULL THEN
    RAISE EXCEPTION '10E prerequisite objects missing: %',missing;
  END IF;
END $$;

DO $$
BEGIN
  IF to_regprocedure('operations.resolve_authoritative_notification_policy(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Reviewed 10B prerequisite missing';
  END IF;
  IF to_regprocedure('operations.apply_telnyx_delivery_event_10c(text,text,text,timestamptz,text,jsonb,jsonb,uuid)') IS NULL THEN
    RAISE EXCEPTION 'Reviewed 10C prerequisite missing';
  END IF;
  IF to_regprocedure('operations.validate_incident_escalation_binding_for_event_10d(uuid,text,text,timestamptz)') IS NULL THEN
    RAISE EXCEPTION 'Reviewed 10D prerequisite missing';
  END IF;
END $$;

\echo 'PASS: 10E prerequisites are present.'
