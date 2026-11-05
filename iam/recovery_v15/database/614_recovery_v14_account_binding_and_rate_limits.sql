-- 614 - V1.4 staging-first additive security hardening. Depends on 604..612.
-- Never issue production approvals from a migration or use shared contact addresses.
BEGIN;
SET LOCAL search_path = pg_catalog, pg_temp;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
DO $preflight$
BEGIN
 IF to_regclass('warehouse_identity.recovery_destination_reviews_v11') IS NULL
 OR to_regclass('warehouse_identity.recovery_delivery_receipt_inbox_v13') IS NULL
 OR to_regclass('warehouse_identity.user_recovery_contacts') IS NULL
 THEN RAISE EXCEPTION 'V14_DEPENDENCIES_MISSING'; END IF;
 IF EXISTS(SELECT 1 FROM warehouse_identity.recovery_destination_reviews_v11)
 THEN RAISE EXCEPTION 'V14_LEGACY_GLOBAL_DESTINATION_APPROVALS_REQUIRE_MANUAL_REVIEW'; END IF;
END $preflight$;
ALTER TABLE warehouse_identity.recovery_destination_reviews_v11
 ADD COLUMN target_user_id uuid REFERENCES warehouse_identity.users(user_id),
 ADD COLUMN verifier_evidence_reference text,
 ADD COLUMN second_approver_iam_user_id uuid REFERENCES warehouse_identity.users(user_id);
ALTER TABLE warehouse_identity.recovery_destination_reviews_v11
 ALTER COLUMN target_user_id SET NOT NULL;
ALTER TABLE warehouse_identity.recovery_destination_reviews_v11
 DROP CONSTRAINT recovery_destination_reviews_v11_pkey;
ALTER TABLE warehouse_identity.recovery_destination_reviews_v11
 ADD CONSTRAINT recovery_destination_reviews_v11_pkey PRIMARY KEY(target_user_id,contact_type,value_fingerprint);
ALTER TABLE warehouse_identity.recovery_destination_reviews_v11
 ADD CONSTRAINT ck_v14_approval_two_independent_approvers CHECK (
  decision <> 'PERSONAL_VERIFIED' OR (
   second_approver_iam_user_id IS NOT NULL
   AND second_approver_iam_user_id <> approved_by_iam_user_id
   AND target_user_id <> approved_by_iam_user_id
   AND target_user_id <> second_approver_iam_user_id
   AND length(btrim(verifier_evidence_reference)) BETWEEN 12 AND 500
  ));
-- Account-specific lookup, not a fingerprint-only global allowlist.
CREATE FUNCTION warehouse_identity.is_personal_recovery_destination_v14(
 p_user_id uuid,p_type text,p_fingerprint bytea)
RETURNS boolean LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS $fn$
 SELECT EXISTS(
 SELECT 1 FROM warehouse_identity.recovery_destination_reviews_v11 r
 WHERE r.target_user_id=p_user_id AND r.contact_type=p_type
 AND r.value_fingerprint=p_fingerprint AND r.decision='PERSONAL_VERIFIED'
 AND r.expires_at>clock_timestamp());
$fn$;
REVOKE ALL ON FUNCTION warehouse_identity.is_personal_recovery_destination_v14(uuid,text,bytea)
 FROM PUBLIC,anon,authenticated,service_role;
-- A single durable challenge rate bucket can enforce contact/user/purpose controls.
-- The trusted service must supply a keyed privacy-preserving bucket hash, not raw IP.
CREATE TABLE warehouse_identity.recovery_rate_buckets_v14 (
 bucket_hash bytea PRIMARY KEY CHECK (octet_length(bucket_hash)=32),
 window_started_at timestamptz NOT NULL,
 window_seconds integer NOT NULL CHECK(window_seconds BETWEEN 30 AND 86400),
 count integer NOT NULL DEFAULT 0 CHECK(count BETWEEN 0 AND 100000),
 blocked_until timestamptz,
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE warehouse_identity.recovery_rate_buckets_v14 ENABLE ROW LEVEL SECURITY;
ALTER TABLE warehouse_identity.recovery_rate_buckets_v14 FORCE ROW LEVEL SECURITY;
REVOKE ALL ON warehouse_identity.recovery_rate_buckets_v14 FROM PUBLIC,anon,authenticated,service_role;
-- Approval audit is IAM-owned, never a substitute for Domain 10 delivery audit.
CREATE TABLE warehouse_identity.recovery_destination_approval_events_v14 (
 event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 target_user_id uuid NOT NULL REFERENCES warehouse_identity.users(user_id),
 contact_type text NOT NULL CHECK(contact_type='EMAIL'),
 value_fingerprint bytea NOT NULL CHECK(octet_length(value_fingerprint)=32),
 decision text NOT NULL CHECK(decision IN('PERSONAL_VERIFIED','SHARED_DENIED','UNKNOWN')),
 approved_by uuid NOT NULL REFERENCES warehouse_identity.users(user_id),
 second_approver uuid NOT NULL REFERENCES warehouse_identity.users(user_id),
 evidence_reference text NOT NULL CHECK(length(btrim(evidence_reference))>=12),
 request_id uuid NOT NULL UNIQUE,
 occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK(approved_by<>second_approver AND approved_by<>target_user_id AND second_approver<>target_user_id)
);
CREATE UNIQUE INDEX ux_recovery_v14_one_use_approval_evidence ON warehouse_identity.recovery_destination_approval_events_v14(evidence_reference);
ALTER TABLE warehouse_identity.recovery_destination_approval_events_v14 ENABLE ROW LEVEL SECURITY;
ALTER TABLE warehouse_identity.recovery_destination_approval_events_v14 FORCE ROW LEVEL SECURITY;
REVOKE ALL ON warehouse_identity.recovery_destination_approval_events_v14 FROM PUBLIC,anon,authenticated,service_role;
-- Avoid a second independent clock_timestamp() expiry CHECK failure for contact OTPs.
CREATE FUNCTION warehouse_identity.recovery_challenge_normalize_expiry_v14()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $fn$
BEGIN
 NEW.created_at := clock_timestamp();
 NEW.expires_at := NEW.created_at + interval '10 minutes';
 RETURN NEW;
END $fn$;
CREATE TRIGGER tr_recovery_challenge_normalize_expiry_v14
BEFORE INSERT ON warehouse_identity.recovery_contact_challenges_v1
FOR EACH ROW EXECUTE FUNCTION warehouse_identity.recovery_challenge_normalize_expiry_v14();
REVOKE ALL ON FUNCTION warehouse_identity.recovery_challenge_normalize_expiry_v14()
 FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
