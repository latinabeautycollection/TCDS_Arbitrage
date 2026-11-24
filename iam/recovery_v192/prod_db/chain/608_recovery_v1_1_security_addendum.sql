-- V1.1 additive hardening. Install only in an isolated schema clone; 604 must exist.
BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';
DO $$ BEGIN
 IF to_regclass('warehouse_identity.user_recovery_contacts') IS NULL OR to_regclass('warehouse_identity.password_reset_requests') IS NULL THEN RAISE EXCEPTION 'RECOVERY_V11_PRECONDITIONS_MISSING'; END IF;
END $$;
ALTER TABLE warehouse_identity.user_recovery_contacts
 ADD COLUMN recovery_eligible_at timestamptz;
-- Do not treat unknown corporate mailbox ownership as a personal recovery factor.
CREATE TABLE warehouse_identity.recovery_destination_reviews_v11 (
  contact_type text NOT NULL CHECK(contact_type='EMAIL'),
  value_fingerprint bytea NOT NULL CHECK (octet_length(value_fingerprint)=32),
  decision text NOT NULL CHECK(decision IN ('PERSONAL_VERIFIED','SHARED_DENIED','UNKNOWN')),
  individual_ownership_reference text NOT NULL CHECK(length(btrim(individual_ownership_reference))>8),
  approved_by_iam_user_id uuid REFERENCES warehouse_identity.users(user_id),
  approved_at timestamptz,
  expires_at timestamptz,
  PRIMARY KEY(contact_type,value_fingerprint),
  CONSTRAINT approved_personal_owner CHECK(decision <> 'PERSONAL_VERIFIED' OR
     (approved_by_iam_user_id IS NOT NULL AND approved_at IS NOT NULL AND expires_at IS NOT NULL AND expires_at>approved_at))
);
ALTER TABLE warehouse_identity.recovery_destination_reviews_v11 ENABLE ROW LEVEL SECURITY;
ALTER TABLE warehouse_identity.recovery_destination_reviews_v11 FORCE ROW LEVEL SECURITY;
REVOKE ALL ON warehouse_identity.recovery_destination_reviews_v11 FROM PUBLIC,anon,authenticated,service_role;
-- A pre-approved personal mailbox review is required in addition to code proof.
-- Registry is IAM-governed; ordinary runtime may neither create nor modify it.
CREATE FUNCTION warehouse_identity.is_personal_recovery_destination_v11(p_type text,p_fingerprint bytea)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM warehouse_identity.recovery_destination_reviews_v11 r
 WHERE r.contact_type=p_type AND r.value_fingerprint=p_fingerprint
 AND r.decision='PERSONAL_VERIFIED' AND r.expires_at>clock_timestamp());
$$;
REVOKE ALL ON FUNCTION warehouse_identity.is_personal_recovery_destination_v11(text,bytea) FROM PUBLIC,anon,authenticated,service_role;
-- V1.0's broad runtime grants/policies must not be promoted.
-- On staging, if 604a was previously installed, explicitly revoke access and remove policies.
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='iam_recovery_runtime') THEN
  REVOKE ALL ON warehouse_identity.user_recovery_contacts,warehouse_identity.recovery_contact_challenges_v1,warehouse_identity.recovery_proofs_v1,warehouse_identity.supervised_recovery_proof_consumptions_v1 FROM iam_recovery_runtime;
  REVOKE ALL ON enterprise_org.leadership_people,enterprise_org.leadership_appointments,enterprise_org.contact_points FROM iam_recovery_runtime;
 END IF;
END $$;
DROP POLICY IF EXISTS iam_recovery_contacts_runtime ON warehouse_identity.user_recovery_contacts;
DROP POLICY IF EXISTS iam_recovery_challenges_runtime ON warehouse_identity.recovery_contact_challenges_v1;
DROP POLICY IF EXISTS iam_recovery_proofs_runtime ON warehouse_identity.recovery_proofs_v1;
DROP POLICY IF EXISTS iam_recovery_supervised_insert ON warehouse_identity.supervised_recovery_proof_consumptions_v1;
-- Existing certified IAM owner must provide dedicated, audited operations with
-- transaction-verified subject context. Runtime is deliberately disabled until then.
COMMIT;
