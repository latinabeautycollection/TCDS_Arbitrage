-- 645 rollback (ours). Removes recovery-email enrollment and returns the catalog to its pre-645 state.
-- Open enrollments are cancelled first (their PENDING contacts revoked). Contacts that were already APPROVED stay VERIFIED
-- in the vendor contacts table (they are user data, not part of 645). Approval audit rows go with the 645 tables; the
-- passkey evidence rows stay in webauthn_verification_evidence and the security events stay in warehouse_audit.
BEGIN;
SET LOCAL search_path = pg_catalog, pg_temp;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
DO $pre$ BEGIN
 IF to_regclass('warehouse_identity.recovery_contact_enrollments_v645') IS NULL THEN RAISE EXCEPTION 'R645RB_NOT_INSTALLED'; END IF;
END $pre$;

WITH x AS (UPDATE warehouse_identity.recovery_contact_enrollments_v645 SET status = 'CANCELLED', closed_at = clock_timestamp()
            WHERE status IN ('AWAITING_CODE', 'AWAITING_APPROVAL') RETURNING contact_id)
UPDATE warehouse_identity.user_recovery_contacts c SET status = 'REVOKED', revoked_at = clock_timestamp(), updated_at = clock_timestamp(),
       row_version = row_version + 1 FROM x WHERE c.contact_id = x.contact_id AND c.status = 'PENDING';

DO $f$ DECLARE f regprocedure; BEGIN
 FOR f IN SELECT p.oid::regprocedure FROM pg_proc p WHERE p.pronamespace = 'warehouse_identity'::regnamespace
            AND (p.proname LIKE 'recovery\_%\_v645' OR p.proname LIKE 'central\_%\_v645') LOOP
  EXECUTE format('DROP FUNCTION %s', f);
 END LOOP;
END $f$;

DELETE FROM warehouse_identity.central_challenge_context WHERE purpose = 'RECOVERY_CONTACT_APPROVAL';
ALTER TABLE warehouse_identity.central_challenge_context DROP CONSTRAINT central_challenge_context_recovery_check;
ALTER TABLE warehouse_identity.central_challenge_context DROP COLUMN recovery_enrollment_id;
ALTER TABLE warehouse_identity.central_challenge_context DROP CONSTRAINT central_challenge_context_purpose_check;
ALTER TABLE warehouse_identity.central_challenge_context ADD CONSTRAINT central_challenge_context_purpose_check
  CHECK (purpose IN ('CENTRAL_PASSKEY_ENROLLMENT', 'EOC_OIDC_LOGIN', 'EOC_BINDING_APPROVAL', 'EOC_GRANT_APPROVAL'));

DROP TABLE warehouse_identity.recovery_contact_approvals_v645;
DROP TABLE warehouse_identity.recovery_contact_enrollments_v645;
DROP TABLE warehouse_identity.recovery_contact_policy_v645;

DELETE FROM warehouse_identity.user_role_assignments
 WHERE role_id = (SELECT role_id FROM warehouse_identity.roles WHERE role_code = 'IAM_RECOVERY_DESTINATION_APPROVER');
DELETE FROM warehouse_identity.roles WHERE role_code = 'IAM_RECOVERY_DESTINATION_APPROVER';

DO $p$ DECLARE l record; pr text; BEGIN
 FOR l IN SELECT substr(item, 10) AS t, value FROM warehouse_identity.recovery_v192_ledger WHERE item LIKE 'v645priv:%' LOOP
  FOR pr IN SELECT DISTINCT x.privilege_type FROM pg_class c, aclexplode(c.relacl) x
    WHERE c.oid = l.t::regclass AND x.grantee = 'tcds_identity_function_owner'::regrole LOOP
   IF NOT (pr = ANY (string_to_array(l.value, ','))) THEN EXECUTE format('REVOKE %s ON %s FROM tcds_identity_function_owner', pr, l.t); END IF;
  END LOOP;
 END LOOP;
 DELETE FROM warehouse_identity.recovery_v192_ledger WHERE item LIKE 'v645priv:%';
END $p$;
COMMIT;
