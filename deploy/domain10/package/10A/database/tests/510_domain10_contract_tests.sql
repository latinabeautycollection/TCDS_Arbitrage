\set ON_ERROR_STOP on
DO $$ BEGIN IF current_setting('server_version_num')::int<150000 THEN RAISE EXCEPTION 'PostgreSQL 15+ required'; END IF; END $$;
DO $$ DECLARE missing text[]; BEGIN SELECT array_agg(x) INTO missing FROM unnest(ARRAY['operational_events','notification_requests','notification_deliveries','notification_outbox','sms_consent_events','incidents','audit_ledger']) x WHERE to_regclass('operations.'||x) IS NULL; IF missing IS NOT NULL THEN RAISE EXCEPTION 'Missing tables: %',missing; END IF; END $$;
BEGIN;
INSERT INTO operations.event_sources(source_key,domain_number,service_name) VALUES('CERT_SOURCE',99,'Cert') ON CONFLICT DO NOTHING;
INSERT INTO operations.event_types(event_type,description,default_severity) VALUES('CERT_EVENT','Cert','NOTICE') ON CONFLICT DO NOTHING;
WITH s AS(SELECT source_id FROM operations.event_sources WHERE source_key='CERT_SOURCE') INSERT INTO operations.operational_events(source_id,source_event_id,event_type,occurred_at,severity,classification,correlation_id,idempotency_key,payload,payload_hash,producer) SELECT source_id,'E1','CERT_EVENT',clock_timestamp(),'NOTICE','INTERNAL',gen_random_uuid(),'CERT-IDEMP','{}',encode(extensions.digest('{}','sha256'),'hex'),'CERT' FROM s;
DO $$ BEGIN BEGIN UPDATE operations.operational_events SET producer='X' WHERE idempotency_key='CERT-IDEMP'; RAISE EXCEPTION 'immutability failed'; EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE '%append-only%' THEN RAISE; END IF; END; END $$;
ROLLBACK;
BEGIN;
SELECT operations.record_sms_consent_event('CERT-START','+15710000001','START','OPT_IN','2026-08-12T16:00:00Z','h1',gen_random_uuid());
SELECT operations.record_sms_consent_event('CERT-STOP','+15710000001','STOP','OPT_OUT','2026-08-12T16:05:00Z','h2',gen_random_uuid());
SELECT operations.record_sms_consent_event('CERT-STALE','+15710000001','START','OPT_IN','2026-08-12T16:01:00Z','h3',gen_random_uuid());
DO $$ DECLARE s text; BEGIN SELECT status INTO s FROM operations.sms_subscriptions WHERE mobile_e164='+15710000001'; IF s<>'UNSUBSCRIBED' THEN RAISE EXCEPTION 'stale SMS event overwrote STOP: %',s; END IF; END $$;
SELECT operations.record_sms_consent_event('CERT-STOP','+15710000001','STOP','OPT_OUT','2026-08-12T16:05:00Z','h2',gen_random_uuid());
DO $$ DECLARE n int; BEGIN SELECT count(*) INTO n FROM operations.sms_consent_events WHERE provider_event_id='CERT-STOP'; IF n<>1 THEN RAISE EXCEPTION 'Telnyx dedupe failed'; END IF; END $$;
ROLLBACK;
BEGIN;
INSERT INTO operations.audit_ledger(entity_type,entity_id,action,actor_type,details,record_hash) VALUES('CERT','1','CREATE','SYSTEM','{}','x'),('CERT','2','CREATE','SYSTEM','{}','x');
DO $$ DECLARE h text;p text; BEGIN SELECT record_hash INTO h FROM operations.audit_ledger WHERE entity_id='1'; SELECT previous_hash INTO p FROM operations.audit_ledger WHERE entity_id='2'; IF h IS NULL OR p<>h THEN RAISE EXCEPTION 'audit chain failed'; END IF; END $$;
ROLLBACK;
DO $$ DECLARE n int; BEGIN SELECT count(*) INTO n FROM operations.channel_controls WHERE channel IN('EMAIL','SMS') AND (enabled OR NOT emergency_stop); IF n<>0 THEN RAISE EXCEPTION 'controls not fail closed'; END IF; END $$;
\echo 'PASS: Domain 10 10A behavioral database tests'
