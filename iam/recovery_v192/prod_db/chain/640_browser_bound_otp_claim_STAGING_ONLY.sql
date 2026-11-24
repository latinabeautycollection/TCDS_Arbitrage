-- V1.9.1 additive browser-bound OTP proof bridge. READ preflight before use. STAGING ONLY.
-- Does not modify v5 claim/consume, 620/621/622, or credential authority.
BEGIN;
SET LOCAL search_path=pg_catalog,pg_temp;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';
DO $pre$ BEGIN
 IF to_regclass('warehouse_identity.recovery_proofs_v1') IS NULL
 OR to_regclass('warehouse_identity.recovery_contact_challenges_v1') IS NULL
 OR to_regclass('warehouse_identity.password_reset_requests') IS NULL
 OR to_regclass('warehouse_identity.recovery_claim_bindings_v191') IS NOT NULL
 THEN RAISE EXCEPTION 'R640_DEPENDENCIES_MISSING_OR_ALREADY_INSTALLED'; END IF;
END $pre$;
CREATE TABLE warehouse_identity.recovery_claim_bindings_v191 (
 reset_request_id uuid PRIMARY KEY REFERENCES warehouse_identity.password_reset_requests(password_reset_request_id),
 proof_id uuid NOT NULL UNIQUE REFERENCES warehouse_identity.recovery_proofs_v1(proof_id),
 challenge_id uuid NOT NULL UNIQUE REFERENCES warehouse_identity.recovery_contact_challenges_v1(challenge_id),
 binding_hash bytea NOT NULL CHECK(octet_length(binding_hash)=32),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 expires_at timestamptz NOT NULL,
 CHECK(expires_at>created_at AND expires_at<=created_at+interval '5 minutes')
);
CREATE INDEX ix_r640_claim_binding_expiry ON warehouse_identity.recovery_claim_bindings_v191(expires_at);
ALTER TABLE warehouse_identity.recovery_claim_bindings_v191 ENABLE ROW LEVEL SECURITY;
ALTER TABLE warehouse_identity.recovery_claim_bindings_v191 FORCE ROW LEVEL SECURITY;
REVOKE ALL ON warehouse_identity.recovery_claim_bindings_v191 FROM PUBLIC,anon,authenticated,service_role;
-- tcds_recovery_otp_v18 is trusted staging-only backend role, NOT a public credential.
GRANT SELECT,INSERT ON warehouse_identity.recovery_claim_bindings_v191 TO tcds_recovery_otp_v18;
CREATE POLICY r640_otp_binding_select ON warehouse_identity.recovery_claim_bindings_v191
 FOR SELECT TO tcds_recovery_otp_v18 USING(true);
CREATE POLICY r640_otp_binding_insert ON warehouse_identity.recovery_claim_bindings_v191
 FOR INSERT TO tcds_recovery_otp_v18 WITH CHECK(true);
-- Existing proof read is required for retry. Forced RLS may block it; G2 requires SET ROLE tests.
GRANT SELECT ON warehouse_identity.recovery_proofs_v1 TO tcds_recovery_otp_v18;
COMMIT;
