-- STAGING ONLY; never destroy retention or legal hold records in production.
BEGIN;
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM eoc_oidc.audit_legal_holds LIMIT 1) OR EXISTS (SELECT 1 FROM eoc_oidc.audit_archival_receipts LIMIT 1)
 THEN RAISE EXCEPTION 'AUDIT_GOVERNANCE_RECORDS_PRESENT_ROLLBACK_DENIED'; END IF;
END $$;
DROP INDEX IF EXISTS eoc_oidc.issuer_security_events_retention_idx;
DROP TABLE IF EXISTS eoc_oidc.audit_archival_receipts;
DROP TABLE IF EXISTS eoc_oidc.audit_legal_holds;
COMMIT;
