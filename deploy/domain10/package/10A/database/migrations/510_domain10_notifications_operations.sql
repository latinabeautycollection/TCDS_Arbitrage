BEGIN;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA IF NOT EXISTS operations;
COMMENT ON SCHEMA operations IS 'Domain 10 authoritative Notifications & Operations contract. Human channels: EMAIL and SMS only.';

CREATE OR REPLACE FUNCTION operations.classification_rank(v text) RETURNS int LANGUAGE sql IMMUTABLE STRICT AS $$
 SELECT CASE upper(v) WHEN 'PUBLIC' THEN 1 WHEN 'INTERNAL' THEN 2 WHEN 'CONFIDENTIAL' THEN 3 WHEN 'RESTRICTED' THEN 4 ELSE 0 END $$;
CREATE OR REPLACE FUNCTION operations.set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at:=clock_timestamp(); RETURN NEW; END $$;

CREATE TABLE operations.event_sources(
 source_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), source_key text NOT NULL UNIQUE CHECK(source_key=upper(source_key)),
 domain_number int, service_name text NOT NULL, description text, enabled boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK(domain_number IS NULL OR domain_number BETWEEN 1 AND 99));
CREATE TRIGGER trg_event_sources_updated BEFORE UPDATE ON operations.event_sources FOR EACH ROW EXECUTE FUNCTION operations.set_updated_at();

CREATE TABLE operations.event_types(
 event_type text PRIMARY KEY CHECK(event_type=upper(event_type)), description text NOT NULL,
 default_severity text NOT NULL CHECK(default_severity IN('INFORMATIONAL','NOTICE','WARNING','HIGH','CRITICAL','EMERGENCY')),
 default_classification text NOT NULL DEFAULT 'INTERNAL' CHECK(default_classification IN('PUBLIC','INTERNAL','CONFIDENTIAL','RESTRICTED')),
 incident_capable boolean NOT NULL DEFAULT true, enabled boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT clock_timestamp());

CREATE TABLE operations.operational_events(
 event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), source_id uuid NOT NULL REFERENCES operations.event_sources,
 source_event_id text NOT NULL, event_type text NOT NULL REFERENCES operations.event_types,
 occurred_at timestamptz NOT NULL, received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 severity text NOT NULL CHECK(severity IN('INFORMATIONAL','NOTICE','WARNING','HIGH','CRITICAL','EMERGENCY')),
 classification text NOT NULL CHECK(classification IN('PUBLIC','INTERNAL','CONFIDENTIAL','RESTRICTED')),
 subject_type text, subject_id text, correlation_id uuid NOT NULL, causation_id uuid, trace_id text, request_id uuid,
 idempotency_key text NOT NULL UNIQUE, schema_version int NOT NULL DEFAULT 1 CHECK(schema_version>0),
 payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object'), payload_hash text NOT NULL, producer text NOT NULL,
 UNIQUE(source_id,source_event_id));
CREATE INDEX idx_operational_events_type_time ON operations.operational_events(event_type,occurred_at DESC);
CREATE INDEX idx_operational_events_correlation ON operations.operational_events(correlation_id,occurred_at);
CREATE OR REPLACE FUNCTION operations.deny_event_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'operations.operational_events is append-only'; END $$;
CREATE TRIGGER trg_operational_events_immutable BEFORE UPDATE OR DELETE ON operations.operational_events FOR EACH ROW EXECUTE FUNCTION operations.deny_event_mutation();

CREATE TABLE operations.event_processing(
 event_id uuid PRIMARY KEY REFERENCES operations.operational_events, processing_state text NOT NULL DEFAULT 'PENDING' CHECK(processing_state IN('PENDING','PLANNING','PLANNED','SUPPRESSED','FAILED','CANCELLED')),
 planned_at timestamptz, suppressed_at timestamptz, suppression_reason text, last_error text, attempt_count int NOT NULL DEFAULT 0 CHECK(attempt_count>=0), updated_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TRIGGER trg_event_processing_updated BEFORE UPDATE ON operations.event_processing FOR EACH ROW EXECUTE FUNCTION operations.set_updated_at();

CREATE TABLE operations.recipient_directory(
 recipient_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), employee_key text, display_name text NOT NULL,
 email_address text, mobile_e164 text, recipient_type text NOT NULL DEFAULT 'EMPLOYEE' CHECK(recipient_type IN('OWNER','EXECUTIVE','EMPLOYEE','CONTRACTOR','SERVICE_ACCOUNT')),
 department text, role_key text, enabled boolean NOT NULL DEFAULT true, source_system text NOT NULL DEFAULT 'TCDS', source_version text,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK(email_address IS NOT NULL OR mobile_e164 IS NOT NULL), CHECK(mobile_e164 IS NULL OR mobile_e164 ~ '^\+[1-9][0-9]{7,14}$'));
CREATE UNIQUE INDEX uq_recipient_email_lower ON operations.recipient_directory(lower(email_address)) WHERE email_address IS NOT NULL;
CREATE UNIQUE INDEX uq_recipient_mobile ON operations.recipient_directory(mobile_e164) WHERE mobile_e164 IS NOT NULL;
CREATE UNIQUE INDEX uq_recipient_employee_key ON operations.recipient_directory(employee_key) WHERE employee_key IS NOT NULL;
CREATE TRIGGER trg_recipient_directory_updated BEFORE UPDATE ON operations.recipient_directory FOR EACH ROW EXECUTE FUNCTION operations.set_updated_at();

CREATE TABLE operations.notification_audiences(
 audience_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), audience_key text NOT NULL UNIQUE CHECK(audience_key=upper(audience_key)),
 description text NOT NULL, audience_type text NOT NULL DEFAULT 'STATIC' CHECK(audience_type IN('STATIC','DYNAMIC','ON_CALL')),
 enabled boolean NOT NULL DEFAULT true, owner_role text, created_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TRIGGER trg_audiences_updated BEFORE UPDATE ON operations.notification_audiences FOR EACH ROW EXECUTE FUNCTION operations.set_updated_at();
CREATE TABLE operations.audience_members(
 audience_id uuid NOT NULL REFERENCES operations.notification_audiences ON DELETE CASCADE,
 recipient_id uuid NOT NULL REFERENCES operations.recipient_directory ON DELETE CASCADE,
 valid_from timestamptz NOT NULL DEFAULT clock_timestamp(), valid_until timestamptz, source text NOT NULL DEFAULT 'MANUAL', created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(audience_id,recipient_id), CHECK(valid_until IS NULL OR valid_until>valid_from));

CREATE TABLE operations.recipient_authorizations(
 authorization_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), recipient_id uuid NOT NULL REFERENCES operations.recipient_directory,
 event_type_pattern text NOT NULL DEFAULT '*', max_classification text NOT NULL DEFAULT 'INTERNAL' CHECK(max_classification IN('PUBLIC','INTERNAL','CONFIDENTIAL','RESTRICTED')),
 allow_email boolean NOT NULL DEFAULT true, allow_sms boolean NOT NULL DEFAULT false, enabled boolean NOT NULL DEFAULT true,
 valid_from timestamptz NOT NULL DEFAULT clock_timestamp(), valid_until timestamptz, approved_by text NOT NULL, approval_reference text,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), CHECK(valid_until IS NULL OR valid_until>valid_from));
CREATE UNIQUE INDEX uq_recipient_auth_scope ON operations.recipient_authorizations(recipient_id,event_type_pattern,max_classification);

CREATE TABLE operations.escalation_policies(
 escalation_policy_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), policy_key text NOT NULL UNIQUE CHECK(policy_key=upper(policy_key)), description text NOT NULL,
 enabled boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TRIGGER trg_escalation_policy_updated BEFORE UPDATE ON operations.escalation_policies FOR EACH ROW EXECUTE FUNCTION operations.set_updated_at();
CREATE TABLE operations.escalation_steps(
 escalation_policy_id uuid NOT NULL REFERENCES operations.escalation_policies ON DELETE CASCADE, step_number int NOT NULL CHECK(step_number>0), wait_seconds int NOT NULL CHECK(wait_seconds>=0),
 audience_id uuid NOT NULL REFERENCES operations.notification_audiences, use_email boolean NOT NULL DEFAULT true, use_sms boolean NOT NULL DEFAULT true,
 require_ack boolean NOT NULL DEFAULT true, repeat_count int NOT NULL DEFAULT 1 CHECK(repeat_count BETWEEN 1 AND 10), created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(escalation_policy_id,step_number), CHECK(use_email OR use_sms));

CREATE TABLE operations.notification_policies(
 policy_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), policy_key text NOT NULL UNIQUE CHECK(policy_key=upper(policy_key)), description text NOT NULL,
 enabled boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TRIGGER trg_notification_policy_updated BEFORE UPDATE ON operations.notification_policies FOR EACH ROW EXECUTE FUNCTION operations.set_updated_at();
CREATE TABLE operations.notification_policy_versions(
 policy_id uuid NOT NULL REFERENCES operations.notification_policies ON DELETE CASCADE, version int NOT NULL CHECK(version>0), lifecycle_state text NOT NULL DEFAULT 'DRAFT' CHECK(lifecycle_state IN('DRAFT','FROZEN','RETIRED')),
 event_type_pattern text NOT NULL, minimum_severity text NOT NULL DEFAULT 'INFORMATIONAL' CHECK(minimum_severity IN('INFORMATIONAL','NOTICE','WARNING','HIGH','CRITICAL','EMERGENCY')),
 maximum_classification text NOT NULL DEFAULT 'INTERNAL' CHECK(maximum_classification IN('PUBLIC','INTERNAL','CONFIDENTIAL','RESTRICTED')),
 audience_id uuid NOT NULL REFERENCES operations.notification_audiences, email_enabled boolean NOT NULL DEFAULT true, sms_enabled boolean NOT NULL DEFAULT false,
 acknowledgement_required boolean NOT NULL DEFAULT false, acknowledgement_timeout_seconds int, incident_required boolean NOT NULL DEFAULT false,
 suppression_window_seconds int NOT NULL DEFAULT 0 CHECK(suppression_window_seconds>=0), max_delivery_attempts int NOT NULL DEFAULT 5 CHECK(max_delivery_attempts BETWEEN 1 AND 20),
 escalation_policy_id uuid REFERENCES operations.escalation_policies, effective_from timestamptz, effective_until timestamptz, frozen_at timestamptz, frozen_by text,
 definition_hash text NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(), PRIMARY KEY(policy_id,version), CHECK(email_enabled OR sms_enabled),
 CHECK(acknowledgement_timeout_seconds IS NULL OR acknowledgement_timeout_seconds>0), CHECK(effective_until IS NULL OR effective_from IS NULL OR effective_until>effective_from),
 CHECK(lifecycle_state='DRAFT' OR (frozen_at IS NOT NULL AND frozen_by IS NOT NULL)));
CREATE UNIQUE INDEX uq_policy_open_frozen ON operations.notification_policy_versions(policy_id) WHERE lifecycle_state='FROZEN' AND effective_until IS NULL;
CREATE OR REPLACE FUNCTION operations.guard_frozen_policy() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF OLD.lifecycle_state IN('FROZEN','RETIRED') THEN RAISE EXCEPTION 'Frozen/retired notification policy versions are immutable'; END IF; RETURN NEW; END $$;
CREATE TRIGGER trg_policy_version_immutable BEFORE UPDATE OR DELETE ON operations.notification_policy_versions FOR EACH ROW EXECUTE FUNCTION operations.guard_frozen_policy();

CREATE TABLE operations.notification_templates(
 template_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), template_key text NOT NULL UNIQUE CHECK(template_key=upper(template_key)), channel text NOT NULL CHECK(channel IN('EMAIL','SMS')), description text NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TABLE operations.notification_template_versions(
 template_id uuid NOT NULL REFERENCES operations.notification_templates ON DELETE CASCADE, version int NOT NULL CHECK(version>0), lifecycle_state text NOT NULL DEFAULT 'DRAFT' CHECK(lifecycle_state IN('DRAFT','FROZEN','RETIRED')),
 subject_template text, text_template text NOT NULL, html_template text, content_hash text NOT NULL, frozen_at timestamptz, frozen_by text, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(template_id,version), CHECK(lifecycle_state='DRAFT' OR (frozen_at IS NOT NULL AND frozen_by IS NOT NULL)));
CREATE OR REPLACE FUNCTION operations.guard_frozen_template() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF OLD.lifecycle_state IN('FROZEN','RETIRED') THEN RAISE EXCEPTION 'Frozen/retired notification template versions are immutable'; END IF; RETURN NEW; END $$;
CREATE TRIGGER trg_template_version_immutable BEFORE UPDATE OR DELETE ON operations.notification_template_versions FOR EACH ROW EXECUTE FUNCTION operations.guard_frozen_template();

CREATE TABLE operations.notification_requests(
 notification_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), event_id uuid NOT NULL REFERENCES operations.operational_events,
 policy_id uuid NOT NULL, policy_version int NOT NULL, policy_snapshot jsonb NOT NULL CHECK(jsonb_typeof(policy_snapshot)='object'),
 severity text NOT NULL CHECK(severity IN('INFORMATIONAL','NOTICE','WARNING','HIGH','CRITICAL','EMERGENCY')),
 classification text NOT NULL CHECK(classification IN('PUBLIC','INTERNAL','CONFIDENTIAL','RESTRICTED')),
 acknowledgement_required boolean NOT NULL DEFAULT false, acknowledgement_due_at timestamptz, incident_required boolean NOT NULL DEFAULT false,
 status text NOT NULL DEFAULT 'PLANNED' CHECK(status IN('PLANNED','QUEUED','IN_PROGRESS','COMPLETED','PARTIAL','SUPPRESSED','CANCELLED')),
 idempotency_key text NOT NULL UNIQUE, correlation_id uuid NOT NULL, trace_id text, request_id uuid, planned_at timestamptz NOT NULL DEFAULT clock_timestamp(), created_by text NOT NULL,
 FOREIGN KEY(policy_id,policy_version) REFERENCES operations.notification_policy_versions(policy_id,version),
 CHECK(NOT acknowledgement_required OR acknowledgement_due_at IS NOT NULL), UNIQUE(event_id,policy_id,policy_version));
CREATE INDEX idx_notification_requests_corr ON operations.notification_requests(correlation_id,planned_at DESC);

CREATE TABLE operations.notification_recipients(
 notification_id uuid NOT NULL REFERENCES operations.notification_requests ON DELETE CASCADE, recipient_id uuid NOT NULL REFERENCES operations.recipient_directory,
 email_snapshot text, mobile_snapshot text, display_name_snapshot text NOT NULL, audience_key_snapshot text, authorization_snapshot jsonb NOT NULL,
 email_selected boolean NOT NULL DEFAULT false, sms_selected boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(notification_id,recipient_id), CHECK(email_selected OR sms_selected), CHECK(NOT email_selected OR email_snapshot IS NOT NULL), CHECK(NOT sms_selected OR mobile_snapshot IS NOT NULL),
 CHECK(mobile_snapshot IS NULL OR mobile_snapshot ~ '^\+[1-9][0-9]{7,14}$'));

CREATE TABLE operations.incidents(
 incident_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), incident_key text NOT NULL UNIQUE, root_event_id uuid NOT NULL REFERENCES operations.operational_events,
 notification_id uuid REFERENCES operations.notification_requests, status text NOT NULL DEFAULT 'OPEN' CHECK(status IN('OPEN','ACKNOWLEDGED','INVESTIGATING','MITIGATED','RESOLVED','CLOSED','CANCELLED')),
 severity text NOT NULL CHECK(severity IN('INFORMATIONAL','NOTICE','WARNING','HIGH','CRITICAL','EMERGENCY')), title text NOT NULL, summary text NOT NULL,
 owner_audience_id uuid REFERENCES operations.notification_audiences, opened_at timestamptz NOT NULL DEFAULT clock_timestamp(), acknowledged_at timestamptz, resolved_at timestamptz, closed_at timestamptz,
 resolution_code text, correlation_id uuid NOT NULL, updated_at timestamptz NOT NULL DEFAULT clock_timestamp(), CHECK(resolved_at IS NULL OR resolved_at>=opened_at), CHECK(closed_at IS NULL OR closed_at>=opened_at));
CREATE TRIGGER trg_incidents_updated BEFORE UPDATE ON operations.incidents FOR EACH ROW EXECUTE FUNCTION operations.set_updated_at();
CREATE TABLE operations.incident_events(
 incident_event_id bigserial PRIMARY KEY, incident_id uuid NOT NULL REFERENCES operations.incidents, event_type text NOT NULL, from_status text, to_status text,
 actor_type text NOT NULL, actor_id text, details jsonb NOT NULL DEFAULT '{}'::jsonb, occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(), correlation_id uuid NOT NULL);
CREATE INDEX idx_incident_timeline ON operations.incident_events(incident_id,occurred_at,incident_event_id);
CREATE TABLE operations.incident_assignments(
 assignment_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), incident_id uuid NOT NULL REFERENCES operations.incidents, recipient_id uuid REFERENCES operations.recipient_directory,
 audience_id uuid REFERENCES operations.notification_audiences, assignment_role text NOT NULL, assigned_at timestamptz NOT NULL DEFAULT clock_timestamp(), released_at timestamptz, assigned_by text NOT NULL,
 CHECK((recipient_id IS NOT NULL)<>(audience_id IS NOT NULL)), CHECK(released_at IS NULL OR released_at>=assigned_at));
CREATE TABLE operations.incident_acknowledgements(
 acknowledgement_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), incident_id uuid NOT NULL REFERENCES operations.incidents, notification_id uuid REFERENCES operations.notification_requests,
 recipient_id uuid NOT NULL REFERENCES operations.recipient_directory, channel text NOT NULL CHECK(channel IN('EMAIL','SMS','APPLICATION')),
 acknowledgement_type text NOT NULL DEFAULT 'ACK' CHECK(acknowledgement_type IN('ACK','OWN','DECLINE')), provider_message_id text, acknowledged_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 correlation_id uuid NOT NULL, UNIQUE(incident_id,recipient_id,acknowledgement_type));
CREATE TABLE operations.incident_escalations(
 escalation_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), incident_id uuid NOT NULL REFERENCES operations.incidents, escalation_policy_id uuid NOT NULL REFERENCES operations.escalation_policies,
 step_number int NOT NULL CHECK(step_number>0), target_audience_id uuid NOT NULL REFERENCES operations.notification_audiences, scheduled_at timestamptz NOT NULL,
 executed_at timestamptz, cancelled_at timestamptz, execution_notification_id uuid REFERENCES operations.notification_requests, reason text NOT NULL, correlation_id uuid NOT NULL,
 UNIQUE(incident_id,escalation_policy_id,step_number), CHECK(executed_at IS NULL OR executed_at>=scheduled_at), CHECK(cancelled_at IS NULL OR executed_at IS NULL));

CREATE TABLE operations.notification_deliveries(
 delivery_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), notification_id uuid NOT NULL REFERENCES operations.notification_requests, recipient_id uuid NOT NULL REFERENCES operations.recipient_directory,
 channel text NOT NULL CHECK(channel IN('EMAIL','SMS')), provider text NOT NULL CHECK(provider IN('MICROSOFT_GRAPH','TELNYX')),
 state text NOT NULL DEFAULT 'PENDING' CHECK(state IN('PENDING','CLAIMED','SENDING','ACCEPTED_BY_PROVIDER','DELIVERED','UNKNOWN_PROVIDER_OUTCOME','FAILED_RETRYABLE','FAILED_FINAL','DEAD_LETTERED','SUPPRESSED','CANCELLED')),
 idempotency_key text NOT NULL UNIQUE, template_id uuid NOT NULL REFERENCES operations.notification_templates, template_version int NOT NULL, template_snapshot jsonb NOT NULL CHECK(jsonb_typeof(template_snapshot)='object'),
 rendered_subject text, rendered_text_body text NOT NULL, rendered_html_body text, rendered_subject_hash text, rendered_body_hash text NOT NULL,
 attempt_count int NOT NULL DEFAULT 0 CHECK(attempt_count>=0), max_attempts int NOT NULL DEFAULT 5 CHECK(max_attempts BETWEEN 1 AND 20), next_attempt_at timestamptz,
 lease_owner text, lease_expires_at timestamptz, provider_accepted_at timestamptz, delivered_at timestamptz, suppressed_at timestamptz, suppression_reason text,
 last_error_class text,last_error_code text,last_error_message text,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(template_id,template_version) REFERENCES operations.notification_template_versions(template_id,version),
 CHECK((channel='EMAIL' AND provider='MICROSOFT_GRAPH') OR (channel='SMS' AND provider='TELNYX')), CHECK(attempt_count<=max_attempts));
CREATE INDEX idx_deliveries_ready ON operations.notification_deliveries(channel,state,next_attempt_at,created_at);
CREATE INDEX idx_deliveries_lease ON operations.notification_deliveries(lease_expires_at) WHERE state IN('CLAIMED','SENDING');
CREATE TRIGGER trg_deliveries_updated BEFORE UPDATE ON operations.notification_deliveries FOR EACH ROW EXECUTE FUNCTION operations.set_updated_at();
CREATE OR REPLACE FUNCTION operations.guard_delivery_transition() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE ok boolean:=false; BEGIN IF NEW.state=OLD.state THEN RETURN NEW; END IF;
ok := (OLD.state='PENDING' AND NEW.state IN('CLAIMED','SUPPRESSED','CANCELLED')) OR (OLD.state='CLAIMED' AND NEW.state IN('PENDING','SENDING','CANCELLED'))
 OR (OLD.state='SENDING' AND NEW.state IN('ACCEPTED_BY_PROVIDER','UNKNOWN_PROVIDER_OUTCOME','FAILED_RETRYABLE','FAILED_FINAL'))
 OR (OLD.state='FAILED_RETRYABLE' AND NEW.state IN('CLAIMED','DEAD_LETTERED','CANCELLED'))
 OR (OLD.state='UNKNOWN_PROVIDER_OUTCOME' AND NEW.state IN('ACCEPTED_BY_PROVIDER','FAILED_FINAL','CANCELLED'))
 OR (OLD.state='ACCEPTED_BY_PROVIDER' AND NEW.state IN('DELIVERED','FAILED_FINAL')) OR (OLD.state='FAILED_FINAL' AND NEW.state='DEAD_LETTERED');
IF NOT ok THEN RAISE EXCEPTION 'Invalid notification delivery state transition: % -> %',OLD.state,NEW.state; END IF;
IF NEW.state='DELIVERED' AND NEW.delivered_at IS NULL THEN RAISE EXCEPTION 'DELIVERED requires delivered_at'; END IF;
IF NEW.state='ACCEPTED_BY_PROVIDER' AND NEW.provider_accepted_at IS NULL THEN RAISE EXCEPTION 'ACCEPTED_BY_PROVIDER requires provider_accepted_at'; END IF;
IF NEW.state='SUPPRESSED' AND NEW.suppressed_at IS NULL THEN RAISE EXCEPTION 'SUPPRESSED requires suppressed_at'; END IF; RETURN NEW; END $$;
CREATE TRIGGER trg_delivery_state BEFORE UPDATE OF state ON operations.notification_deliveries FOR EACH ROW EXECUTE FUNCTION operations.guard_delivery_transition();

CREATE TABLE operations.delivery_attempts(
 attempt_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), delivery_id uuid NOT NULL REFERENCES operations.notification_deliveries, attempt_number int NOT NULL CHECK(attempt_number>0),
 worker_id text NOT NULL, started_at timestamptz NOT NULL DEFAULT clock_timestamp(), completed_at timestamptz, outcome text NOT NULL DEFAULT 'STARTED' CHECK(outcome IN('STARTED','ACCEPTED','DELIVERED','RETRYABLE_FAILURE','FINAL_FAILURE','UNKNOWN','SUPPRESSED')),
 http_status int, provider_code text, provider_request_id text, provider_message_id text, retry_after_ms int CHECK(retry_after_ms IS NULL OR retry_after_ms>=0), error_class text,error_message text,
 ambiguous_outcome boolean NOT NULL DEFAULT false, UNIQUE(delivery_id,attempt_number));
CREATE TABLE operations.notification_outbox(
 outbox_id bigserial PRIMARY KEY, delivery_id uuid NOT NULL UNIQUE REFERENCES operations.notification_deliveries, available_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 locked_at timestamptz, lock_owner text, lock_expires_at timestamptz, completed_at timestamptz, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK(lock_expires_at IS NULL OR locked_at IS NULL OR lock_expires_at>=locked_at));
CREATE INDEX idx_outbox_claim ON operations.notification_outbox(available_at,completed_at,lock_expires_at,outbox_id);
CREATE TABLE operations.provider_receipts(
 receipt_id bigserial PRIMARY KEY, provider text NOT NULL CHECK(provider IN('MICROSOFT_GRAPH','TELNYX')), provider_event_id text, provider_message_id text,
 delivery_id uuid REFERENCES operations.notification_deliveries, attempt_id uuid REFERENCES operations.delivery_attempts, receipt_type text NOT NULL, payload jsonb NOT NULL,
 payload_redacted boolean NOT NULL DEFAULT true, received_at timestamptz NOT NULL DEFAULT clock_timestamp(), correlation_id uuid, UNIQUE(provider,provider_event_id));
CREATE TABLE operations.dead_letters(
 dead_letter_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), delivery_id uuid NOT NULL UNIQUE REFERENCES operations.notification_deliveries, reason_code text NOT NULL,last_error text NOT NULL,
 replay_count int NOT NULL DEFAULT 0 CHECK(replay_count>=0), replayed_delivery_id uuid REFERENCES operations.notification_deliveries, created_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TRIGGER trg_dead_letters_updated BEFORE UPDATE ON operations.dead_letters FOR EACH ROW EXECUTE FUNCTION operations.set_updated_at();

CREATE TABLE operations.sms_subscriptions(
 subscription_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), recipient_id uuid REFERENCES operations.recipient_directory, mobile_e164 text NOT NULL UNIQUE CHECK(mobile_e164 ~ '^\+[1-9][0-9]{7,14}$'),
 phone_hash text NOT NULL, status text NOT NULL DEFAULT 'NEVER_SUBSCRIBED' CHECK(status IN('NEVER_SUBSCRIBED','SUBSCRIBED','UNSUBSCRIBED','SUSPENDED')),
 consent_source text, consented_at timestamptz, opted_out_at timestamptz,last_keyword text,last_event_at timestamptz,
 telnyx_number_e164 text NOT NULL DEFAULT '+15715160419' CHECK(telnyx_number_e164 ~ '^\+[1-9][0-9]{7,14}$'), campaign_external_id text,messaging_profile_id text,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz NOT NULL DEFAULT clock_timestamp(), CHECK(status<>'SUBSCRIBED' OR consented_at IS NOT NULL));
CREATE TRIGGER trg_sms_subscriptions_updated BEFORE UPDATE ON operations.sms_subscriptions FOR EACH ROW EXECUTE FUNCTION operations.set_updated_at();
CREATE TABLE operations.sms_consent_events(
 consent_event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),provider_event_id text NOT NULL UNIQUE,mobile_e164 text NOT NULL CHECK(mobile_e164 ~ '^\+[1-9][0-9]{7,14}$'),
 telnyx_number_e164 text NOT NULL DEFAULT '+15715160419',keyword text NOT NULL CHECK(keyword=upper(keyword)),action text NOT NULL CHECK(action IN('OPT_IN','OPT_OUT','HELP','INBOUND_OTHER')),
 consent_source text NOT NULL DEFAULT 'TELNYX_INBOUND_KEYWORD',provider text NOT NULL DEFAULT 'TELNYX' CHECK(provider='TELNYX'),occurred_at timestamptz NOT NULL,received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 payload_hash text,correlation_id uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE OR REPLACE FUNCTION operations.deny_consent_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'operations.sms_consent_events is append-only'; END $$;
CREATE TRIGGER trg_sms_consent_immutable BEFORE UPDATE OR DELETE ON operations.sms_consent_events FOR EACH ROW EXECUTE FUNCTION operations.deny_consent_mutation();

CREATE OR REPLACE FUNCTION operations.record_sms_consent_event(p_provider_event_id text,p_mobile_e164 text,p_keyword text,p_action text,p_occurred_at timestamptz,p_payload_hash text,p_correlation_id uuid,p_campaign_external_id text DEFAULT NULL,p_messaging_profile_id text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=operations,pg_temp AS $$
DECLARE v_event uuid; v_existing uuid; v_status text; BEGIN
IF p_mobile_e164 !~ '^\+[1-9][0-9]{7,14}$' THEN RAISE EXCEPTION 'Invalid E.164 mobile number'; END IF;
IF p_action NOT IN('OPT_IN','OPT_OUT','HELP','INBOUND_OTHER') THEN RAISE EXCEPTION 'Invalid consent action'; END IF;
SELECT consent_event_id INTO v_existing FROM operations.sms_consent_events WHERE provider_event_id=p_provider_event_id;
IF v_existing IS NOT NULL THEN RETURN v_existing; END IF;
INSERT INTO operations.sms_consent_events(provider_event_id,mobile_e164,keyword,action,occurred_at,payload_hash,correlation_id)
VALUES(p_provider_event_id,p_mobile_e164,upper(p_keyword),p_action,p_occurred_at,p_payload_hash,p_correlation_id) RETURNING consent_event_id INTO v_event;
v_status:=CASE p_action WHEN 'OPT_IN' THEN 'SUBSCRIBED' WHEN 'OPT_OUT' THEN 'UNSUBSCRIBED' ELSE NULL END;
INSERT INTO operations.sms_subscriptions(mobile_e164,phone_hash,status,consent_source,consented_at,opted_out_at,last_keyword,last_event_at,campaign_external_id,messaging_profile_id)
VALUES(p_mobile_e164,encode(extensions.digest(p_mobile_e164,'sha256'),'hex'),coalesce(v_status,'NEVER_SUBSCRIBED'),CASE WHEN v_status IS NULL THEN NULL ELSE 'TELNYX_INBOUND_KEYWORD' END,
 CASE WHEN v_status='SUBSCRIBED' THEN p_occurred_at END,CASE WHEN v_status='UNSUBSCRIBED' THEN p_occurred_at END,upper(p_keyword),p_occurred_at,p_campaign_external_id,p_messaging_profile_id)
ON CONFLICT(mobile_e164) DO UPDATE SET
 status=CASE WHEN EXCLUDED.last_event_at>=operations.sms_subscriptions.last_event_at AND v_status IS NOT NULL THEN v_status ELSE operations.sms_subscriptions.status END,
 consent_source=CASE WHEN EXCLUDED.last_event_at>=operations.sms_subscriptions.last_event_at AND v_status IS NOT NULL THEN 'TELNYX_INBOUND_KEYWORD' ELSE operations.sms_subscriptions.consent_source END,
 consented_at=CASE WHEN EXCLUDED.last_event_at>=operations.sms_subscriptions.last_event_at AND v_status='SUBSCRIBED' THEN p_occurred_at ELSE operations.sms_subscriptions.consented_at END,
 opted_out_at=CASE WHEN EXCLUDED.last_event_at>=operations.sms_subscriptions.last_event_at AND v_status='UNSUBSCRIBED' THEN p_occurred_at ELSE operations.sms_subscriptions.opted_out_at END,
 last_keyword=CASE WHEN EXCLUDED.last_event_at>=operations.sms_subscriptions.last_event_at THEN upper(p_keyword) ELSE operations.sms_subscriptions.last_keyword END,
 last_event_at=GREATEST(operations.sms_subscriptions.last_event_at,EXCLUDED.last_event_at),
 campaign_external_id=coalesce(EXCLUDED.campaign_external_id,operations.sms_subscriptions.campaign_external_id),
 messaging_profile_id=coalesce(EXCLUDED.messaging_profile_id,operations.sms_subscriptions.messaging_profile_id),updated_at=clock_timestamp();
RETURN v_event; END $$;

CREATE TABLE operations.channel_controls(
 channel text PRIMARY KEY CHECK(channel IN('EMAIL','SMS')), enabled boolean NOT NULL DEFAULT false, emergency_stop boolean NOT NULL DEFAULT true,
 reason text NOT NULL,changed_by text NOT NULL,change_reference text,updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),CHECK(NOT enabled OR NOT emergency_stop));
INSERT INTO operations.channel_controls VALUES('EMAIL',false,true,'Fail-closed pending live Green Tier 1 certification','MIGRATION',NULL,clock_timestamp()),('SMS',false,true,'Fail-closed pending live Green Tier 1 certification','MIGRATION',NULL,clock_timestamp());
CREATE TABLE operations.provider_health(
 health_id bigserial PRIMARY KEY,provider text NOT NULL CHECK(provider IN('MICROSOFT_GRAPH','TELNYX')),channel text NOT NULL CHECK(channel IN('EMAIL','SMS')),healthy boolean NOT NULL,
 auth_healthy boolean,send_capability_healthy boolean,latency_ms int CHECK(latency_ms IS NULL OR latency_ms>=0),status_code int,detail text,sampled_at timestamptz NOT NULL DEFAULT clock_timestamp(),correlation_id uuid,
 CHECK((provider='MICROSOFT_GRAPH' AND channel='EMAIL') OR (provider='TELNYX' AND channel='SMS')));
CREATE INDEX idx_provider_health_latest ON operations.provider_health(provider,sampled_at DESC);
CREATE TABLE operations.channel_rate_limits(
 channel text PRIMARY KEY CHECK(channel IN('EMAIL','SMS')),max_submissions_per_minute int NOT NULL CHECK(max_submissions_per_minute>0),max_recipients_per_message int NOT NULL CHECK(max_recipients_per_message>0),
 max_recipients_per_notification int NOT NULL CHECK(max_recipients_per_notification>0),enabled boolean NOT NULL DEFAULT true,updated_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TABLE operations.rate_limit_buckets(
 channel text NOT NULL CHECK(channel IN('EMAIL','SMS')),bucket_minute timestamptz NOT NULL,submission_count int NOT NULL DEFAULT 0 CHECK(submission_count>=0),recipient_count int NOT NULL DEFAULT 0 CHECK(recipient_count>=0),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(channel,bucket_minute),CHECK(date_trunc('minute',bucket_minute)=bucket_minute));

CREATE TABLE operations.suppression_rules(
 suppression_rule_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),rule_key text NOT NULL UNIQUE CHECK(rule_key=upper(rule_key)),event_type_pattern text NOT NULL,channel text CHECK(channel IS NULL OR channel IN('EMAIL','SMS')),
 window_seconds int NOT NULL CHECK(window_seconds>=0),grouping_expression text NOT NULL,enabled boolean NOT NULL DEFAULT true,description text NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TRIGGER trg_suppression_updated BEFORE UPDATE ON operations.suppression_rules FOR EACH ROW EXECUTE FUNCTION operations.set_updated_at();
CREATE TABLE operations.suppression_decisions(
 suppression_decision_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),event_id uuid NOT NULL REFERENCES operations.operational_events,notification_id uuid REFERENCES operations.notification_requests,
 suppression_rule_id uuid NOT NULL REFERENCES operations.suppression_rules,grouping_key text NOT NULL,suppressed boolean NOT NULL,reason text NOT NULL,decided_at timestamptz NOT NULL DEFAULT clock_timestamp(),correlation_id uuid NOT NULL);

CREATE TABLE operations.audit_ledger(
 audit_id bigserial PRIMARY KEY,entity_type text NOT NULL,entity_id text NOT NULL,action text NOT NULL,actor_type text NOT NULL,actor_id text,request_id uuid,correlation_id uuid,trace_id text,
 details jsonb NOT NULL DEFAULT '{}'::jsonb,previous_hash text,record_hash text NOT NULL,occurred_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE INDEX idx_audit_entity ON operations.audit_ledger(entity_type,entity_id,occurred_at,audit_id);
CREATE OR REPLACE FUNCTION operations.audit_before_insert() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE p text; material text; BEGIN
PERFORM pg_advisory_xact_lock(hashtext('operations.audit_ledger')); SELECT record_hash INTO p FROM operations.audit_ledger ORDER BY audit_id DESC LIMIT 1; NEW.previous_hash:=p;
material:=coalesce(NEW.entity_type,'')||'|'||coalesce(NEW.entity_id,'')||'|'||coalesce(NEW.action,'')||'|'||coalesce(NEW.actor_type,'')||'|'||coalesce(NEW.actor_id,'')||'|'||coalesce(NEW.request_id::text,'')||'|'||coalesce(NEW.correlation_id::text,'')||'|'||coalesce(NEW.trace_id,'')||'|'||NEW.details::text||'|'||coalesce(NEW.previous_hash,'')||'|'||NEW.occurred_at::text;
NEW.record_hash:=encode(extensions.digest(material,'sha256'),'hex'); RETURN NEW; END $$;
CREATE TRIGGER trg_audit_hash BEFORE INSERT ON operations.audit_ledger FOR EACH ROW EXECUTE FUNCTION operations.audit_before_insert();
CREATE OR REPLACE FUNCTION operations.deny_audit_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'operations.audit_ledger is append-only'; END $$;
CREATE TRIGGER trg_audit_immutable BEFORE UPDATE OR DELETE ON operations.audit_ledger FOR EACH ROW EXECUTE FUNCTION operations.deny_audit_mutation();

CREATE OR REPLACE FUNCTION operations.claim_notification_outbox(p_channel text,p_worker_id text,p_batch_size int DEFAULT 20,p_lease_seconds int DEFAULT 90)
RETURNS TABLE(outbox_id bigint,delivery_id uuid) LANGUAGE plpgsql AS $$ BEGIN
IF p_channel NOT IN('EMAIL','SMS') THEN RAISE EXCEPTION 'Invalid channel'; END IF; IF p_batch_size<1 OR p_batch_size>100 THEN RAISE EXCEPTION 'Invalid batch size'; END IF;
UPDATE operations.notification_deliveries SET state='UNKNOWN_PROVIDER_OUTCOME',lease_owner=NULL,lease_expires_at=NULL,last_error_class='LEASE_EXPIRED_DURING_SEND',last_error_message='Worker lease expired while SENDING'
WHERE channel=p_channel AND state='SENDING' AND lease_expires_at IS NOT NULL AND lease_expires_at<clock_timestamp();
UPDATE operations.notification_outbox o SET completed_at=clock_timestamp(),lock_owner=NULL,lock_expires_at=NULL FROM operations.notification_deliveries d WHERE d.delivery_id=o.delivery_id AND d.channel=p_channel AND d.state='UNKNOWN_PROVIDER_OUTCOME' AND o.completed_at IS NULL;
RETURN QUERY WITH picked AS(
 SELECT o.outbox_id,o.delivery_id FROM operations.notification_outbox o JOIN operations.notification_deliveries d USING(delivery_id)
 WHERE d.channel=p_channel AND d.state IN('PENDING','FAILED_RETRYABLE','CLAIMED') AND o.completed_at IS NULL AND o.available_at<=clock_timestamp() AND (o.lock_expires_at IS NULL OR o.lock_expires_at<clock_timestamp())
 ORDER BY o.available_at,o.outbox_id FOR UPDATE OF o SKIP LOCKED LIMIT p_batch_size),locked AS(
 UPDATE operations.notification_outbox o SET locked_at=clock_timestamp(),lock_owner=p_worker_id,lock_expires_at=clock_timestamp()+make_interval(secs=>p_lease_seconds)
 FROM picked p WHERE o.outbox_id=p.outbox_id RETURNING o.outbox_id,o.delivery_id),d2 AS(
 UPDATE operations.notification_deliveries d SET state='CLAIMED',lease_owner=p_worker_id,lease_expires_at=clock_timestamp()+make_interval(secs=>p_lease_seconds)
 FROM locked l WHERE d.delivery_id=l.delivery_id RETURNING d.delivery_id) SELECT l.outbox_id,l.delivery_id FROM locked l; END $$;

COMMENT ON TABLE operations.notification_deliveries IS 'Per-recipient/per-channel durable delivery. ACCEPTED_BY_PROVIDER is not final delivery.';
COMMENT ON TABLE operations.sms_consent_events IS 'Append-only Telnyx keyword consent evidence. Current projection is sms_subscriptions.';
COMMENT ON TABLE operations.audit_ledger IS 'Append-only hash-chained audit evidence.';
COMMIT;
