\set ON_ERROR_STOP on
-- Run after 510 + 511 on disposable DB.
DO $$ BEGIN
 IF to_regclass('operations.incident_escalation_executions') IS NULL THEN RAISE EXCEPTION 'hardening migration missing'; END IF;
END $$;

-- Frozen policy can retire but cannot mutate definition.
BEGIN;
INSERT INTO operations.notification_audiences(audience_key,description) VALUES('CERT_HARDEN','cert') ON CONFLICT DO NOTHING;
INSERT INTO operations.notification_policies(policy_key,description) VALUES('CERT_HARDEN','cert') ON CONFLICT DO NOTHING;
WITH p AS(SELECT policy_id FROM operations.notification_policies WHERE policy_key='CERT_HARDEN'),
 a AS(SELECT audience_id FROM operations.notification_audiences WHERE audience_key='CERT_HARDEN')
INSERT INTO operations.notification_policy_versions(policy_id,version,lifecycle_state,event_type_pattern,audience_id,frozen_at,frozen_by,definition_hash)
SELECT p.policy_id,1,'FROZEN','CERT_*',a.audience_id,clock_timestamp(),'CERT','h' FROM p,a ON CONFLICT DO NOTHING;
UPDATE operations.notification_policy_versions SET lifecycle_state='RETIRED',effective_until=clock_timestamp()
WHERE policy_id=(SELECT policy_id FROM operations.notification_policies WHERE policy_key='CERT_HARDEN') AND version=1;
DO $$ BEGIN
 BEGIN
  UPDATE operations.notification_policy_versions SET event_type_pattern='ILLEGAL' WHERE policy_id=(SELECT policy_id FROM operations.notification_policies WHERE policy_key='CERT_HARDEN') AND version=1;
  RAISE EXCEPTION 'expected immutable retired policy';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE '%immutable%' THEN RAISE; END IF; END;
END $$;
ROLLBACK;

-- Equal timestamp STOP wins over START.
BEGIN;
SELECT operations.record_sms_consent_event('CERT-EQ-START','+15710000009','START','OPT_IN','2026-08-12T20:00:00Z','h',gen_random_uuid());
SELECT operations.record_sms_consent_event('CERT-EQ-STOP','+15710000009','STOP','OPT_OUT','2026-08-12T20:00:00Z','h',gen_random_uuid());
DO $$ DECLARE s text; BEGIN SELECT status INTO s FROM operations.sms_subscriptions WHERE mobile_e164='+15710000009'; IF s<>'UNSUBSCRIBED' THEN RAISE EXCEPTION 'equal timestamp STOP precedence failed'; END IF; END $$;
ROLLBACK;

-- Provider acceptance contract: Graph must be 202.
DO $$ BEGIN
 IF pg_get_functiondef('operations.record_provider_acceptance(uuid,uuid,text,text,integer,jsonb)'::regprocedure) NOT LIKE '%HTTP 202%' THEN RAISE EXCEPTION 'Graph 202 enforcement missing'; END IF;
END $$;

-- Evidence tables are immutable by trigger presence.
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='trg_provider_receipts_immutable' AND NOT tgisinternal) THEN RAISE EXCEPTION 'provider receipt immutability missing'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='trg_incident_events_immutable' AND NOT tgisinternal) THEN RAISE EXCEPTION 'incident event immutability missing'; END IF;
END $$;

\echo 'PASS: Domain 10 10A.1 hardening behavioral tests'


-- Cross-slice severity ordering required by 10B policy resolution and 10D
-- escalation binding verification.
DO $$
BEGIN
  IF operations.severity_rank('INFORMATIONAL')<>1
     OR operations.severity_rank('NOTICE')<>2
     OR operations.severity_rank('WARNING')<>3
     OR operations.severity_rank('HIGH')<>4
     OR operations.severity_rank('CRITICAL')<>5
     OR operations.severity_rank('EMERGENCY')<>6
     OR operations.severity_rank('UNKNOWN')<>0 THEN
    RAISE EXCEPTION 'Domain 10 severity_rank contract invalid';
  END IF;
END $$;
