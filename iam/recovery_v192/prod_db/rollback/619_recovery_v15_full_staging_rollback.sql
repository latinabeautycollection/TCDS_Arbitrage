-- Disposable staging ONLY. V1.5 canonical rollback; do not use the legacy 615 alone. Never run in production. One transaction including DROP ROLE.
BEGIN;
SET LOCAL search_path = pg_catalog, pg_temp;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
DO $preflight$
BEGIN
 IF to_regclass('warehouse_identity.user_recovery_contacts') IS NULL OR
    to_regclass('warehouse_identity.recovery_rate_buckets_v14') IS NULL OR
    to_regclass('warehouse_identity.recovery_delivery_receipt_inbox_v13') IS NULL THEN
   RAISE EXCEPTION 'RECOVERY_STAGING_ROLLBACK_EXPECTED_OBJECTS_MISSING';
 END IF;
 IF EXISTS(SELECT 1 FROM warehouse_identity.user_recovery_contacts) OR
    EXISTS(SELECT 1 FROM warehouse_identity.iam_session_epochs_v15) OR
    EXISTS(SELECT 1 FROM warehouse_identity.recovery_destination_reviews_v11) OR
    EXISTS(SELECT 1 FROM warehouse_identity.recovery_rate_buckets_v14) OR
    EXISTS(SELECT 1 FROM warehouse_identity.recovery_destination_approval_events_v14) OR
    EXISTS(SELECT 1 FROM warehouse_identity.recovery_contact_challenges_v1) OR
    EXISTS(SELECT 1 FROM warehouse_identity.recovery_proofs_v1) OR
    EXISTS(SELECT 1 FROM warehouse_identity.recovery_delivery_receipt_inbox_v13) THEN
   RAISE EXCEPTION 'RECOVERY_STAGING_ROLLBACK_REQUIRES_EMPTY_PACKAGE_TABLES';
 END IF;
END $preflight$;
DROP TRIGGER tr_recovery_challenge_normalize_expiry_v14 ON warehouse_identity.recovery_contact_challenges_v1;
DROP FUNCTION warehouse_identity.recovery_challenge_normalize_expiry_v14();
DROP TABLE warehouse_identity.recovery_destination_approval_events_v14;
DROP TABLE warehouse_identity.recovery_rate_buckets_v14;
DROP FUNCTION warehouse_identity.is_personal_recovery_destination_v14(uuid,text,bytea);
DROP TABLE warehouse_identity.recovery_delivery_receipt_inbox_v13;
DROP TRIGGER tr_recovery_proof_normalize_expiry_v13 ON warehouse_identity.recovery_proofs_v1;
DROP FUNCTION warehouse_identity.recovery_proof_normalize_expiry_v13();
DROP INDEX warehouse_identity.ux_recovery_v12_delivery_reference;
DROP INDEX warehouse_identity.ix_recovery_v12_challenge_user_time;
ALTER TABLE warehouse_identity.user_recovery_contacts DROP CONSTRAINT ck_recovery_v12_verified_after_created;
DROP FUNCTION warehouse_identity.is_personal_recovery_destination_v11(text,bytea);
DROP TABLE warehouse_identity.recovery_destination_reviews_v11;
ALTER TABLE warehouse_identity.user_recovery_contacts DROP COLUMN recovery_eligible_at;
DROP TABLE warehouse_identity.supervised_recovery_proof_consumptions_v1;
DROP TABLE warehouse_identity.recovery_proofs_v1;
DROP TABLE warehouse_identity.recovery_contact_challenges_v1;
DROP TABLE warehouse_identity.user_recovery_contacts;
-- If role has unapproved external dependencies DROP ROLE raises and all DDL above rolls back.
DROP TABLE IF EXISTS warehouse_identity.iam_session_epochs_v15;
DROP ROLE IF EXISTS iam_recovery_runtime;
COMMIT;
