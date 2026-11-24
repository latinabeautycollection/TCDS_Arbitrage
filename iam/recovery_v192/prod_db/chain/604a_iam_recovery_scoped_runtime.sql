-- V1.1 safe replacement for V1.0 604a; no broad runtime table grants.
-- Run only after 604 in a review-approved isolated staging clone.
BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';
DO $$ BEGIN
 IF to_regclass('warehouse_identity.user_recovery_contacts') IS NULL OR to_regclass('enterprise_org.leadership_people') IS NULL THEN RAISE EXCEPTION 'IAM_AND_ORG_SCHEMA_REQUIRED'; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='iam_recovery_runtime') THEN RAISE EXCEPTION 'RUNTIME_ROLE_EXISTS_RECONCILE_FIRST'; END IF;
END $$;
CREATE ROLE iam_recovery_runtime NOLOGIN;
-- No table grants and no permissive RLS policies. Certified narrowly scoped
-- backend DB operations must be supplied/verified before turning runtime on.
REVOKE ALL ON SCHEMA warehouse_identity,enterprise_org FROM iam_recovery_runtime;
COMMIT;
