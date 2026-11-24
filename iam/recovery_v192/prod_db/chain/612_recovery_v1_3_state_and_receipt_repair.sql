-- TCDS IAM Recovery V1.3 targeted corrections. Staging rehearsal only.
-- Apply after 604,604a,608,610; all object names under existing IAM authority.
BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';
DO $preflight$ BEGIN
 IF to_regclass('warehouse_identity.recovery_proofs_v1') IS NULL OR
    to_regclass('warehouse_identity.recovery_contact_challenges_v1') IS NULL OR
    to_regclass('warehouse_identity.user_recovery_contacts') IS NULL OR
    to_regclass('warehouse_identity.recovery_destination_reviews_v11') IS NULL OR
    to_regclass('warehouse_identity.password_reset_requests') IS NULL THEN
    RAISE EXCEPTION 'IAM_V13_REQUIRED_OBJECTS_MISSING'; END IF;
END $preflight$;
-- The old CHECK compares separate clock_timestamp() evaluations, rejecting some
-- otherwise valid five-minute proof inserts. Normalize both fields BEFORE checks.
CREATE FUNCTION warehouse_identity.recovery_proof_normalize_expiry_v13()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $f$
BEGIN
 IF TG_OP='INSERT' THEN
   NEW.created_at := clock_timestamp();
   NEW.expires_at := NEW.created_at + interval '5 minutes';
 END IF;
 RETURN NEW;
END $f$;
CREATE TRIGGER tr_recovery_proof_normalize_expiry_v13
BEFORE INSERT ON warehouse_identity.recovery_proofs_v1
FOR EACH ROW EXECUTE FUNCTION warehouse_identity.recovery_proof_normalize_expiry_v13();
REVOKE ALL ON FUNCTION warehouse_identity.recovery_proof_normalize_expiry_v13() FROM PUBLIC;
-- Reconciliation inbox: an out-of-order trusted receipt can be safely persisted
-- until the worker commits the delivery reference; no OTP is made usable here.
CREATE TABLE warehouse_identity.recovery_delivery_receipt_inbox_v13 (
 challenge_id uuid NOT NULL REFERENCES warehouse_identity.recovery_contact_challenges_v1(challenge_id),
 delivery_id text NOT NULL CHECK(length(delivery_id) BETWEEN 1 AND 200),
 receipt_state text NOT NULL CHECK(receipt_state IN('ACCEPTED','UNKNOWN','FAILED')),
 received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(challenge_id,delivery_id)
);
ALTER TABLE warehouse_identity.recovery_delivery_receipt_inbox_v13 ENABLE ROW LEVEL SECURITY;
ALTER TABLE warehouse_identity.recovery_delivery_receipt_inbox_v13 FORCE ROW LEVEL SECURITY;
REVOKE ALL ON warehouse_identity.recovery_delivery_receipt_inbox_v13 FROM PUBLIC;
-- Unprivileged roles obtain no table policy. Approved narrow trusted operations
-- must be added only after independent permission tests.
COMMIT;
