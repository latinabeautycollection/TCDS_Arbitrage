-- ============================================================================
-- TCDS DOMAIN 10 / SLICE 10A.1 — GREEN TIER 1 HARDENING
-- Applies after 510_domain10_notifications_operations.sql
-- ============================================================================
BEGIN;

-- 1. Policy/template lifecycle: frozen content is immutable, but a frozen
--    version may be retired without altering its governed definition.
DROP TRIGGER IF EXISTS trg_policy_version_immutable ON operations.notification_policy_versions;
CREATE OR REPLACE FUNCTION operations.guard_policy_version_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' AND OLD.lifecycle_state IN('FROZEN','RETIRED') THEN
    RAISE EXCEPTION 'Frozen/retired policy versions cannot be deleted';
  END IF;
  IF TG_OP='UPDATE' AND OLD.lifecycle_state='FROZEN' THEN
    IF NEW.lifecycle_state='RETIRED'
       AND ROW(NEW.event_type_pattern,NEW.minimum_severity,NEW.maximum_classification,
               NEW.audience_id,NEW.email_enabled,NEW.sms_enabled,
               NEW.acknowledgement_required,NEW.acknowledgement_timeout_seconds,
               NEW.incident_required,NEW.suppression_window_seconds,
               NEW.max_delivery_attempts,NEW.escalation_policy_id,NEW.effective_from,
               NEW.definition_hash,NEW.frozen_at,NEW.frozen_by)
         IS NOT DISTINCT FROM
           ROW(OLD.event_type_pattern,OLD.minimum_severity,OLD.maximum_classification,
               OLD.audience_id,OLD.email_enabled,OLD.sms_enabled,
               OLD.acknowledgement_required,OLD.acknowledgement_timeout_seconds,
               OLD.incident_required,OLD.suppression_window_seconds,
               OLD.max_delivery_attempts,OLD.escalation_policy_id,OLD.effective_from,
               OLD.definition_hash,OLD.frozen_at,OLD.frozen_by)
    THEN RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Frozen policy definition is immutable';
  END IF;
  IF TG_OP='UPDATE' AND OLD.lifecycle_state='RETIRED' THEN
    RAISE EXCEPTION 'Retired policy versions are immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_policy_version_immutable
BEFORE UPDATE OR DELETE ON operations.notification_policy_versions
FOR EACH ROW EXECUTE FUNCTION operations.guard_policy_version_mutation();

DROP TRIGGER IF EXISTS trg_template_version_immutable ON operations.notification_template_versions;
CREATE OR REPLACE FUNCTION operations.guard_template_version_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' AND OLD.lifecycle_state IN('FROZEN','RETIRED') THEN
    RAISE EXCEPTION 'Frozen/retired template versions cannot be deleted';
  END IF;
  IF TG_OP='UPDATE' AND OLD.lifecycle_state='FROZEN' THEN
    IF NEW.lifecycle_state='RETIRED'
       AND ROW(NEW.subject_template,NEW.text_template,NEW.html_template,
               NEW.content_hash,NEW.frozen_at,NEW.frozen_by)
         IS NOT DISTINCT FROM
           ROW(OLD.subject_template,OLD.text_template,OLD.html_template,
               OLD.content_hash,OLD.frozen_at,OLD.frozen_by)
    THEN RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Frozen template definition is immutable';
  END IF;
  IF TG_OP='UPDATE' AND OLD.lifecycle_state='RETIRED' THEN
    RAISE EXCEPTION 'Retired template versions are immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_template_version_immutable
BEFORE UPDATE OR DELETE ON operations.notification_template_versions
FOR EACH ROW EXECUTE FUNCTION operations.guard_template_version_mutation();

-- 2. DB-verifiable evidence hashes. JSONB::text is canonical for JSONB storage.
CREATE OR REPLACE FUNCTION operations.verify_operational_event_hash()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE expected text;
BEGIN
  expected:=encode(extensions.digest(NEW.payload::text,'sha256'),'hex');
  IF NEW.payload_hash<>expected THEN
    RAISE EXCEPTION 'operational event payload_hash mismatch';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_operational_event_hash ON operations.operational_events;
CREATE TRIGGER trg_operational_event_hash
BEFORE INSERT ON operations.operational_events
FOR EACH ROW EXECUTE FUNCTION operations.verify_operational_event_hash();

CREATE OR REPLACE FUNCTION operations.verify_template_content_hash()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE expected text;
BEGIN
  expected:=encode(extensions.digest(coalesce(NEW.subject_template,'')||E'\n'||NEW.text_template||E'\n'||coalesce(NEW.html_template,''),'sha256'),'hex');
  IF NEW.content_hash<>expected THEN RAISE EXCEPTION 'template content_hash mismatch'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_template_content_hash ON operations.notification_template_versions;
CREATE TRIGGER trg_template_content_hash
BEFORE INSERT OR UPDATE ON operations.notification_template_versions
FOR EACH ROW EXECUTE FUNCTION operations.verify_template_content_hash();

CREATE OR REPLACE FUNCTION operations.verify_delivery_render_hashes()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s text; b text;
BEGIN
  s:=CASE WHEN NEW.rendered_subject IS NULL THEN NULL ELSE encode(extensions.digest(NEW.rendered_subject,'sha256'),'hex') END;
  b:=encode(extensions.digest(NEW.rendered_text_body||E'\n'||coalesce(NEW.rendered_html_body,''),'sha256'),'hex');
  IF NEW.rendered_subject_hash IS DISTINCT FROM s THEN RAISE EXCEPTION 'rendered subject hash mismatch'; END IF;
  IF NEW.rendered_body_hash<>b THEN RAISE EXCEPTION 'rendered body hash mismatch'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_delivery_render_hashes ON operations.notification_deliveries;
CREATE TRIGGER trg_delivery_render_hashes
BEFORE INSERT OR UPDATE OF rendered_subject,rendered_text_body,rendered_html_body,rendered_subject_hash,rendered_body_hash
ON operations.notification_deliveries
FOR EACH ROW EXECUTE FUNCTION operations.verify_delivery_render_hashes();

-- 3. Freeze notification plan evidence once dispatch begins.
CREATE OR REPLACE FUNCTION operations.guard_notification_request_evidence()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status IN('QUEUED','IN_PROGRESS','COMPLETED','PARTIAL','SUPPRESSED','CANCELLED') THEN
    IF ROW(NEW.event_id,NEW.policy_id,NEW.policy_version,NEW.policy_snapshot,NEW.severity,
           NEW.classification,NEW.acknowledgement_required,NEW.acknowledgement_due_at,
           NEW.incident_required,NEW.idempotency_key,NEW.correlation_id,NEW.trace_id,
           NEW.request_id,NEW.planned_at,NEW.created_by)
       IS DISTINCT FROM
       ROW(OLD.event_id,OLD.policy_id,OLD.policy_version,OLD.policy_snapshot,OLD.severity,
           OLD.classification,OLD.acknowledgement_required,OLD.acknowledgement_due_at,
           OLD.incident_required,OLD.idempotency_key,OLD.correlation_id,OLD.trace_id,
           OLD.request_id,OLD.planned_at,OLD.created_by)
    THEN RAISE EXCEPTION 'Queued notification evidence is immutable'; END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_notification_request_evidence ON operations.notification_requests;
CREATE TRIGGER trg_notification_request_evidence
BEFORE UPDATE ON operations.notification_requests
FOR EACH ROW EXECUTE FUNCTION operations.guard_notification_request_evidence();

CREATE OR REPLACE FUNCTION operations.guard_notification_recipient_snapshot()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE st text;
BEGIN
  SELECT status INTO st FROM operations.notification_requests WHERE notification_id=OLD.notification_id;
  IF st IS DISTINCT FROM 'PLANNED' THEN
    RAISE EXCEPTION 'Recipient snapshots are immutable after planning';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_notification_recipient_snapshot ON operations.notification_recipients;
CREATE TRIGGER trg_notification_recipient_snapshot
BEFORE UPDATE OR DELETE ON operations.notification_recipients
FOR EACH ROW EXECUTE FUNCTION operations.guard_notification_recipient_snapshot();

-- 4. SMS consent: concurrency-safe duplicate handling, STOP precedence for equal timestamps.
CREATE OR REPLACE FUNCTION operations.record_sms_consent_event(
 p_provider_event_id text,p_mobile_e164 text,p_keyword text,p_action text,
 p_occurred_at timestamptz,p_payload_hash text,p_correlation_id uuid,
 p_campaign_external_id text DEFAULT NULL,p_messaging_profile_id text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=operations,pg_temp AS $$
DECLARE v_event uuid; v_status text;
BEGIN
 IF p_mobile_e164 !~ '^\+[1-9][0-9]{7,14}$' THEN RAISE EXCEPTION 'Invalid E.164 mobile number'; END IF;
 IF p_action NOT IN('OPT_IN','OPT_OUT','HELP','INBOUND_OTHER') THEN RAISE EXCEPTION 'Invalid consent action'; END IF;

 INSERT INTO operations.sms_consent_events(provider_event_id,mobile_e164,keyword,action,occurred_at,payload_hash,correlation_id)
 VALUES(p_provider_event_id,p_mobile_e164,upper(p_keyword),p_action,p_occurred_at,p_payload_hash,p_correlation_id)
 ON CONFLICT(provider_event_id) DO NOTHING
 RETURNING consent_event_id INTO v_event;

 IF v_event IS NULL THEN
   SELECT consent_event_id INTO v_event FROM operations.sms_consent_events WHERE provider_event_id=p_provider_event_id;
   RETURN v_event;
 END IF;

 v_status:=CASE p_action WHEN 'OPT_IN' THEN 'SUBSCRIBED' WHEN 'OPT_OUT' THEN 'UNSUBSCRIBED' ELSE NULL END;

 INSERT INTO operations.sms_subscriptions(mobile_e164,phone_hash,status,consent_source,consented_at,opted_out_at,last_keyword,last_event_at,campaign_external_id,messaging_profile_id)
 VALUES(p_mobile_e164,encode(extensions.digest(p_mobile_e164,'sha256'),'hex'),coalesce(v_status,'NEVER_SUBSCRIBED'),
        CASE WHEN v_status IS NULL THEN NULL ELSE 'TELNYX_INBOUND_KEYWORD' END,
        CASE WHEN v_status='SUBSCRIBED' THEN p_occurred_at END,
        CASE WHEN v_status='UNSUBSCRIBED' THEN p_occurred_at END,
        upper(p_keyword),p_occurred_at,p_campaign_external_id,p_messaging_profile_id)
 ON CONFLICT(mobile_e164) DO UPDATE SET
   status=CASE
     WHEN EXCLUDED.last_event_at>operations.sms_subscriptions.last_event_at AND v_status IS NOT NULL THEN v_status
     WHEN EXCLUDED.last_event_at=operations.sms_subscriptions.last_event_at AND v_status='UNSUBSCRIBED' THEN 'UNSUBSCRIBED'
     ELSE operations.sms_subscriptions.status END,
   consent_source=CASE
     WHEN EXCLUDED.last_event_at>operations.sms_subscriptions.last_event_at AND v_status IS NOT NULL THEN 'TELNYX_INBOUND_KEYWORD'
     WHEN EXCLUDED.last_event_at=operations.sms_subscriptions.last_event_at AND v_status='UNSUBSCRIBED' THEN 'TELNYX_INBOUND_KEYWORD'
     ELSE operations.sms_subscriptions.consent_source END,
   consented_at=CASE WHEN EXCLUDED.last_event_at>operations.sms_subscriptions.last_event_at AND v_status='SUBSCRIBED' THEN p_occurred_at ELSE operations.sms_subscriptions.consented_at END,
   opted_out_at=CASE WHEN EXCLUDED.last_event_at>=operations.sms_subscriptions.last_event_at AND v_status='UNSUBSCRIBED' THEN p_occurred_at ELSE operations.sms_subscriptions.opted_out_at END,
   last_keyword=CASE WHEN EXCLUDED.last_event_at>operations.sms_subscriptions.last_event_at OR (EXCLUDED.last_event_at=operations.sms_subscriptions.last_event_at AND v_status='UNSUBSCRIBED') THEN upper(p_keyword) ELSE operations.sms_subscriptions.last_keyword END,
   last_event_at=GREATEST(operations.sms_subscriptions.last_event_at,EXCLUDED.last_event_at),
   campaign_external_id=coalesce(EXCLUDED.campaign_external_id,operations.sms_subscriptions.campaign_external_id),
   messaging_profile_id=coalesce(EXCLUDED.messaging_profile_id,operations.sms_subscriptions.messaging_profile_id),
   updated_at=clock_timestamp();
 RETURN v_event;
END $$;

-- 5. SMS can be claimed only when current consent is SUBSCRIBED. A STOP that
--    arrives after planning but before send suppresses the queued delivery.
CREATE OR REPLACE FUNCTION operations.sms_delivery_currently_eligible(p_delivery_id uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS(
   SELECT 1
   FROM operations.notification_deliveries d
   JOIN operations.notification_recipients nr ON nr.notification_id=d.notification_id AND nr.recipient_id=d.recipient_id
   JOIN operations.sms_subscriptions s ON s.mobile_e164=nr.mobile_snapshot
   JOIN operations.channel_controls cc ON cc.channel='SMS'
   WHERE d.delivery_id=p_delivery_id AND d.channel='SMS' AND nr.sms_selected
     AND s.status='SUBSCRIBED' AND cc.enabled AND NOT cc.emergency_stop
 )
$$;

CREATE OR REPLACE FUNCTION operations.suppress_ineligible_sms()
RETURNS integer LANGUAGE plpgsql AS $$
DECLARE n integer;
BEGIN
 UPDATE operations.notification_deliveries d
 SET state='SUPPRESSED',suppressed_at=clock_timestamp(),suppression_reason='SMS_NOT_CURRENTLY_SUBSCRIBED'
 WHERE d.channel='SMS' AND d.state IN('PENDING','FAILED_RETRYABLE','CLAIMED')
   AND NOT operations.sms_delivery_currently_eligible(d.delivery_id);
 GET DIAGNOSTICS n=ROW_COUNT;
 UPDATE operations.notification_outbox o SET completed_at=clock_timestamp(),lock_owner=NULL,lock_expires_at=NULL
 FROM operations.notification_deliveries d
 WHERE d.delivery_id=o.delivery_id AND d.state='SUPPRESSED' AND o.completed_at IS NULL;
 RETURN n;
END $$;

-- 6. Attempts and receipts are evidence. Restrict updates to completing a STARTED attempt.
CREATE OR REPLACE FUNCTION operations.guard_delivery_attempt_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'delivery_attempts cannot be deleted'; END IF;
 IF OLD.outcome<>'STARTED' THEN RAISE EXCEPTION 'completed delivery attempts are immutable'; END IF;
 IF NEW.delivery_id<>OLD.delivery_id OR NEW.attempt_number<>OLD.attempt_number OR NEW.worker_id<>OLD.worker_id OR NEW.started_at<>OLD.started_at THEN
   RAISE EXCEPTION 'delivery attempt identity is immutable';
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_delivery_attempt_evidence ON operations.delivery_attempts;
CREATE TRIGGER trg_delivery_attempt_evidence BEFORE UPDATE OR DELETE ON operations.delivery_attempts
FOR EACH ROW EXECUTE FUNCTION operations.guard_delivery_attempt_mutation();

CREATE OR REPLACE FUNCTION operations.deny_provider_receipt_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'provider_receipts is append-only'; END $$;
DROP TRIGGER IF EXISTS trg_provider_receipts_immutable ON operations.provider_receipts;
CREATE TRIGGER trg_provider_receipts_immutable BEFORE UPDATE OR DELETE ON operations.provider_receipts
FOR EACH ROW EXECUTE FUNCTION operations.deny_provider_receipt_mutation();

-- 7. Provider-specific acceptance semantics.
CREATE OR REPLACE FUNCTION operations.record_provider_acceptance(
 p_delivery_id uuid,p_attempt_id uuid,p_provider_request_id text,p_provider_message_id text,
 p_http_status integer,p_receipt_payload jsonb DEFAULT '{}'::jsonb)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_provider text;
BEGIN
 SELECT provider INTO v_provider FROM operations.notification_deliveries WHERE delivery_id=p_delivery_id FOR UPDATE;
 IF v_provider IS NULL THEN RAISE EXCEPTION 'Delivery not found'; END IF;
 IF v_provider='MICROSOFT_GRAPH' AND p_http_status<>202 THEN
   RAISE EXCEPTION 'Microsoft Graph sendMail acceptance requires HTTP 202';
 END IF;
 IF v_provider='TELNYX' AND (p_http_status<200 OR p_http_status>=300) THEN
   RAISE EXCEPTION 'Telnyx acceptance requires HTTP 2xx';
 END IF;
 UPDATE operations.delivery_attempts SET outcome='ACCEPTED',completed_at=clock_timestamp(),http_status=p_http_status,
   provider_request_id=p_provider_request_id,provider_message_id=p_provider_message_id
 WHERE attempt_id=p_attempt_id AND delivery_id=p_delivery_id AND outcome='STARTED';
 IF NOT FOUND THEN RAISE EXCEPTION 'Active attempt not found'; END IF;
 UPDATE operations.notification_deliveries SET state='ACCEPTED_BY_PROVIDER',provider_accepted_at=clock_timestamp(),lease_owner=NULL,lease_expires_at=NULL
 WHERE delivery_id=p_delivery_id AND state='SENDING';
 IF NOT FOUND THEN RAISE EXCEPTION 'Delivery is not SENDING'; END IF;
 UPDATE operations.notification_outbox SET completed_at=clock_timestamp(),lock_owner=NULL,lock_expires_at=NULL WHERE delivery_id=p_delivery_id;
 INSERT INTO operations.provider_receipts(provider,provider_message_id,delivery_id,attempt_id,receipt_type,payload,payload_redacted)
 VALUES(v_provider,p_provider_message_id,p_delivery_id,p_attempt_id,'PROVIDER_ACCEPTED',p_receipt_payload,true);
END $$;

ALTER TABLE operations.provider_receipts
  ADD COLUMN IF NOT EXISTS evidence_source text,
  ADD COLUMN IF NOT EXISTS evidence_verified boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION operations.record_final_delivery(
 p_delivery_id uuid,p_provider_event_id text,p_provider_message_id text,p_receipt_payload jsonb,
 p_evidence_source text,p_correlation_id uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_provider text;
BEGIN
 SELECT provider INTO v_provider FROM operations.notification_deliveries WHERE delivery_id=p_delivery_id FOR UPDATE;
 IF v_provider IS NULL THEN RAISE EXCEPTION 'Delivery not found'; END IF;
 IF v_provider='TELNYX' AND p_evidence_source<>'TELNYX_DELIVERY_WEBHOOK' THEN RAISE EXCEPTION 'Invalid Telnyx delivery evidence'; END IF;
 IF v_provider='MICROSOFT_GRAPH' AND p_evidence_source NOT IN('EXCHANGE_MESSAGE_TRACE','EXCHANGE_NDR_RECONCILIATION') THEN
   RAISE EXCEPTION 'Graph 202 alone is not final delivery evidence';
 END IF;
 INSERT INTO operations.provider_receipts(provider,provider_event_id,provider_message_id,delivery_id,receipt_type,payload,payload_redacted,correlation_id,evidence_source,evidence_verified)
 VALUES(v_provider,p_provider_event_id,p_provider_message_id,p_delivery_id,'DELIVERY_CONFIRMED',p_receipt_payload,true,p_correlation_id,p_evidence_source,true)
 ON CONFLICT(provider,provider_event_id) DO NOTHING;
 UPDATE operations.notification_deliveries SET state='DELIVERED',delivered_at=clock_timestamp()
 WHERE delivery_id=p_delivery_id AND state='ACCEPTED_BY_PROVIDER';
 IF NOT FOUND THEN RAISE EXCEPTION 'Delivery is not ACCEPTED_BY_PROVIDER'; END IF;
END $$;

-- 8. Incident state machine and immutable timeline.
CREATE OR REPLACE FUNCTION operations.guard_incident_state_transition()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE ok boolean;
BEGIN
 IF NEW.status=OLD.status THEN RETURN NEW; END IF;
 ok :=
   (OLD.status='OPEN' AND NEW.status IN('ACKNOWLEDGED','INVESTIGATING','CANCELLED')) OR
   (OLD.status='ACKNOWLEDGED' AND NEW.status IN('INVESTIGATING','MITIGATED','CANCELLED')) OR
   (OLD.status='INVESTIGATING' AND NEW.status IN('MITIGATED','RESOLVED','CANCELLED')) OR
   (OLD.status='MITIGATED' AND NEW.status IN('INVESTIGATING','RESOLVED','CANCELLED')) OR
   (OLD.status='RESOLVED' AND NEW.status='CLOSED');
 IF NOT ok THEN RAISE EXCEPTION 'Invalid incident state transition % -> %',OLD.status,NEW.status; END IF;
 IF NEW.status='ACKNOWLEDGED' AND NEW.acknowledged_at IS NULL THEN RAISE EXCEPTION 'ACKNOWLEDGED requires acknowledged_at'; END IF;
 IF NEW.status='RESOLVED' AND NEW.resolved_at IS NULL THEN RAISE EXCEPTION 'RESOLVED requires resolved_at'; END IF;
 IF NEW.status='CLOSED' AND NEW.closed_at IS NULL THEN RAISE EXCEPTION 'CLOSED requires closed_at'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_incident_state_transition ON operations.incidents;
CREATE TRIGGER trg_incident_state_transition BEFORE UPDATE OF status ON operations.incidents
FOR EACH ROW EXECUTE FUNCTION operations.guard_incident_state_transition();

CREATE OR REPLACE FUNCTION operations.deny_incident_event_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'incident_events is append-only'; END $$;
DROP TRIGGER IF EXISTS trg_incident_events_immutable ON operations.incident_events;
CREATE TRIGGER trg_incident_events_immutable BEFORE UPDATE OR DELETE ON operations.incident_events
FOR EACH ROW EXECUTE FUNCTION operations.deny_incident_event_mutation();

-- 9. Repeated escalation evidence: schedule definition and executions are separate.
CREATE TABLE IF NOT EXISTS operations.incident_escalation_executions(
 escalation_execution_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 escalation_id uuid NOT NULL REFERENCES operations.incident_escalations(escalation_id),
 repeat_number integer NOT NULL CHECK(repeat_number>0),
 execution_notification_id uuid REFERENCES operations.notification_requests(notification_id),
 outcome text NOT NULL CHECK(outcome IN('SENT','SUPPRESSED','CANCELLED','FAILED')),
 details jsonb NOT NULL DEFAULT '{}'::jsonb,
 executed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(escalation_id,repeat_number)
);
CREATE OR REPLACE FUNCTION operations.deny_escalation_execution_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'incident_escalation_executions is append-only'; END $$;
DROP TRIGGER IF EXISTS trg_incident_escalation_exec_immutable ON operations.incident_escalation_executions;
CREATE TRIGGER trg_incident_escalation_exec_immutable BEFORE UPDATE OR DELETE ON operations.incident_escalation_executions
FOR EACH ROW EXECUTE FUNCTION operations.deny_escalation_execution_mutation();

-- 10. Suppression strategy is declarative, not executable SQL text.
ALTER TABLE operations.suppression_rules
  ADD COLUMN IF NOT EXISTS grouping_strategy text NOT NULL DEFAULT 'EVENT_SUBJECT',
  ADD COLUMN IF NOT EXISTS grouping_fields jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE operations.suppression_rules
  ADD CONSTRAINT chk_suppression_grouping_strategy
  CHECK(grouping_strategy IN('EVENT_ONLY','EVENT_SUBJECT','CORRELATION','DECLARATIVE_FIELDS'));
ALTER TABLE operations.suppression_rules
  ADD CONSTRAINT chk_suppression_grouping_fields_array CHECK(jsonb_typeof(grouping_fields)='array');
COMMENT ON COLUMN operations.suppression_rules.grouping_expression IS
'DEPRECATED. Do not execute as SQL. Use grouping_strategy/grouping_fields.';

-- 11. Retention/governance registry. Actual destructive purge remains separate and approved.
CREATE TABLE IF NOT EXISTS operations.retention_policies(
 retention_key text PRIMARY KEY,
 relation_name text NOT NULL UNIQUE,
 retain_for interval,
 legal_hold_eligible boolean NOT NULL DEFAULT true,
 purge_enabled boolean NOT NULL DEFAULT false,
 approved_by text NOT NULL,
 approval_reference text,
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK(retain_for IS NULL OR retain_for>interval '0 seconds')
);

COMMIT;

-- Cross-slice severity-order helper.
-- Ownership: 10A owns the canonical severity taxonomy; 10B/10D may consume it.
CREATE OR REPLACE FUNCTION operations.severity_rank(v text)
RETURNS int
LANGUAGE sql
IMMUTABLE
STRICT
AS $$
 SELECT CASE upper(v)
   WHEN 'INFORMATIONAL' THEN 1
   WHEN 'NOTICE' THEN 2
   WHEN 'WARNING' THEN 3
   WHEN 'HIGH' THEN 4
   WHEN 'CRITICAL' THEN 5
   WHEN 'EMERGENCY' THEN 6
   ELSE 0
 END
$$;

