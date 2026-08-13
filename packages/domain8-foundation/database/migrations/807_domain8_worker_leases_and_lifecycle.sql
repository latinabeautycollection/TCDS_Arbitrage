-- TCDS Phase 3 Domain 8
-- File: 807_domain8_worker_leases_and_lifecycle.sql
BEGIN;
SET LOCAL lock_timeout='10s'; SET LOCAL statement_timeout='20min';

ALTER TABLE return_defense.idempotency_keys
  ADD COLUMN IF NOT EXISTS processing_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS failed_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS retry_after timestamptz,
  ADD COLUMN IF NOT EXISTS failure_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS release_reason text;

ALTER TABLE return_defense.idempotency_keys DROP CONSTRAINT IF EXISTS idempotency_status_ck;
ALTER TABLE return_defense.idempotency_keys ADD CONSTRAINT idempotency_status_ck
CHECK(status IN('CLAIMED','PROCESSING','COMPLETED','FAILED','CANCELLED','EXPIRED'));
ALTER TABLE return_defense.idempotency_keys ADD CONSTRAINT idempotency_failure_count_ck CHECK(failure_count>=0);

CREATE OR REPLACE FUNCTION return_defense.start_idempotent_processing(p_id uuid,p_owner uuid,p_lease interval)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,return_defense AS $$
DECLARE n int;
BEGIN
 IF p_lease<=interval '0 seconds' OR p_lease>interval '24 hours' THEN RAISE EXCEPTION 'Invalid lease' USING ERRCODE='22023'; END IF;
 UPDATE return_defense.idempotency_keys SET status='PROCESSING',processing_started_at=coalesce(processing_started_at,clock_timestamp()),heartbeat_at=clock_timestamp(),expires_at=clock_timestamp()+p_lease
 WHERE idempotency_id=p_id AND tenant_id=return_defense.current_tenant_id() AND owner_token=p_owner AND status IN('CLAIMED','PROCESSING');
 GET DIAGNOSTICS n=ROW_COUNT; IF n<>1 THEN RAISE EXCEPTION 'Idempotency ownership lost' USING ERRCODE='55000'; END IF;
END$$;
REVOKE ALL ON FUNCTION return_defense.start_idempotent_processing(uuid,uuid,interval) FROM PUBLIC;

CREATE OR REPLACE FUNCTION return_defense.heartbeat_idempotency(p_id uuid,p_owner uuid,p_extend interval)
RETURNS timestamptz LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,return_defense AS $$
DECLARE v timestamptz;
BEGIN
 IF p_extend<=interval '0 seconds' OR p_extend>interval '24 hours' THEN RAISE EXCEPTION 'Invalid lease extension' USING ERRCODE='22023'; END IF;
 UPDATE return_defense.idempotency_keys SET heartbeat_at=clock_timestamp(),expires_at=clock_timestamp()+p_extend
 WHERE idempotency_id=p_id AND tenant_id=return_defense.current_tenant_id() AND owner_token=p_owner AND status='PROCESSING'
 RETURNING expires_at INTO v;
 IF v IS NULL THEN RAISE EXCEPTION 'Idempotency ownership lost or not processing' USING ERRCODE='55000'; END IF; RETURN v;
END$$;
REVOKE ALL ON FUNCTION return_defense.heartbeat_idempotency(uuid,uuid,interval) FROM PUBLIC;

CREATE OR REPLACE FUNCTION return_defense.fail_idempotency_key(p_id uuid,p_owner uuid,p_error_class text,p_error_summary text,p_retry_after timestamptz DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,return_defense AS $$
DECLARE n int;
BEGIN
 UPDATE return_defense.idempotency_keys SET status='FAILED',failed_at=clock_timestamp(),failure_count=failure_count+1,error_class=left(p_error_class,200),error_summary=left(p_error_summary,2000),retry_after=p_retry_after,expires_at=coalesce(p_retry_after,clock_timestamp())
 WHERE idempotency_id=p_id AND tenant_id=return_defense.current_tenant_id() AND owner_token=p_owner AND status IN('CLAIMED','PROCESSING');
 GET DIAGNOSTICS n=ROW_COUNT; IF n<>1 THEN RAISE EXCEPTION 'Idempotency ownership lost' USING ERRCODE='55000'; END IF;
END$$;
REVOKE ALL ON FUNCTION return_defense.fail_idempotency_key(uuid,uuid,text,text,timestamptz) FROM PUBLIC;

CREATE OR REPLACE FUNCTION return_defense.cancel_idempotency_key(p_id uuid,p_owner uuid,p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,return_defense AS $$
DECLARE n int;
BEGIN
 UPDATE return_defense.idempotency_keys SET status='CANCELLED',cancelled_at=clock_timestamp(),release_reason=left(p_reason,1000),expires_at=clock_timestamp()
 WHERE idempotency_id=p_id AND tenant_id=return_defense.current_tenant_id() AND owner_token=p_owner AND status IN('CLAIMED','PROCESSING','FAILED');
 GET DIAGNOSTICS n=ROW_COUNT; IF n<>1 THEN RAISE EXCEPTION 'Idempotency ownership lost' USING ERRCODE='55000'; END IF;
END$$;
REVOKE ALL ON FUNCTION return_defense.cancel_idempotency_key(uuid,uuid,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION return_defense.expire_stale_idempotency_keys(p_limit integer DEFAULT 1000)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,return_defense AS $$
DECLARE n int;
BEGIN
 WITH c AS (SELECT idempotency_id FROM return_defense.idempotency_keys WHERE tenant_id=return_defense.current_tenant_id() AND status IN('CLAIMED','PROCESSING') AND expires_at<=clock_timestamp() ORDER BY expires_at FOR UPDATE SKIP LOCKED LIMIT greatest(1,least(p_limit,10000)))
 UPDATE return_defense.idempotency_keys i SET status='EXPIRED',release_reason='LEASE_EXPIRED' FROM c WHERE i.idempotency_id=c.idempotency_id;
 GET DIAGNOSTICS n=ROW_COUNT; RETURN n;
END$$;
REVOKE ALL ON FUNCTION return_defense.expire_stale_idempotency_keys(integer) FROM PUBLIC;

-- Outbox payload/identity cannot change; only delivery lifecycle fields may change.
CREATE OR REPLACE FUNCTION return_defense.guard_outbox_update()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.domain_event_id IS DISTINCT FROM OLD.domain_event_id OR NEW.topic IS DISTINCT FROM OLD.topic OR NEW.partition_key IS DISTINCT FROM OLD.partition_key OR NEW.payload IS DISTINCT FROM OLD.payload OR NEW.headers IS DISTINCT FROM OLD.headers OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
   RAISE EXCEPTION 'Outbox identity and payload are immutable' USING ERRCODE='55000';
 END IF;
 IF OLD.status IN('PUBLISHED','DEAD_LETTER') AND NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'Terminal outbox record is immutable' USING ERRCODE='55000'; END IF;
 RETURN NEW;
END$$;
DROP TRIGGER IF EXISTS trg_outbox_guard ON return_defense.outbox_events;
CREATE TRIGGER trg_outbox_guard BEFORE UPDATE ON return_defense.outbox_events FOR EACH ROW EXECUTE FUNCTION return_defense.guard_outbox_update();

CREATE OR REPLACE FUNCTION return_defense.claim_outbox_batch(p_worker text,p_limit integer DEFAULT 100,p_lease interval DEFAULT interval '5 minutes')
RETURNS SETOF return_defense.outbox_events LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,return_defense AS $$
BEGIN
 IF p_limit<1 OR p_limit>1000 OR p_lease<=interval '0 seconds' OR p_lease>interval '1 hour' THEN RAISE EXCEPTION 'Invalid outbox claim parameters' USING ERRCODE='22023'; END IF;
 RETURN QUERY WITH c AS (
   SELECT outbox_event_id FROM return_defense.outbox_events WHERE tenant_id=return_defense.current_tenant_id() AND status IN('PENDING','RETRY') AND available_at<=clock_timestamp() ORDER BY available_at,created_at FOR UPDATE SKIP LOCKED LIMIT p_limit
 ) UPDATE return_defense.outbox_events o SET status='LOCKED',locked_by=p_worker,locked_at=clock_timestamp(),last_attempt_at=clock_timestamp(),attempt_count=attempt_count+1,available_at=clock_timestamp()+p_lease FROM c WHERE o.outbox_event_id=c.outbox_event_id RETURNING o.*;
END$$;
REVOKE ALL ON FUNCTION return_defense.claim_outbox_batch(text,integer,interval) FROM PUBLIC;

CREATE OR REPLACE FUNCTION return_defense.mark_outbox_published(p_id uuid,p_worker text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,return_defense AS $$
DECLARE n int; BEGIN
 UPDATE return_defense.outbox_events SET status='PUBLISHED',published_at=clock_timestamp(),locked_by=NULL,locked_at=NULL,last_error=NULL WHERE outbox_event_id=p_id AND tenant_id=return_defense.current_tenant_id() AND status='LOCKED' AND locked_by=p_worker;
 GET DIAGNOSTICS n=ROW_COUNT; IF n<>1 THEN RAISE EXCEPTION 'Outbox ownership lost' USING ERRCODE='55000'; END IF;
END$$;
REVOKE ALL ON FUNCTION return_defense.mark_outbox_published(uuid,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION return_defense.schedule_outbox_retry(p_id uuid,p_worker text,p_error text,p_delay interval)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,return_defense AS $$
DECLARE n int; BEGIN
 UPDATE return_defense.outbox_events SET status=CASE WHEN attempt_count>=max_attempts THEN 'DEAD_LETTER' ELSE 'RETRY' END,available_at=clock_timestamp()+greatest(p_delay,interval '1 second'),last_error=left(p_error,4000),dead_lettered_at=CASE WHEN attempt_count>=max_attempts THEN clock_timestamp() ELSE NULL END,locked_by=NULL,locked_at=NULL
 WHERE outbox_event_id=p_id AND tenant_id=return_defense.current_tenant_id() AND status='LOCKED' AND locked_by=p_worker;
 GET DIAGNOSTICS n=ROW_COUNT; IF n<>1 THEN RAISE EXCEPTION 'Outbox ownership lost' USING ERRCODE='55000'; END IF;
END$$;
REVOKE ALL ON FUNCTION return_defense.schedule_outbox_retry(uuid,text,text,interval) FROM PUBLIC;

CREATE OR REPLACE FUNCTION return_defense.dead_letter_outbox_event(p_id uuid,p_worker text,p_error text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,return_defense AS $$
DECLARE n int; BEGIN
 UPDATE return_defense.outbox_events SET status='DEAD_LETTER',dead_lettered_at=clock_timestamp(),last_error=left(p_error,4000),locked_by=NULL,locked_at=NULL WHERE outbox_event_id=p_id AND tenant_id=return_defense.current_tenant_id() AND status='LOCKED' AND locked_by=p_worker;
 GET DIAGNOSTICS n=ROW_COUNT; IF n<>1 THEN RAISE EXCEPTION 'Outbox ownership lost' USING ERRCODE='55000'; END IF;
END$$;
REVOKE ALL ON FUNCTION return_defense.dead_letter_outbox_event(uuid,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION return_defense.recover_stale_outbox_locks(p_stale_after interval DEFAULT interval '10 minutes',p_limit integer DEFAULT 1000)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,return_defense AS $$
DECLARE n int; BEGIN
 WITH c AS (SELECT outbox_event_id FROM return_defense.outbox_events WHERE tenant_id=return_defense.current_tenant_id() AND status='LOCKED' AND locked_at<clock_timestamp()-p_stale_after ORDER BY locked_at FOR UPDATE SKIP LOCKED LIMIT greatest(1,least(p_limit,10000)))
 UPDATE return_defense.outbox_events o SET status=CASE WHEN attempt_count>=max_attempts THEN 'DEAD_LETTER' ELSE 'RETRY' END,available_at=clock_timestamp(),last_error=coalesce(last_error||'; ','')||'STALE_LOCK_RECOVERED',dead_lettered_at=CASE WHEN attempt_count>=max_attempts THEN clock_timestamp() ELSE NULL END,locked_by=NULL,locked_at=NULL FROM c WHERE o.outbox_event_id=c.outbox_event_id;
 GET DIAGNOSTICS n=ROW_COUNT; RETURN n;
END$$;
REVOKE ALL ON FUNCTION return_defense.recover_stale_outbox_locks(interval,integer) FROM PUBLIC;

DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='tcds_domain8_worker') THEN
  GRANT EXECUTE ON FUNCTION return_defense.start_idempotent_processing(uuid,uuid,interval),return_defense.heartbeat_idempotency(uuid,uuid,interval),return_defense.fail_idempotency_key(uuid,uuid,text,text,timestamptz),return_defense.cancel_idempotency_key(uuid,uuid,text),return_defense.expire_stale_idempotency_keys(integer),return_defense.claim_outbox_batch(text,integer,interval),return_defense.mark_outbox_published(uuid,text),return_defense.schedule_outbox_retry(uuid,text,text,interval),return_defense.dead_letter_outbox_event(uuid,text,text),return_defense.recover_stale_outbox_locks(interval,integer) TO tcds_domain8_worker;
 END IF;
END$$;
COMMIT;
