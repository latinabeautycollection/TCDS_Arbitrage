-- TCDS IAM Recovery V1.0 — additive, single-authority migration.
-- Run ONLY in approved IAM clone/staging. Do not apply to production without release approval.
-- The existing warehouse_identity schema, user and reset-request tables are not modified.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
SET LOCAL search_path=pg_catalog,pg_temp;
DO $preflight$
BEGIN
 IF to_regclass('warehouse_identity.users') IS NULL OR to_regclass('warehouse_identity.password_reset_requests') IS NULL THEN
  RAISE EXCEPTION 'RECOVERY_V1_EXISTING_IAM_SCHEMA_REQUIRED';
 END IF;
 IF to_regclass('warehouse_identity.user_recovery_contacts') IS NOT NULL OR
    to_regclass('warehouse_identity.recovery_contact_challenges_v1') IS NOT NULL OR
    to_regclass('warehouse_identity.recovery_proofs_v1') IS NOT NULL OR
    to_regclass('warehouse_identity.supervised_recovery_proof_consumptions_v1') IS NOT NULL THEN
  RAISE EXCEPTION 'RECOVERY_V1_ALREADY_INSTALLED_RECONCILE_MIGRATION_HISTORY';
 END IF;
END $preflight$;

CREATE TABLE warehouse_identity.user_recovery_contacts (
 contact_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES warehouse_identity.users(user_id) ON DELETE RESTRICT,
 contact_type text NOT NULL CHECK(contact_type IN ('EMAIL','SMS')),
 -- AES-256-GCM ciphertext; no plaintext or business-contact auto-import.
 ciphertext bytea NOT NULL, iv bytea NOT NULL CHECK(octet_length(iv)=12), tag bytea NOT NULL CHECK(octet_length(tag)=16),
 -- Secret-keyed HMAC-SHA256 for exact duplicate detection, not a public hash.
 value_fingerprint bytea NOT NULL CHECK(octet_length(value_fingerprint)=32),
 purpose text NOT NULL DEFAULT 'RECOVERY' CHECK(purpose='RECOVERY'),
 status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','VERIFIED','REVOKED')),
 verification_method text CHECK(verification_method IN ('EMAIL_CODE','SMS_CODE','SUPERVISED')),
 verified_at timestamptz,
 revoked_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 row_version bigint NOT NULL DEFAULT 1 CHECK(row_version>0),
 CONSTRAINT recovery_contact_verification_consistency CHECK (
  (status='VERIFIED' AND verified_at IS NOT NULL AND verification_method IS NOT NULL AND revoked_at IS NULL)
  OR (status='PENDING' AND verified_at IS NULL AND revoked_at IS NULL)
  OR (status='REVOKED' AND revoked_at IS NOT NULL)),
 UNIQUE(user_id,contact_type,value_fingerprint),
 UNIQUE(contact_id,user_id)
);
CREATE UNIQUE INDEX ux_recovery_verified_destination ON warehouse_identity.user_recovery_contacts(contact_type,value_fingerprint) WHERE status='VERIFIED';
CREATE INDEX ix_recovery_contacts_user_verified ON warehouse_identity.user_recovery_contacts(user_id,contact_type)
 WHERE status='VERIFIED';

CREATE TABLE warehouse_identity.recovery_contact_challenges_v1 (
 challenge_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES warehouse_identity.users(user_id),
 contact_id uuid NOT NULL,
 purpose text NOT NULL CHECK(purpose IN ('CONTACT_VERIFY','PASSWORD_RESET')),
 reset_request_id uuid REFERENCES warehouse_identity.password_reset_requests(password_reset_request_id),
 otp_hash bytea NOT NULL CHECK(octet_length(otp_hash)=32),
 otp_salt bytea NOT NULL CHECK(octet_length(otp_salt)=16),
 expires_at timestamptz NOT NULL,
 attempt_count integer NOT NULL DEFAULT 0 CHECK(attempt_count BETWEEN 0 AND 5),
 consumed_at timestamptz,
 delivery_state text NOT NULL DEFAULT 'PENDING' CHECK(delivery_state IN ('PENDING','ACCEPTED','FAILED','UNKNOWN')),
 delivery_reference text,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(contact_id,user_id) REFERENCES warehouse_identity.user_recovery_contacts(contact_id,user_id),
 CHECK((purpose='PASSWORD_RESET')=(reset_request_id IS NOT NULL)),
 CHECK(expires_at>created_at AND expires_at<=created_at+interval '10 minutes')
);
CREATE UNIQUE INDEX ux_recovery_one_pending_challenge ON warehouse_identity.recovery_contact_challenges_v1(contact_id,purpose)
 WHERE consumed_at IS NULL AND delivery_state IN ('PENDING','ACCEPTED');
CREATE INDEX ix_recovery_challenge_expiry ON warehouse_identity.recovery_contact_challenges_v1(expires_at);

CREATE TABLE warehouse_identity.recovery_proofs_v1 (
 proof_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES warehouse_identity.users(user_id),
 reset_request_id uuid NOT NULL REFERENCES warehouse_identity.password_reset_requests(password_reset_request_id),
 challenge_id uuid NOT NULL UNIQUE REFERENCES warehouse_identity.recovery_contact_challenges_v1(challenge_id),
 assurance_method text NOT NULL CHECK(assurance_method IN ('VERIFIED_EMAIL_CODE','VERIFIED_SMS_CODE')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 expires_at timestamptz NOT NULL,
 consumed_at timestamptz,
 CHECK(expires_at>created_at AND expires_at<=created_at+interval '5 minutes')
);
CREATE UNIQUE INDEX ux_recovery_proof_active_request ON warehouse_identity.recovery_proofs_v1(reset_request_id)
 WHERE consumed_at IS NULL;

CREATE TABLE warehouse_identity.supervised_recovery_proof_consumptions_v1 (
 nonce_hash text PRIMARY KEY CHECK(nonce_hash ~ '^[a-f0-9]{64}$'),
 actor_user_id uuid NOT NULL REFERENCES warehouse_identity.users(user_id),
 target_user_id uuid NOT NULL REFERENCES warehouse_identity.users(user_id),
 reset_request_id uuid NOT NULL REFERENCES warehouse_identity.password_reset_requests(password_reset_request_id),
 consumed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK(actor_user_id<>target_user_id)
);
ALTER TABLE warehouse_identity.supervised_recovery_proof_consumptions_v1 ENABLE ROW LEVEL SECURITY;
ALTER TABLE warehouse_identity.supervised_recovery_proof_consumptions_v1 FORCE ROW LEVEL SECURITY;
ALTER TABLE warehouse_identity.user_recovery_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE warehouse_identity.user_recovery_contacts FORCE ROW LEVEL SECURITY;
ALTER TABLE warehouse_identity.recovery_contact_challenges_v1 ENABLE ROW LEVEL SECURITY;
ALTER TABLE warehouse_identity.recovery_contact_challenges_v1 FORCE ROW LEVEL SECURITY;
ALTER TABLE warehouse_identity.recovery_proofs_v1 ENABLE ROW LEVEL SECURITY;
ALTER TABLE warehouse_identity.recovery_proofs_v1 FORCE ROW LEVEL SECURITY;
REVOKE ALL ON warehouse_identity.user_recovery_contacts,warehouse_identity.recovery_contact_challenges_v1,
 warehouse_identity.recovery_proofs_v1,warehouse_identity.supervised_recovery_proof_consumptions_v1 FROM PUBLIC,anon,authenticated,service_role;
-- No broad table grants or public RLS policies. Provision audited, least-privilege
-- owner/migration role and explicit scoped SECURITY INVOKER backend permissions separately.
COMMIT;
