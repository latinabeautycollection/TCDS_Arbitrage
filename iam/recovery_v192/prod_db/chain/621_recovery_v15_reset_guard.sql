-- 621 - ours (TCDS production engineering), on top of V1.5 + 620. Staging first.
-- recovery_reset_guard_v15: the supplemental-proof step of the single consume transaction (Anthony decision 3).
-- login-v2-api has no table access, so the policy decision lives here too:
--   REQUIRE_SUPPLEMENTAL  the reset's user has a VERIFIED, unrevoked recovery contact past its cooling-off
--                         (recovery_eligible_at <= now) -> a proof for THIS reset request must be consumed
--   NO_SUPPLEMENTAL       otherwise (today: every user - no contacts exist yet)
-- The user comes from the locked reset request, never from the caller. Every failure RAISES, so the caller's
-- transaction (guard -> consume_password_reset_v5 -> iam_advance_session_epoch_v15) commits whole or not at all.
-- Run 621's rollback BEFORE 620's rollback.
BEGIN;
SET LOCAL search_path = pg_catalog, pg_temp;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
DO $preflight$
BEGIN
 IF to_regprocedure('warehouse_identity.recovery_consume_supplemental_proof_v15(uuid,uuid,uuid)') IS NULL
 THEN RAISE EXCEPTION 'R621_620_NOT_INSTALLED'; END IF;
 IF to_regprocedure('warehouse_identity.recovery_reset_guard_v15(uuid,uuid)') IS NOT NULL
 THEN RAISE EXCEPTION 'R621_ALREADY_INSTALLED'; END IF;
 -- The rollback revokes this grant unconditionally, so it must not exist beforehand.
 IF has_table_privilege('tcds_identity_function_owner', 'warehouse_identity.user_recovery_contacts', 'SELECT')
 THEN RAISE EXCEPTION 'R621_FN_OWNER_ALREADY_READS_CONTACTS'; END IF;
END $preflight$;

-- Lock order matches v5: reset request first (here and inside the 620 proof function), then the user.
CREATE FUNCTION warehouse_identity.recovery_reset_guard_v15(p_reset_request_id uuid, p_proof_id uuid DEFAULT NULL)
RETURNS TABLE(decision text, user_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $fn$
DECLARE v_user uuid; v_required boolean;
BEGIN
 IF p_reset_request_id IS NULL THEN RAISE EXCEPTION 'RESET_INVALID' USING ERRCODE = '42501'; END IF;
 SELECT r.user_id INTO v_user FROM warehouse_identity.password_reset_requests r
  WHERE r.password_reset_request_id = p_reset_request_id AND r.status = 'TOKEN_ISSUED' AND r.expires_at > clock_timestamp()
  FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'RESET_INVALID' USING ERRCODE = '42501'; END IF;
 v_required := EXISTS (SELECT 1 FROM warehouse_identity.user_recovery_contacts c
  WHERE c.user_id = v_user AND c.status = 'VERIFIED' AND c.revoked_at IS NULL
    AND c.recovery_eligible_at IS NOT NULL AND c.recovery_eligible_at <= clock_timestamp());
 IF v_required THEN
  IF p_proof_id IS NULL THEN RAISE EXCEPTION 'SUPPLEMENTAL_PROOF_REQUIRED' USING ERRCODE = '42501'; END IF;
  PERFORM warehouse_identity.recovery_consume_supplemental_proof_v15(p_proof_id, v_user, p_reset_request_id);
  RETURN QUERY SELECT 'REQUIRE_SUPPLEMENTAL'::text, v_user;
 ELSE
  RETURN QUERY SELECT 'NO_SUPPLEMENTAL'::text, v_user;
 END IF;
END $fn$;

REVOKE ALL ON FUNCTION warehouse_identity.recovery_reset_guard_v15(uuid,uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION warehouse_identity.recovery_reset_guard_v15(uuid,uuid) TO tcds_login_api, tcds_login_orchestrator;
GRANT SELECT ON warehouse_identity.user_recovery_contacts TO tcds_identity_function_owner;

DO $own$
DECLARE m record; had boolean; need_set boolean; had_create boolean;
BEGIN
 IF NOT (SELECT rolbypassrls FROM pg_roles WHERE rolname = 'tcds_identity_function_owner') THEN
  EXECUTE 'CREATE POLICY r621_fn_owner_contacts ON warehouse_identity.user_recovery_contacts FOR SELECT TO tcds_identity_function_owner USING (true)';
 END IF;
 -- Same membership handling as 620: only the grantor=postgres row, only when SET is not already available.
 need_set := NOT pg_has_role('postgres', 'tcds_identity_function_owner', 'SET');
 SELECT inherit_option, set_option INTO m FROM pg_auth_members
  WHERE roleid = 'tcds_identity_function_owner'::regrole AND member = 'postgres'::regrole AND grantor = 'postgres'::regrole;
 had := FOUND;
 had_create := has_schema_privilege('tcds_identity_function_owner', 'warehouse_identity', 'CREATE');
 IF need_set THEN EXECUTE 'GRANT tcds_identity_function_owner TO postgres WITH SET TRUE'; END IF;
 IF NOT had_create THEN EXECUTE 'GRANT CREATE ON SCHEMA warehouse_identity TO tcds_identity_function_owner'; END IF;
 EXECUTE 'ALTER FUNCTION warehouse_identity.recovery_reset_guard_v15(uuid,uuid) OWNER TO tcds_identity_function_owner';
 IF NOT had_create THEN EXECUTE 'REVOKE CREATE ON SCHEMA warehouse_identity FROM tcds_identity_function_owner'; END IF;
 IF need_set AND had THEN
  EXECUTE format('GRANT tcds_identity_function_owner TO postgres WITH INHERIT %s, SET %s', m.inherit_option::text, m.set_option::text);
 ELSIF need_set THEN
  EXECUTE 'REVOKE tcds_identity_function_owner FROM postgres';
 END IF;
END $own$;

DO $verify$
DECLARE f regprocedure := 'warehouse_identity.recovery_reset_guard_v15(uuid,uuid)'::regprocedure;
BEGIN
 IF (SELECT pg_get_userbyid(proowner) <> 'tcds_identity_function_owner' OR NOT prosecdef FROM pg_proc WHERE oid = f)
  THEN RAISE EXCEPTION 'R621_OWNER_OR_DEFINER_WRONG'; END IF;
 IF has_function_privilege('public', f, 'EXECUTE') OR has_function_privilege('anon', f, 'EXECUTE')
    OR has_function_privilege('authenticated', f, 'EXECUTE') OR has_function_privilege('service_role', f, 'EXECUTE')
  THEN RAISE EXCEPTION 'R621_EXECUTE_TOO_BROAD'; END IF;
 IF NOT has_function_privilege('tcds_login_api', f, 'EXECUTE') THEN RAISE EXCEPTION 'R621_LOGIN_API_CANNOT_EXECUTE'; END IF;
 IF has_table_privilege('tcds_login_api', 'warehouse_identity.user_recovery_contacts', 'SELECT,INSERT,UPDATE,DELETE')
  THEN RAISE EXCEPTION 'R621_LOGIN_API_HAS_TABLE_ACCESS'; END IF;
END $verify$;
COMMIT;
