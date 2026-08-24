\set ON_ERROR_STOP on

-- Run only in a disposable certification DB with reviewed 10A + 513 applied.

DO $$
BEGIN
  IF to_regclass('operations.notification_decisions') IS NULL THEN
    RAISE EXCEPTION '10B notification_decisions missing';
  END IF;
  IF to_regclass('operations.event_planning_outbox') IS NULL THEN
    RAISE EXCEPTION '10B event_planning_outbox missing';
  END IF;
  IF to_regclass('operations.event_contract_versions') IS NULL THEN
    RAISE EXCEPTION '10B event_contract_versions missing';
  END IF;
END $$;

-- Event-pattern matching.
DO $$
BEGIN
  IF NOT operations.event_type_pattern_matches('WORKER_*','WORKER_FAILURE') THEN
    RAISE EXCEPTION 'Prefix event pattern failed';
  END IF;
  IF operations.event_type_pattern_matches('RETURN_CREATED','WORKER_FAILURE') THEN
    RAISE EXCEPTION 'Exact event pattern false positive';
  END IF;
END $$;

-- Contract hash + immutable frozen schema.
BEGIN;
INSERT INTO operations.event_types(event_type,description,default_severity)
VALUES('CERT_10B_EVENT','10B certification','NOTICE')
ON CONFLICT(event_type) DO NOTHING;

WITH x AS(
  SELECT
    '{"type":"object","required":["code"],"properties":{"code":{"type":"string"}},"additionalProperties":false}'::jsonb js,
    ARRAY['code']::text[] req,
    '{"code":"string"}'::jsonb types
)
INSERT INTO operations.event_contract_versions(
  event_type,schema_version,lifecycle_state,json_schema,required_top_level_fields,
  top_level_types,schema_hash,frozen_at,frozen_by
)
SELECT 'CERT_10B_EVENT',1,'FROZEN',js,req,types,
       encode(extensions.digest(js::text||E'\n'||array_to_string(req,',')||E'\n'||types::text,'sha256'),'hex'),
       clock_timestamp(),'CERT'
FROM x;

DO $$
BEGIN
  BEGIN
    UPDATE operations.event_contract_versions SET json_schema='{}'::jsonb
    WHERE event_type='CERT_10B_EVENT' AND schema_version=1;
    RAISE EXCEPTION 'Expected frozen event contract mutation rejection';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '%immutable%' THEN RAISE; END IF;
  END;
END $$;
ROLLBACK;

-- Decision evidence immutability is structurally present.
DO $$
BEGIN
  IF NOT EXISTS(
    SELECT 1 FROM pg_trigger
    WHERE tgname='trg_notification_decision_immutable' AND NOT tgisinternal
  ) THEN RAISE EXCEPTION 'Decision immutability trigger missing'; END IF;
END $$;

-- Planning claim function must use SKIP LOCKED.
DO $$
DECLARE def text;
BEGIN
  SELECT pg_get_functiondef('operations.claim_event_planning_outbox(text,integer,integer)'::regprocedure)
  INTO def;
  IF position('SKIP LOCKED' IN upper(def))=0 THEN
    RAISE EXCEPTION 'Planning claim function lacks SKIP LOCKED';
  END IF;
END $$;

-- Policy binding is required before freeze.
BEGIN;
INSERT INTO operations.notification_audiences(audience_key,description,audience_type)
VALUES('CERT_10B_AUD','cert','STATIC')
ON CONFLICT(audience_key) DO NOTHING;

INSERT INTO operations.notification_policies(policy_key,description)
VALUES('CERT_10B_POLICY','cert')
ON CONFLICT(policy_key) DO NOTHING;

INSERT INTO operations.notification_templates(template_key,channel,description)
VALUES('CERT_10B_EMAIL','EMAIL','cert')
ON CONFLICT(template_key) DO NOTHING;

WITH t AS(
  SELECT template_id FROM operations.notification_templates WHERE template_key='CERT_10B_EMAIL'
)
INSERT INTO operations.notification_template_versions(
  template_id,version,lifecycle_state,subject_template,text_template,html_template,
  content_hash,frozen_at,frozen_by
)
SELECT template_id,1,'FROZEN','Test','Test','<p>Test</p>',
  encode(extensions.digest('Test'||E'\n'||'Test'||E'\n'||'<p>Test</p>','sha256'),'hex'),
  clock_timestamp(),'CERT'
FROM t
ON CONFLICT(template_id,version) DO NOTHING;

WITH p AS(
  SELECT policy_id FROM operations.notification_policies WHERE policy_key='CERT_10B_POLICY'
),a AS(
  SELECT audience_id FROM operations.notification_audiences WHERE audience_key='CERT_10B_AUD'
)
INSERT INTO operations.notification_policy_versions(
  policy_id,version,lifecycle_state,event_type_pattern,minimum_severity,maximum_classification,
  audience_id,email_enabled,sms_enabled,definition_hash
)
SELECT p.policy_id,1,'DRAFT','CERT_10B_EVENT','NOTICE','INTERNAL',
       a.audience_id,true,false,'DRAFT'
FROM p,a
ON CONFLICT(policy_id,version) DO NOTHING;

DO $$
DECLARE pid uuid;
BEGIN
  SELECT policy_id INTO pid FROM operations.notification_policies WHERE policy_key='CERT_10B_POLICY';
  BEGIN
    UPDATE operations.notification_policy_versions SET lifecycle_state='FROZEN',frozen_at=clock_timestamp(),frozen_by='CERT'
    WHERE policy_id=pid AND version=1;
    RAISE EXCEPTION 'Expected freeze without template binding to fail';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '%template binding%' THEN RAISE; END IF;
  END;
END $$;

ROLLBACK;

\echo 'PASS: Domain 10 Slice 10B PostgreSQL contract tests.'
