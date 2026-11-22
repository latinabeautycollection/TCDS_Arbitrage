-- Operator-authorized rollback for ADDITIVE 640/641 ONLY; NOT 635 or 620-622.
-- Run only AFTER disabling workers, draining active browser recovery, and snapshotting evidence.
BEGIN;
SET LOCAL search_path=pg_catalog,pg_temp;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';
DO $pre$ BEGIN
 IF to_regclass('warehouse_identity.recovery_claim_bindings_v191') IS NULL
 OR to_regclass('warehouse_identity.recovery_issuance_jobs_v19') IS NULL THEN
 RAISE EXCEPTION 'R640_641_ROLLBACK_REQUIRES_OBJECTS'; END IF;
 IF EXISTS(SELECT 1 FROM warehouse_identity.recovery_claim_bindings_v191 b
   WHERE b.expires_at>clock_timestamp()) THEN RAISE EXCEPTION 'ACTIVE_BROWSER_CLAIMS_BLOCK_ROLLBACK'; END IF;
 IF EXISTS(SELECT 1 FROM warehouse_identity.recovery_issuance_jobs_v19 j
   WHERE j.status='WORKING' OR (j.status='BLOCKED' AND j.retry_after>clock_timestamp()))
 THEN RAISE EXCEPTION 'ACTIVE_ISSUANCE_WORK_BLOCKS_ROLLBACK'; END IF;
END $pre$;
DROP TABLE warehouse_identity.recovery_claim_bindings_v191;
ALTER TABLE warehouse_identity.recovery_issuance_jobs_v19 DROP COLUMN retry_after,DROP COLUMN last_error_class;
COMMIT;
