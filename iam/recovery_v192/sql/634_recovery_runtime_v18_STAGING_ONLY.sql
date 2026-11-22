-- TCDS V1.8 additive recovery runtime. STAGING ONLY. Do not alter 604/620/621/622 history.
-- Preflight must reconcile the correct staging DB and trusted backend roles before deployment.
BEGIN;
SET LOCAL search_path=pg_catalog,pg_temp;
SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='30s';
DO $preflight$ BEGIN
 IF to_regclass('warehouse_identity.password_reset_requests') IS NULL
 OR to_regclass('warehouse_identity.recovery_contact_challenges_v1') IS NULL
 OR to_regclass('warehouse_identity.recovery_proofs_v1') IS NULL
 OR to_regclass('warehouse_identity.user_recovery_contacts') IS NULL
 OR to_regclass('warehouse_identity.webauthn_verification_evidence') IS NULL
 OR to_regclass('warehouse_identity.auth_challenges') IS NULL
 OR to_regprocedure('warehouse_identity.register_password_recovery_stepup_v62(uuid,uuid,uuid,uuid,text,uuid,text)') IS NULL
 OR to_regprocedure('warehouse_identity.recovery_reset_guard_v15(uuid,uuid)') IS NULL
 THEN RAISE EXCEPTION 'R634_IAM_DEPENDENCIES_MISSING';END IF;
 IF to_regclass('warehouse_identity.recovery_action_challenges_v18') IS NOT NULL
 OR to_regclass('warehouse_identity.recovery_secret_outbox_v18') IS NOT NULL
 OR to_regclass('warehouse_identity.recovery_invitation_refs_v18') IS NOT NULL
 THEN RAISE EXCEPTION 'R634_ALREADY_INSTALLED'; END IF;
END $preflight$;
CREATE TABLE warehouse_identity.recovery_action_challenges_v18 (
 challenge_id uuid PRIMARY KEY,
 auth_challenge_id uuid NOT NULL UNIQUE REFERENCES warehouse_identity.auth_challenges(auth_challenge_id),
 actor_user_id uuid NOT NULL REFERENCES warehouse_identity.users(user_id),
 auth_session_id uuid NOT NULL REFERENCES warehouse_identity.auth_sessions(auth_session_id),
 device_id uuid NOT NULL,
 facility_id uuid NOT NULL REFERENCES warehouse.facilities(facility_id),
 target_user_id uuid NOT NULL REFERENCES warehouse_identity.users(user_id),
 reset_request_id uuid REFERENCES warehouse_identity.password_reset_requests(password_reset_request_id),
 context_request_id uuid NOT NULL REFERENCES warehouse_identity.password_reset_requests(password_reset_request_id),
 expected_row_version text NOT NULL CHECK(expected_row_version ~ '^[1-9][0-9]{0,18}$'),
 purpose text NOT NULL CHECK(purpose IN ('WAREHOUSE_PASSWORD_RESET_APPROVAL','RECOVERY_24H_OVERRIDE')),
 challenge_text text NOT NULL CHECK(length(challenge_text) BETWEEN 32 AND 256),
 expires_at timestamptz NOT NULL,
 consumed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK ((purpose='WAREHOUSE_PASSWORD_RESET_APPROVAL')=(reset_request_id IS NOT NULL)),
 CHECK(actor_user_id<>target_user_id),
 CHECK(expires_at>created_at AND expires_at<=created_at+interval '2 minutes')
);
CREATE INDEX ix_r634_action_pending ON warehouse_identity.recovery_action_challenges_v18(auth_session_id,expires_at) WHERE consumed_at IS NULL;
CREATE TABLE warehouse_identity.recovery_secret_outbox_v18 (
 delivery_id uuid PRIMARY KEY,
 challenge_id uuid NOT NULL UNIQUE REFERENCES warehouse_identity.recovery_contact_challenges_v1(challenge_id),
 channel text NOT NULL CHECK(channel IN ('EMAIL','SMS')),
 encrypted_payload bytea,
 payload_iv bytea CHECK(payload_iv IS NULL OR octet_length(payload_iv)=12),
 payload_tag bytea CHECK(payload_tag IS NULL OR octet_length(payload_tag)=16),
 correlation_id uuid NOT NULL,
 status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','SENDING','ACCEPTED','FAILED','UNKNOWN')),
 attempt_count integer NOT NULL DEFAULT 0 CHECK(attempt_count BETWEEN 0 AND 3),
 expires_at timestamptz NOT NULL,
 processed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK ((status IN ('PENDING','SENDING'))=(encrypted_payload IS NOT NULL)),
 CHECK ((encrypted_payload IS NULL)=(payload_iv IS NULL) AND (encrypted_payload IS NULL)=(payload_tag IS NULL)),
 CHECK(expires_at>created_at AND expires_at<=created_at+interval '10 minutes')
);
CREATE INDEX ix_r634_outbox_pending ON warehouse_identity.recovery_secret_outbox_v18(created_at,delivery_id) WHERE status='PENDING';
CREATE TABLE warehouse_identity.recovery_invitation_refs_v18 (
 reset_request_id uuid NOT NULL REFERENCES warehouse_identity.password_reset_requests(password_reset_request_id),
 ref_hash bytea PRIMARY KEY CHECK(octet_length(ref_hash)=32),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 expires_at timestamptz NOT NULL,
 revoked_at timestamptz,
 CHECK(expires_at>created_at AND expires_at<=created_at+interval '15 minutes')
);
CREATE INDEX ix_r634_invitation_by_reset ON warehouse_identity.recovery_invitation_refs_v18(reset_request_id) WHERE revoked_at IS NULL;
-- Separate service roles; deployment grants only to the known service credentials after role mapping review.
DO $roles$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='tcds_recovery_verifier_v18') THEN CREATE ROLE tcds_recovery_verifier_v18 NOLOGIN;END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='tcds_recovery_otp_v18') THEN CREATE ROLE tcds_recovery_otp_v18 NOLOGIN;END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='tcds_recovery_delivery_v18') THEN CREATE ROLE tcds_recovery_delivery_v18 NOLOGIN;END IF;
END $roles$;
REVOKE ALL ON warehouse_identity.recovery_action_challenges_v18,warehouse_identity.recovery_secret_outbox_v18,
 warehouse_identity.recovery_invitation_refs_v18 FROM PUBLIC,anon,authenticated,service_role;
ALTER TABLE warehouse_identity.recovery_action_challenges_v18 ENABLE ROW LEVEL SECURITY;
ALTER TABLE warehouse_identity.recovery_action_challenges_v18 FORCE ROW LEVEL SECURITY;
ALTER TABLE warehouse_identity.recovery_secret_outbox_v18 ENABLE ROW LEVEL SECURITY;
ALTER TABLE warehouse_identity.recovery_secret_outbox_v18 FORCE ROW LEVEL SECURITY;
ALTER TABLE warehouse_identity.recovery_invitation_refs_v18 ENABLE ROW LEVEL SECURITY;
ALTER TABLE warehouse_identity.recovery_invitation_refs_v18 FORCE ROW LEVEL SECURITY;
GRANT USAGE ON SCHEMA warehouse_identity TO tcds_recovery_verifier_v18,tcds_recovery_otp_v18,tcds_recovery_delivery_v18;
GRANT SELECT,INSERT,UPDATE ON warehouse_identity.recovery_action_challenges_v18 TO tcds_recovery_verifier_v18;
GRANT SELECT,INSERT,UPDATE ON warehouse_identity.recovery_secret_outbox_v18 TO tcds_recovery_otp_v18,tcds_recovery_delivery_v18;
GRANT SELECT,INSERT,UPDATE ON warehouse_identity.recovery_invitation_refs_v18 TO tcds_recovery_otp_v18;
CREATE POLICY r634_verifier_only ON warehouse_identity.recovery_action_challenges_v18 FOR ALL TO tcds_recovery_verifier_v18 USING(true) WITH CHECK(true);
CREATE POLICY r634_outbox_otp ON warehouse_identity.recovery_secret_outbox_v18 FOR ALL TO tcds_recovery_otp_v18 USING(true) WITH CHECK(true);
CREATE POLICY r634_outbox_delivery ON warehouse_identity.recovery_secret_outbox_v18 FOR ALL TO tcds_recovery_delivery_v18 USING(true) WITH CHECK(true);
CREATE POLICY r634_invitation_otp ON warehouse_identity.recovery_invitation_refs_v18 FOR ALL TO tcds_recovery_otp_v18 USING(true) WITH CHECK(true);
-- IMPORTANT: Existing IAM tables have independent RLS and SECURITY DEFINER contracts.
-- The trusted verifier and OTP services MUST obtain precisely scoped existing-table privileges through
-- approved service-owner mappings; do NOT blindly grant general table writes here.
-- 634 installation alone must NOT turn on HTTP routes.
COMMIT;
