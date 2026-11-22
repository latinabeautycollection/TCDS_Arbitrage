-- R635 Strict OTP-first. Staging candidate; never rewrite historical 621 file.
-- Source must first be reviewed against actual 621 function definition and exact owner/grants.
BEGIN;
SET LOCAL search_path=pg_catalog,pg_temp;
SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='30s';
DO $pre$ BEGIN
 IF to_regprocedure('warehouse_identity.recovery_reset_guard_v15(uuid,uuid)') IS NULL
 OR to_regprocedure('warehouse_identity.recovery_consume_supplemental_proof_v15(uuid,uuid,uuid)') IS NULL
 OR to_regclass('warehouse_identity.recovery_proofs_v1') IS NULL
 OR to_regclass('warehouse_identity.user_recovery_contacts') IS NULL
 OR to_regclass('warehouse_identity.recovery_contact_challenges_v1') IS NULL
 OR pg_get_userbyid((SELECT proowner FROM pg_proc WHERE oid='warehouse_identity.recovery_reset_guard_v15(uuid,uuid)'::regprocedure))<>'tcds_identity_function_owner'
 THEN RAISE EXCEPTION 'R635_PRECHECK_FAILED'; END IF;
 IF to_regprocedure('warehouse_identity.recovery_proof_eligible_v18(uuid,uuid)') IS NOT NULL THEN
   RAISE EXCEPTION 'R635_ALREADY_INSTALLED'; END IF;
END $pre$;
CREATE FUNCTION warehouse_identity.recovery_proof_eligible_v18(p_request uuid,p_proof uuid)
RETURNS boolean LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $fn$
 SELECT p_request IS NOT NULL AND p_proof IS NOT NULL AND EXISTS(
 SELECT 1 FROM warehouse_identity.password_reset_requests r
 JOIN warehouse_identity.recovery_proofs_v1 proof ON proof.reset_request_id=r.password_reset_request_id AND proof.user_id=r.user_id
 JOIN warehouse_identity.recovery_contact_challenges_v1 ch ON ch.challenge_id=proof.challenge_id
   AND ch.reset_request_id=r.password_reset_request_id AND ch.user_id=r.user_id
 JOIN warehouse_identity.user_recovery_contacts c ON c.contact_id=ch.contact_id AND c.user_id=r.user_id
 WHERE r.password_reset_request_id=p_request AND r.status='TOKEN_ISSUED' AND r.expires_at>clock_timestamp()
   AND proof.proof_id=p_proof AND proof.consumed_at IS NULL AND proof.expires_at>clock_timestamp()
   AND ch.purpose='PASSWORD_RESET' AND ch.consumed_at IS NOT NULL AND ch.delivery_state='ACCEPTED'
   AND ch.expires_at>proof.created_at
   AND c.status='VERIFIED' AND c.revoked_at IS NULL AND c.recovery_eligible_at<=clock_timestamp()
   AND ((c.contact_type='EMAIL' AND proof.assurance_method='VERIFIED_EMAIL_CODE')
    OR (c.contact_type='SMS' AND proof.assurance_method='VERIFIED_SMS_CODE'))
 );
$fn$;
-- Existing standard reset has NO bypass when user has no eligible contact.
CREATE OR REPLACE FUNCTION warehouse_identity.recovery_reset_guard_v15(p_reset_request_id uuid,p_proof_id uuid DEFAULT NULL)
RETURNS TABLE(decision text,user_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE v_user uuid;
BEGIN
 IF p_reset_request_id IS NULL OR p_proof_id IS NULL THEN
  RAISE EXCEPTION 'OTP_PROOF_REQUIRED' USING ERRCODE='42501'; END IF;
 SELECT r.user_id INTO v_user FROM warehouse_identity.password_reset_requests r
 WHERE r.password_reset_request_id=p_reset_request_id AND r.status='TOKEN_ISSUED'
  AND r.expires_at>clock_timestamp() FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'RESET_INVALID' USING ERRCODE='42501'; END IF;
 IF NOT warehouse_identity.recovery_proof_eligible_v18(p_reset_request_id,p_proof_id) THEN
  RAISE EXCEPTION 'OTP_PROOF_REQUIRED' USING ERRCODE='42501'; END IF;
 PERFORM warehouse_identity.recovery_consume_supplemental_proof_v15(p_proof_id,v_user,p_reset_request_id);
 RETURN QUERY SELECT 'REQUIRE_SUPPLEMENTAL'::text,v_user;
END $fn$;
REVOKE ALL ON FUNCTION warehouse_identity.recovery_proof_eligible_v18(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON warehouse_identity.recovery_contact_challenges_v1 TO tcds_identity_function_owner;
DO $rls$ BEGIN
 IF NOT (SELECT rolbypassrls FROM pg_roles WHERE rolname='tcds_identity_function_owner') THEN
   CREATE POLICY r635_fn_owner_challenges ON warehouse_identity.recovery_contact_challenges_v1
     FOR SELECT TO tcds_identity_function_owner USING(true);
 END IF;
END $rls$;
-- Align newly created proof gate owner with already deployed privileged guard owner.
ALTER FUNCTION warehouse_identity.recovery_proof_eligible_v18(uuid,uuid) OWNER TO tcds_identity_function_owner;
GRANT EXECUTE ON FUNCTION warehouse_identity.recovery_proof_eligible_v18(uuid,uuid)
 TO tcds_login_api,tcds_login_orchestrator,tcds_identity_function_owner;
DO $verify$ BEGIN
 IF has_function_privilege('anon','warehouse_identity.recovery_proof_eligible_v18(uuid,uuid)','EXECUTE')
 OR has_function_privilege('authenticated','warehouse_identity.recovery_proof_eligible_v18(uuid,uuid)','EXECUTE')
 OR has_function_privilege('service_role','warehouse_identity.recovery_proof_eligible_v18(uuid,uuid)','EXECUTE')
 THEN RAISE EXCEPTION 'R635_BAD_EXECUTE_GRANTS'; END IF;
 IF position('NO_SUPPLEMENTAL' IN pg_get_functiondef('warehouse_identity.recovery_reset_guard_v15(uuid,uuid)'::regprocedure))>0
 THEN RAISE EXCEPTION 'R635_ORDINARY_BYPASS_REMAINS'; END IF;
END $verify$;
COMMIT;
