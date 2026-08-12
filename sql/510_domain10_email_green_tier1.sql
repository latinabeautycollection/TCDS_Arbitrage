BEGIN;
CREATE SCHEMA IF NOT EXISTS operations;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION operations.classification_rank(v text) RETURNS integer
LANGUAGE sql IMMUTABLE STRICT AS $$
 SELECT CASE upper(v)
  WHEN 'PUBLIC' THEN 1 WHEN 'INTERNAL' THEN 2 WHEN 'CONFIDENTIAL' THEN 3 WHEN 'RESTRICTED' THEN 4 ELSE 0 END
$$;

CREATE TABLE IF NOT EXISTS operations.email_system_controls(
 channel text PRIMARY KEY CHECK(channel='EMAIL'),
 enabled boolean NOT NULL DEFAULT false,
 reason text,
 updated_by text NOT NULL DEFAULT 'migration',
 updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO operations.email_system_controls(channel,enabled,reason)
VALUES('EMAIL',false,'Fail-closed until Green Tier 1 live certification')
ON CONFLICT(channel) DO NOTHING;

CREATE TABLE IF NOT EXISTS operations.notification_templates(
 template_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 template_key text NOT NULL UNIQUE,
 description text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS operations.notification_template_versions(
 template_id uuid NOT NULL REFERENCES operations.notification_templates(template_id),
 version integer NOT NULL CHECK(version>0),
 subject_template text NOT NULL,
 text_template text NOT NULL,
 html_template text NOT NULL,
 active boolean NOT NULL DEFAULT false,
 content_hash text NOT NULL,
 created_by text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(template_id,version)
);

CREATE TABLE IF NOT EXISTS operations.email_recipient_directory(
 recipient_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 email_address text NOT NULL,
 display_name text,
 enabled boolean NOT NULL DEFAULT true,
 source text NOT NULL DEFAULT 'TCDS',
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_email_recipient_directory_lower
ON operations.email_recipient_directory(lower(email_address));

CREATE TABLE IF NOT EXISTS operations.email_audiences(
 audience_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 audience_key text NOT NULL UNIQUE,
 description text NOT NULL,
 enabled boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS operations.email_audience_members(
 audience_id uuid NOT NULL REFERENCES operations.email_audiences(audience_id) ON DELETE CASCADE,
 recipient_id uuid NOT NULL REFERENCES operations.email_recipient_directory(recipient_id) ON DELETE CASCADE,
 PRIMARY KEY(audience_id,recipient_id)
);

CREATE TABLE IF NOT EXISTS operations.email_recipient_authorizations(
 authorization_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 email_address text NOT NULL,
 event_type_pattern text NOT NULL DEFAULT '*',
 max_classification text NOT NULL CHECK(max_classification IN('PUBLIC','INTERNAL','CONFIDENTIAL','RESTRICTED')),
 enabled boolean NOT NULL DEFAULT true,
 valid_from timestamptz NOT NULL DEFAULT now(),
 valid_until timestamptz,
 approved_by text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(valid_until IS NULL OR valid_until > valid_from)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_email_recipient_auth_lower_pattern
ON operations.email_recipient_authorizations(lower(email_address),event_type_pattern);

CREATE TABLE IF NOT EXISTS operations.notification_requests(
 request_id uuid PRIMARY KEY,
 event_id text NOT NULL,
 notification_id text NOT NULL UNIQUE,
 correlation_id text NOT NULL,
 incident_id text,
 event_type text NOT NULL,
 severity text NOT NULL CHECK(severity IN('INFORMATIONAL','NOTICE','WARNING','HIGH','CRITICAL','EMERGENCY')),
 classification text NOT NULL CHECK(classification IN('PUBLIC','INTERNAL','CONFIDENTIAL','RESTRICTED')),
 recipients jsonb NOT NULL CHECK(jsonb_typeof(recipients)='array'),
 template_key text NOT NULL,
 template_version integer NOT NULL,
 policy_version text NOT NULL,
 variables jsonb NOT NULL DEFAULT '{}'::jsonb,
 status text NOT NULL DEFAULT 'PENDING',
 created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS operations.notification_deliveries(
 delivery_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 request_id uuid NOT NULL REFERENCES operations.notification_requests(request_id),
 idempotency_key text NOT NULL UNIQUE,
 state text NOT NULL CHECK(state IN(
   'PENDING','CLAIMED','SENDING','ACCEPTED_BY_PROVIDER','UNKNOWN_PROVIDER_OUTCOME',
   'FAILED_RETRYABLE','FAILED_FINAL','DEAD_LETTERED','SUPPRESSED','CANCELLED'
 )),
 recipients jsonb NOT NULL CHECK(jsonb_typeof(recipients)='array'),
 rendered_subject text NOT NULL,
 rendered_text_body text NOT NULL,
 rendered_html_body text NOT NULL,
 rendered_subject_hash text NOT NULL,
 rendered_body_hash text NOT NULL,
 attempt_count integer NOT NULL DEFAULT 0 CHECK(attempt_count>=0),
 next_attempt_at timestamptz,
 lease_owner text,
 lease_expires_at timestamptz,
 provider_accepted_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_email_delivery_ready
ON operations.notification_deliveries(state,next_attempt_at);
CREATE INDEX IF NOT EXISTS idx_email_request_correlation
ON operations.notification_requests(correlation_id);

CREATE TABLE IF NOT EXISTS operations.email_outbox(
 outbox_id bigserial PRIMARY KEY,
 delivery_id uuid NOT NULL UNIQUE REFERENCES operations.notification_deliveries(delivery_id),
 available_at timestamptz NOT NULL DEFAULT now(),
 locked_at timestamptz,
 lock_owner text,
 lock_expires_at timestamptz,
 completed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_email_outbox_claim
ON operations.email_outbox(available_at,completed_at,lock_expires_at);

CREATE TABLE IF NOT EXISTS operations.delivery_attempts(
 attempt_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 delivery_id uuid NOT NULL REFERENCES operations.notification_deliveries(delivery_id),
 attempt_number integer NOT NULL CHECK(attempt_number>0),
 outcome text NOT NULL,
 http_status integer,
 provider_code text,
 provider_request_id text,
 error_class text,
 error_message text,
 ambiguous_outcome boolean NOT NULL DEFAULT false,
 started_at timestamptz NOT NULL DEFAULT now(),
 completed_at timestamptz,
 UNIQUE(delivery_id,attempt_number)
);

CREATE TABLE IF NOT EXISTS operations.provider_receipts(
 receipt_id bigserial PRIMARY KEY,
 delivery_id uuid NOT NULL REFERENCES operations.notification_deliveries(delivery_id),
 attempt_id uuid REFERENCES operations.delivery_attempts(attempt_id),
 receipt_type text NOT NULL,
 payload jsonb NOT NULL,
 received_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS operations.dead_letters(
 dead_letter_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 delivery_id uuid NOT NULL UNIQUE REFERENCES operations.notification_deliveries(delivery_id),
 reason text NOT NULL,
 last_error text NOT NULL,
 replay_count integer NOT NULL DEFAULT 0 CHECK(replay_count>=0),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS operations.email_submission_rate(
 bucket_minute timestamptz PRIMARY KEY,
 submission_count integer NOT NULL CHECK(submission_count>=0),
 CHECK(date_trunc('minute',bucket_minute)=bucket_minute)
);

CREATE TABLE IF NOT EXISTS operations.email_provider_health(
 sample_id bigserial PRIMARY KEY,
 healthy boolean NOT NULL,
 auth_mode text NOT NULL,
 latency_ms integer,
 detail text,
 sampled_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS operations.audit_ledger(
 audit_id bigserial PRIMARY KEY,
 entity_type text NOT NULL,
 entity_id text NOT NULL,
 action text NOT NULL,
 actor text NOT NULL,
 details jsonb NOT NULL DEFAULT '{}'::jsonb,
 previous_hash text,
 record_hash text NOT NULL,
 occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION operations.deny_audit_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN
 RAISE EXCEPTION 'operations.audit_ledger is append-only';
END $$;

DROP TRIGGER IF EXISTS trg_operations_audit_immutable ON operations.audit_ledger;
CREATE TRIGGER trg_operations_audit_immutable
BEFORE UPDATE OR DELETE ON operations.audit_ledger
FOR EACH ROW EXECUTE FUNCTION operations.deny_audit_mutation();

COMMIT;
