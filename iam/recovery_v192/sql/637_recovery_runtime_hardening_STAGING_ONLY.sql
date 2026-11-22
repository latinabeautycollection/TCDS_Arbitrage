-- V1.9 additive hardening over reviewed 634–636. Never run in production without staging certification.
BEGIN;
SET LOCAL search_path=pg_catalog,pg_temp;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $preflight$ BEGIN
 IF to_regclass('warehouse_identity.recovery_secret_outbox_v18') IS NULL
 OR to_regclass('warehouse_identity.recovery_invitation_refs_v18') IS NULL
 OR to_regclass('warehouse_identity.password_reset_requests') IS NULL
 THEN RAISE EXCEPTION 'R637_V18_OR_IAM_PREREQUISITES_MISSING'; END IF;
 IF to_regclass('warehouse_identity.recovery_issuance_jobs_v19') IS NOT NULL
 THEN RAISE EXCEPTION 'R637_ALREADY_INSTALLED'; END IF;
END $preflight$;
ALTER TABLE warehouse_identity.recovery_secret_outbox_v18 ADD COLUMN send_started_at timestamptz;
CREATE INDEX ix_r637_stale_sending ON warehouse_identity.recovery_secret_outbox_v18(send_started_at)
 WHERE status='SENDING';
CREATE TABLE warehouse_identity.recovery_issuance_jobs_v19 (
 reset_request_id uuid PRIMARY KEY REFERENCES warehouse_identity.password_reset_requests(password_reset_request_id),
 correlation_id uuid NOT NULL,
 status text NOT NULL CHECK(status IN ('WAITING_APPROVAL','WORKING','PREPARED','BLOCKED')),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 10),
 leased_until timestamptz,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK ((status='WORKING')=(leased_until IS NOT NULL))
);
CREATE INDEX ix_r637_issuance_pending ON warehouse_identity.recovery_issuance_jobs_v19(status,created_at)
 WHERE status IN ('WAITING_APPROVAL','WORKING');
REVOKE ALL ON warehouse_identity.recovery_issuance_jobs_v19 FROM PUBLIC,anon,authenticated,service_role;
ALTER TABLE warehouse_identity.recovery_issuance_jobs_v19 ENABLE ROW LEVEL SECURITY;
ALTER TABLE warehouse_identity.recovery_issuance_jobs_v19 FORCE ROW LEVEL SECURITY;
-- Runtime role is DBA-selected and must be mapped to existing Login V2 process after least-privilege review.
-- NO blanket runtime grants or forced ownership migrations in this staging candidate.
COMMIT;
