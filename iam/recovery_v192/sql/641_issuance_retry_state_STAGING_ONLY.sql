-- V1.9.1 bounded retry state; do not auto-retry policy errors or unknown delivery.
BEGIN;
SET LOCAL search_path=pg_catalog,pg_temp;
SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='30s';
DO $pre$ BEGIN
 IF to_regclass('warehouse_identity.recovery_issuance_jobs_v19') IS NULL
 THEN RAISE EXCEPTION 'R641_637_REQUIRED'; END IF;
 IF EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='warehouse_identity'
 AND table_name='recovery_issuance_jobs_v19' AND column_name='retry_after')
 THEN RAISE EXCEPTION 'R641_ALREADY_INSTALLED'; END IF;
END $pre$;
ALTER TABLE warehouse_identity.recovery_issuance_jobs_v19
 ADD COLUMN retry_after timestamptz,
 ADD COLUMN last_error_class text CHECK(last_error_class IN ('TRANSIENT','POLICY_BLOCKED'));
CREATE INDEX ix_r641_issuance_retry ON warehouse_identity.recovery_issuance_jobs_v19(retry_after)
 WHERE status='BLOCKED' AND retry_after IS NOT NULL;
COMMIT;
