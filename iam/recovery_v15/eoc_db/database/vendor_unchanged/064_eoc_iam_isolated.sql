-- Domain 6.4: EOC private application database. Does NOT reference Warehouse tables.
-- Run on the retail/EOC PostgreSQL database, NOT the Warehouse IAM database.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $$BEGIN IF EXISTS(SELECT 1 FROM pg_namespace WHERE nspname='eoc_iam') THEN RAISE EXCEPTION 'EOC_IAM_EXISTS_RECONCILE'; END IF; END$$;
DO $$BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='eoc_app_runtime') THEN CREATE ROLE eoc_app_runtime NOLOGIN; END IF; END$$;
CREATE SCHEMA eoc_iam;
REVOKE ALL ON SCHEMA eoc_iam FROM PUBLIC;
CREATE TABLE eoc_iam.login_flows(flow_hash text PRIMARY KEY CHECK(flow_hash~'^[a-f0-9]{64}$'),pkce_verifier text NOT NULL,oidc_state text NOT NULL UNIQUE,oidc_nonce text NOT NULL UNIQUE,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),expires_at timestamptz NOT NULL CHECK(expires_at>created_at));
CREATE TABLE eoc_iam.sessions(session_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), token_hash text NOT NULL UNIQUE CHECK(token_hash~'^[a-f0-9]{64}$'),csrf_hash text NOT NULL CHECK(csrf_hash~'^[a-f0-9]{64}$'),subject_id uuid NOT NULL,appointment_id uuid NOT NULL,position_code text NOT NULL,position text NOT NULL,person_row_version bigint NOT NULL,appointment_row_version bigint NOT NULL,iam_epoch bigint NOT NULL CHECK(iam_epoch>=0),authentication_methods text[] NOT NULL,authenticated_at timestamptz NOT NULL,issued_at timestamptz NOT NULL DEFAULT clock_timestamp(),idle_expires_at timestamptz NOT NULL,absolute_expires_at timestamptz NOT NULL,revoked_at timestamptz,revocation_reason text, CHECK(absolute_expires_at>issued_at));
CREATE INDEX ix_eoc_iam_sessions_subject ON eoc_iam.sessions(subject_id);
CREATE TABLE eoc_iam.module_grants(grant_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),subject_id uuid NOT NULL,module_id text NOT NULL CHECK(module_id=ANY(ARRAY['executive','capital','acquisition','market','retail','pqp','purchasing','warehouse','shipping','returns','identity','hardware','governance','forensic','ai','administration','decisions','agents','knowledge','scenarios'])),operation text NOT NULL CHECK(operation=ANY(ARRAY['VIEW','INVESTIGATE','MANAGE','APPROVE','ADMINISTER','EXPORT','EXECUTE','CONFIGURE'])),scope_kind text NOT NULL CHECK(scope_kind=ANY(ARRAY['ENTERPRISE','BUSINESS_UNIT','DEPARTMENT','FACILITY','TEAM','RESOURCE'])),scope_ids text[] NOT NULL DEFAULT '{}',approved_by uuid NOT NULL,secondary_approved_by uuid NOT NULL,approved_at timestamptz NOT NULL,approval_reference text NOT NULL,valid_from timestamptz NOT NULL,valid_until timestamptz NOT NULL,revoked_at timestamptz,CHECK(approved_by<>secondary_approved_by AND approved_by<>subject_id AND secondary_approved_by<>subject_id),CHECK(valid_until>valid_from),CHECK((scope_kind='ENTERPRISE' AND cardinality(scope_ids)=0) OR (scope_kind<>'ENTERPRISE' AND cardinality(scope_ids)>0)));
CREATE INDEX ix_eoc_iam_grants_subject ON eoc_iam.module_grants(subject_id);
CREATE TABLE eoc_iam.audit_events(audit_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,event_type text NOT NULL,subject_id uuid,session_id uuid,request_id uuid NOT NULL,reason_code text,occurred_at timestamptz NOT NULL DEFAULT clock_timestamp());
DO $$DECLARE t text;BEGIN FOREACH t IN ARRAY ARRAY['login_flows','sessions','module_grants','audit_events'] LOOP EXECUTE format('ALTER TABLE eoc_iam.%I ENABLE ROW LEVEL SECURITY',t); EXECUTE format('ALTER TABLE eoc_iam.%I FORCE ROW LEVEL SECURITY',t); END LOOP;END$$;
-- No public policies, no anon/authenticated/service_role grants; controlled DB-owner/worker provisioning follows independent approval.
REVOKE ALL ON ALL TABLES IN SCHEMA eoc_iam FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA eoc_iam FROM PUBLIC;
GRANT USAGE ON SCHEMA eoc_iam TO eoc_app_runtime;
GRANT SELECT,INSERT,DELETE ON eoc_iam.login_flows TO eoc_app_runtime;
GRANT SELECT,INSERT,UPDATE ON eoc_iam.sessions TO eoc_app_runtime;
GRANT SELECT ON eoc_iam.module_grants TO eoc_app_runtime;
GRANT INSERT ON eoc_iam.audit_events TO eoc_app_runtime;
GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA eoc_iam TO eoc_app_runtime;
CREATE POLICY eoc_app_flows ON eoc_iam.login_flows FOR ALL TO eoc_app_runtime USING(true) WITH CHECK(true);
CREATE POLICY eoc_app_sessions ON eoc_iam.sessions FOR ALL TO eoc_app_runtime USING(true) WITH CHECK(true);
CREATE POLICY eoc_app_grants_read ON eoc_iam.module_grants FOR SELECT TO eoc_app_runtime USING(true);
CREATE POLICY eoc_app_audit_write ON eoc_iam.audit_events FOR INSERT TO eoc_app_runtime WITH CHECK(true);
-- Bind the real backend login role to eoc_app_runtime in a separately approved privileged step.
-- Never grant a browser, anon, authenticated or service_role access.
COMMIT;
