-- Rollback for 620. Run BEFORE the vendor's 619 (619 does not know about these functions).
-- Restores the vendor's original 614/617 constraints exactly.
BEGIN;
SET LOCAL search_path = pg_catalog, pg_temp;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
DO $guard$
BEGIN
 IF EXISTS (SELECT 1 FROM warehouse_identity.iam_session_epochs_v15
            WHERE reason IN ('SIGN_OUT_EVERYWHERE','PASSKEY_REVOKED')) THEN
  RAISE EXCEPTION 'R620_ROLLBACK_BLOCKED_NEW_REASONS_IN_USE';
 END IF;
END $guard$;
DO $drop$
DECLARE m record; had boolean; need_inherit boolean;
BEGIN
 -- Dropping needs the privileges of the owner. Only if no existing membership already gives them, inherit it for the
 -- duration through postgres's own grant, then restore that grant exactly.
 need_inherit := NOT pg_has_role('postgres', 'tcds_identity_function_owner', 'USAGE');
 SELECT inherit_option, set_option INTO m FROM pg_auth_members
  WHERE roleid = 'tcds_identity_function_owner'::regrole AND member = 'postgres'::regrole AND grantor = 'postgres'::regrole;
 had := FOUND;
 IF need_inherit THEN EXECUTE 'GRANT tcds_identity_function_owner TO postgres WITH INHERIT TRUE'; END IF;
 EXECUTE 'DROP FUNCTION warehouse_identity.recovery_consume_supplemental_proof_v15(uuid,uuid,uuid)';
 EXECUTE 'DROP FUNCTION warehouse_identity.iam_advance_session_epoch_v15(uuid,text,uuid,uuid,uuid)';
 EXECUTE 'DROP FUNCTION warehouse_identity.iam_session_epoch_status_v15(uuid)';
 IF need_inherit AND had THEN
  EXECUTE format('GRANT tcds_identity_function_owner TO postgres WITH INHERIT %s, SET %s', m.inherit_option::text, m.set_option::text);
 ELSIF need_inherit THEN
  EXECUTE 'REVOKE tcds_identity_function_owner FROM postgres';
 END IF;
END $drop$;
DROP POLICY IF EXISTS r620_fn_owner_proofs ON warehouse_identity.recovery_proofs_v1;
DROP POLICY IF EXISTS r620_fn_owner_epochs ON warehouse_identity.iam_session_epochs_v15;
REVOKE ALL ON warehouse_identity.recovery_proofs_v1 FROM tcds_identity_function_owner;
REVOKE ALL ON warehouse_identity.iam_session_epochs_v15 FROM tcds_identity_function_owner;
ALTER TABLE warehouse_identity.iam_session_epochs_v15 DROP CONSTRAINT iam_session_epochs_v15_reason_check;
ALTER TABLE warehouse_identity.iam_session_epochs_v15 ADD CONSTRAINT iam_session_epochs_v15_reason_check
 CHECK (reason IN ('INITIAL','PASSWORD_RESET','IDENTITY_SUSPENDED','GLOBAL_REVOCATION'));
ALTER TABLE warehouse_identity.recovery_destination_reviews_v11 DROP CONSTRAINT ck_v14_approval_two_independent_approvers;
ALTER TABLE warehouse_identity.recovery_destination_reviews_v11 ADD CONSTRAINT ck_v14_approval_two_independent_approvers CHECK (
  decision <> 'PERSONAL_VERIFIED' OR (
   second_approver_iam_user_id IS NOT NULL
   AND second_approver_iam_user_id <> approved_by_iam_user_id
   AND target_user_id <> approved_by_iam_user_id
   AND target_user_id <> second_approver_iam_user_id
   AND length(btrim(verifier_evidence_reference)) BETWEEN 12 AND 500
  ));
COMMIT;
