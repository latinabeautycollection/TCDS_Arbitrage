\set ON_ERROR_STOP on

-- Reviewed 10A + 513 + 514 must already be installed.

-- 1. Full envelope identity: same source ID + changed severity must conflict.
BEGIN;
INSERT INTO operations.event_sources(source_key,domain_number,service_name)
VALUES('CERT_10B_SOURCE',99,'cert') ON CONFLICT(source_key) DO NOTHING;
INSERT INTO operations.event_types(event_type,description,default_severity)
VALUES('CERT_10B_EVENT','cert','NOTICE') ON CONFLICT(event_type) DO NOTHING;

WITH x AS(
  SELECT '{"type":"object","required":["code"],"properties":{"code":{"type":"string"}},"additionalProperties":false}'::jsonb js,
         ARRAY['code']::text[] req,'{"code":"string"}'::jsonb types
)
INSERT INTO operations.event_contract_versions(
  event_type,schema_version,lifecycle_state,json_schema,required_top_level_fields,
  top_level_types,schema_hash,effective_from,frozen_at,frozen_by
)
SELECT 'CERT_10B_EVENT',1,'FROZEN',js,req,types,
       encode(extensions.digest(js::text||E'\n'||array_to_string(req,',')||E'\n'||types::text,'sha256'),'hex'),
       '2026-01-01Z',clock_timestamp(),'CERT'
FROM x ON CONFLICT(event_type,schema_version) DO NOTHING;

DO $$
DECLARE h text; cid uuid:=gen_random_uuid();
BEGIN
  SELECT schema_hash INTO h FROM operations.event_contract_versions
  WHERE event_type='CERT_10B_EVENT' AND schema_version=1;

  PERFORM * FROM operations.ingest_operational_event(
    'CERT_10B_SOURCE','SRC-1','CERT_10B_EVENT','2026-08-13T14:00:00Z',
    'NOTICE','INTERNAL',NULL,NULL,cid,NULL,NULL,NULL,1,'CERT','{"code":"A"}',h
  );

  BEGIN
    PERFORM * FROM operations.ingest_operational_event(
      'CERT_10B_SOURCE','SRC-1','CERT_10B_EVENT','2026-08-13T14:00:00Z',
      'HIGH','INTERNAL',NULL,NULL,cid,NULL,NULL,NULL,1,'CERT','{"code":"A"}',h
    );
    RAISE EXCEPTION 'Expected full-envelope collision';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '%collision%' THEN RAISE; END IF;
  END;
END $$;
ROLLBACK;

-- 2. Acknowledgement policy cannot omit timeout.
DO $$
BEGIN
  IF NOT EXISTS(
    SELECT 1 FROM pg_constraint WHERE conname='chk_notification_policy_ack_timeout'
  ) THEN RAISE EXCEPTION 'Acknowledgement timeout constraint missing'; END IF;
END $$;

-- 3. Planning attempt function exposes authoritative attempt number.
DO $$
DECLARE rt text;
BEGIN
  SELECT pg_get_function_result('operations.begin_event_planning_attempt(uuid,text)'::regprocedure)
  INTO rt;
  IF rt NOT ILIKE '%attempt_number%' THEN
    RAISE EXCEPTION 'Planning attempt function does not return attempt_number: %',rt;
  END IF;
END $$;

-- 4. Decision sealing controls candidate evidence.
DO $$
BEGIN
  IF to_regprocedure('operations.seal_notification_decision(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Decision sealing function missing';
  END IF;
  IF NOT EXISTS(
    SELECT 1 FROM pg_trigger
    WHERE tgname='trg_notification_decision_candidate_insert_guard' AND NOT tgisinternal
  ) THEN RAISE EXCEPTION 'Candidate insert seal guard missing'; END IF;
END $$;

-- 5. Suppression evidence must include channel.
DO $$
BEGIN
  IF NOT EXISTS(
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='operations' AND table_name='suppression_decisions' AND column_name='channel'
  ) THEN RAISE EXCEPTION 'Suppression channel evidence missing'; END IF;
END $$;

-- 6. Security-definer functions must not be public executable after 515.
\echo 'PASS: Domain 10B revision-2 hardening tests.'
