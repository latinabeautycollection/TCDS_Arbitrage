-- V1.9 operator-reviewed privilege mapping. Isolated staging ONLY, after 637.
-- HTTP receives an injected issuance service with a restricted, independently authenticated OTP DB pool.
-- NEVER grant these capabilities to PUBLIC, anon, authenticated or service_role.
BEGIN;
SET LOCAL search_path=pg_catalog,pg_temp;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';
DO $check$ BEGIN
 IF to_regclass('warehouse_identity.recovery_issuance_jobs_v19') IS NULL OR
 NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='tcds_recovery_otp_v18')
 THEN RAISE EXCEPTION 'R638_DEPENDENCY_MISSING';END IF;
END $check$;
GRANT SELECT,INSERT,UPDATE ON warehouse_identity.recovery_issuance_jobs_v19 TO tcds_recovery_otp_v18;
CREATE POLICY r638_otp_jobs ON warehouse_identity.recovery_issuance_jobs_v19
 FOR ALL TO tcds_recovery_otp_v18 USING(true) WITH CHECK(true);
-- Existing 634 grants cover recovery_invitation_refs_v18 for this same role.
-- Existing IAM reset-token issue and consume remain behind approved SECURITY DEFINER interfaces.
DO $verify$ BEGIN
 IF NOT has_table_privilege('tcds_recovery_otp_v18','warehouse_identity.recovery_issuance_jobs_v19','SELECT,INSERT,UPDATE')
 OR has_table_privilege('anon','warehouse_identity.recovery_issuance_jobs_v19','SELECT')
 OR has_table_privilege('authenticated','warehouse_identity.recovery_issuance_jobs_v19','SELECT')
 THEN RAISE EXCEPTION 'R638_PRIVILEGE_CHECK_FAILED';END IF;
END $verify$;
COMMIT;
