-- Only when staging confirms NO active issuance/delivery and no worker is running.
BEGIN;
DO $preflight$ BEGIN
 IF EXISTS(SELECT 1 FROM warehouse_identity.recovery_issuance_jobs_v19
           WHERE status IN ('WAITING_APPROVAL','WORKING'))
 THEN RAISE EXCEPTION 'R637_ACTIVE_JOBS_ROLLBACK_BLOCKED'; END IF;
END $preflight$;
DROP TABLE warehouse_identity.recovery_issuance_jobs_v19;
DROP INDEX IF EXISTS warehouse_identity.ix_r637_stale_sending;
ALTER TABLE warehouse_identity.recovery_secret_outbox_v18 DROP COLUMN send_started_at;
COMMIT;
