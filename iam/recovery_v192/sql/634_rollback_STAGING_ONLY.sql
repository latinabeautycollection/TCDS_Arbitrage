-- STAGING ONLY. Requires zero active challenges/worker instances, and separate role membership reconciliation.
BEGIN;
SET LOCAL search_path=pg_catalog,pg_temp;
DO $guard$ BEGIN
 IF EXISTS(SELECT 1 FROM warehouse_identity.recovery_secret_outbox_v18 WHERE status IN ('PENDING','SENDING','UNKNOWN'))
 THEN RAISE EXCEPTION 'R634_OUTBOX_NOT_DRAINED'; END IF;
END $guard$;
DROP TABLE IF EXISTS warehouse_identity.recovery_invitation_refs_v18;
DROP TABLE IF EXISTS warehouse_identity.recovery_secret_outbox_v18;
DROP TABLE IF EXISTS warehouse_identity.recovery_action_challenges_v18;
-- Roles retained intentionally; check memberships and remove through controlled IAM release process.
COMMIT;
