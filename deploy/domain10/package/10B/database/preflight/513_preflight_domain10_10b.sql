\set ON_ERROR_STOP on

-- READ ONLY. Must run before any 10B mutation.

DO $$
DECLARE
  missing text[];
  mode text;
BEGIN
  -- Reviewed 10A prerequisites.
  SELECT array_agg(x) INTO missing
  FROM unnest(ARRAY[
    'operational_events','event_processing','notification_policies',
    'notification_policy_versions','notification_templates',
    'notification_template_versions','notification_requests',
    'notification_recipients','notification_deliveries','notification_outbox',
    'recipient_directory','notification_audiences','audience_members',
    'recipient_authorizations','sms_subscriptions','suppression_rules',
    'suppression_decisions','audit_ledger','incident_escalation_executions'
  ]) x
  WHERE to_regclass('operations.'||x) IS NULL;

  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'Reviewed 10A prerequisite missing objects: %',missing;
  END IF;

  IF NOT EXISTS(
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='operations' AND table_name='suppression_rules'
      AND column_name='grouping_strategy'
  ) OR NOT EXISTS(
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='operations' AND table_name='suppression_rules'
      AND column_name='grouping_fields'
  ) THEN
    RAISE EXCEPTION 'Reviewed 10A hardening 511 is not installed';
  END IF;

  -- 10B install mode.
  IF to_regclass('operations.event_contract_versions') IS NULL
     AND to_regclass('operations.notification_decisions') IS NULL
     AND to_regclass('operations.event_planning_outbox') IS NULL THEN
    mode:='FRESH_10B';
  ELSIF to_regclass('operations.event_contract_versions') IS NOT NULL
     AND to_regclass('operations.notification_decisions') IS NOT NULL
     AND to_regclass('operations.event_planning_outbox') IS NOT NULL THEN
    mode:='UPGRADE_10B_R1';
  ELSE
    RAISE EXCEPTION 'Partial/unknown 10B installation detected; refuse mutation';
  END IF;

  RAISE NOTICE '10B preflight mode: %',mode;
END $$;

-- Guard against unknown existing function signatures that CREATE OR REPLACE
-- would otherwise overwrite.
DO $$
DECLARE bad text[];
BEGIN
  SELECT array_agg(p.oid::regprocedure::text) INTO bad
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='operations'
    AND p.proname IN(
      'ingest_operational_event','claim_event_planning_outbox',
      'begin_event_planning_attempt','complete_event_planning',
      'fail_event_planning','resolve_authorized_audience',
      'resolve_authoritative_notification_policy','is_recipient_channel_authorized',
      'begin_notification_decision','seal_notification_decision'
    )
    AND p.oid::regprocedure::text NOT LIKE ALL(ARRAY[
      'operations.ingest_operational_event(text,text,text,timestamp with time zone,text,text,text,text,uuid,uuid,text,uuid,integer,text,jsonb,text)',
      'operations.claim_event_planning_outbox(text,integer,integer)',
      'operations.begin_event_planning_attempt(uuid,text)',
      'operations.complete_event_planning(uuid,uuid,text,text,text)',
      'operations.fail_event_planning(uuid,uuid,text,text,text,boolean,timestamp with time zone,integer)',
      'operations.resolve_authorized_audience(uuid,text,text,timestamp with time zone)',
      'operations.resolve_authoritative_notification_policy(uuid)',
      'operations.is_recipient_channel_authorized(uuid,uuid,text,text,timestamp with time zone,text)',
      'operations.begin_notification_decision(uuid,uuid,text,uuid,uuid,integer,text,text,jsonb,uuid,text,text,text)',
      'operations.seal_notification_decision(uuid)'
    ]);
  -- Existing R1 expected signatures are allowed; unknown overloads are not.
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'Unknown 10B function collision(s): %',bad;
  END IF;
END $$;

\echo 'PASS: Domain 10B read-only production collision/precondition preflight.'


DO $$
BEGIN
  IF to_regprocedure('operations.severity_rank(text)') IS NULL THEN
    RAISE EXCEPTION 'Reviewed 10A severity_rank(text) prerequisite missing';
  END IF;
END $$;
