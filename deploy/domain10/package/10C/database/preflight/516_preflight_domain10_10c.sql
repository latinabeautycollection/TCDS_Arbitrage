\set ON_ERROR_STOP on

DO $$
DECLARE missing text[];
BEGIN
  SELECT array_agg(name) INTO missing
  FROM unnest(ARRAY[
    'operational_events',
    'notification_requests',
    'notification_recipients',
    'notification_deliveries',
    'delivery_attempts',
    'notification_outbox',
    'provider_receipts',
    'dead_letters',
    'sms_subscriptions',
    'channel_controls',
    'channel_rate_limits',
    'rate_limit_buckets',
    'notification_decisions'
  ]) AS name
  WHERE to_regclass('operations.'||name) IS NULL;

  IF missing IS NOT NULL THEN
    RAISE EXCEPTION '10C prerequisite objects missing: %',missing;
  END IF;
END $$;

DO $$
BEGIN
  IF to_regprocedure('operations.claim_notification_outbox(text,text,integer,integer)') IS NULL THEN
    RAISE EXCEPTION 'Reviewed 10A claim_notification_outbox prerequisite missing';
  END IF;
  IF to_regprocedure('operations.sms_delivery_currently_eligible(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Reviewed 10A SMS send-time consent prerequisite missing';
  END IF;
  IF to_regprocedure('operations.record_provider_acceptance(uuid,uuid,text,text,integer,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'Reviewed 10A provider acceptance prerequisite missing';
  END IF;
  IF to_regprocedure('operations.record_final_delivery(uuid,text,text,jsonb,text,uuid)') IS NULL THEN
    RAISE EXCEPTION 'Reviewed 10A final-delivery evidence prerequisite missing';
  END IF;
  IF to_regprocedure('operations.resolve_authoritative_notification_policy(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Reviewed 10B prerequisite missing';
  END IF;
END $$;

\echo 'PASS: 10C prerequisite contract is present.'
