-- 620 - ours (TCDS production engineering), on top of Recovery V1.5 604..617. Staging first.
-- (a) Two-approver CHECK: a NULL verifier_evidence_reference no longer passes (NULL made the vendor CHECK pass).
-- (b) Narrow SECURITY DEFINER interface so login-v2-api (tcds_login_api / tcds_login_orchestrator) can run the
--     single consume transaction without any table access:
--       recovery_consume_supplemental_proof_v15  - consume the supplemental proof (raises on any failure)
--       iam_advance_session_epoch_v15            - bump the IAM session generation + security audit event
--       iam_session_epoch_status_v15             - read active flag + generation (for the IAM verification API)
--     Owned by tcds_identity_function_owner, like the v5 reset functions. Every failure RAISES, so the caller's
--     transaction (guard -> v5 consume -> epoch) can only commit as a whole.
-- (c) Session-generation reasons extended for Anthony's decision 4: SIGN_OUT_EVERYWHERE, PASSKEY_REVOKED.
BEGIN;
SET LOCAL search_path = pg_catalog, pg_temp;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
DO $preflight$
BEGIN
 IF to_regclass('warehouse_identity.recovery_destination_reviews_v11') IS NULL
 OR to_regclass('warehouse_identity.recovery_proofs_v1') IS NULL
 OR to_regclass('warehouse_identity.iam_session_epochs_v15') IS NULL
 OR to_regclass('warehouse_audit.security_events') IS NULL
 OR to_regprocedure('warehouse_identity.consume_password_reset_v5(uuid,bytea,bytea,text,jsonb,uuid,uuid,uuid)') IS NULL
 OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='ck_v14_approval_two_independent_approvers')
 THEN RAISE EXCEPTION 'R620_V15_NOT_INSTALLED'; END IF;
 IF (SELECT count(*) FROM pg_roles WHERE rolname IN ('tcds_identity_function_owner','tcds_login_api','tcds_login_orchestrator')) <> 3
 THEN RAISE EXCEPTION 'R620_IAM_ROLES_MISSING'; END IF;
 IF to_regprocedure('warehouse_identity.iam_advance_session_epoch_v15(uuid,text,uuid,uuid,uuid)') IS NOT NULL
 THEN RAISE EXCEPTION 'R620_ALREADY_INSTALLED'; END IF;
END $preflight$;

-- (a)
ALTER TABLE warehouse_identity.recovery_destination_reviews_v11
 DROP CONSTRAINT ck_v14_approval_two_independent_approvers;
ALTER TABLE warehouse_identity.recovery_destination_reviews_v11
 ADD CONSTRAINT ck_v14_approval_two_independent_approvers CHECK (
  decision <> 'PERSONAL_VERIFIED' OR (
   approved_by_iam_user_id IS NOT NULL
   AND second_approver_iam_user_id IS NOT NULL
   AND verifier_evidence_reference IS NOT NULL
   AND second_approver_iam_user_id <> approved_by_iam_user_id
   AND target_user_id <> approved_by_iam_user_id
   AND target_user_id <> second_approver_iam_user_id
   AND length(btrim(verifier_evidence_reference)) BETWEEN 12 AND 500
  ));

-- (c)
ALTER TABLE warehouse_identity.iam_session_epochs_v15 DROP CONSTRAINT iam_session_epochs_v15_reason_check;
ALTER TABLE warehouse_identity.iam_session_epochs_v15 ADD CONSTRAINT iam_session_epochs_v15_reason_check
 CHECK (reason IN ('INITIAL','PASSWORD_RESET','IDENTITY_SUSPENDED','GLOBAL_REVOCATION','SIGN_OUT_EVERYWHERE','PASSKEY_REVOKED'));

-- (b) Lock order matches consume_password_reset_v5: reset request first, then the user.
CREATE FUNCTION warehouse_identity.recovery_consume_supplemental_proof_v15(
 p_proof_id uuid, p_user_id uuid, p_reset_request_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $fn$
BEGIN
 IF p_proof_id IS NULL OR p_user_id IS NULL OR p_reset_request_id IS NULL THEN
  RAISE EXCEPTION 'RECOVERY_PROOF_CONTEXT_REQUIRED';
 END IF;
 PERFORM 1 FROM warehouse_identity.password_reset_requests r
  WHERE r.password_reset_request_id = p_reset_request_id AND r.user_id = p_user_id
    AND r.status = 'TOKEN_ISSUED' AND r.expires_at > clock_timestamp()
  FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'RESET_TOKEN_NOT_ACTIVE'; END IF;
 PERFORM 1 FROM warehouse_identity.users u
  WHERE u.user_id = p_user_id AND u.status = 'ACTIVE' AND u.archived_at IS NULL
    AND (u.locked_until IS NULL OR u.locked_until < clock_timestamp())
  FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'ACTIVE_USER_REQUIRED'; END IF;
 UPDATE warehouse_identity.recovery_proofs_v1 SET consumed_at = clock_timestamp()
  WHERE proof_id = p_proof_id AND user_id = p_user_id AND reset_request_id = p_reset_request_id
    AND consumed_at IS NULL AND expires_at > clock_timestamp();
 IF NOT FOUND THEN RAISE EXCEPTION 'RESET_PROOF_INVALID_OR_CONSUMED'; END IF;
 RETURN 'CONSUMED';
END $fn$;

-- Works for suspended/disabled users too (suspension must still revoke). INITIAL is not a revocation.
CREATE FUNCTION warehouse_identity.iam_advance_session_epoch_v15(
 p_user_id uuid, p_reason text, p_request_id uuid, p_correlation_id uuid, p_actor_user_id uuid DEFAULT NULL)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $fn$
DECLARE v_epoch bigint;
BEGIN
 IF p_user_id IS NULL OR p_request_id IS NULL THEN RAISE EXCEPTION 'IAM_EPOCH_CONTEXT_REQUIRED'; END IF;
 IF p_reason IS NULL OR p_reason NOT IN ('PASSWORD_RESET','IDENTITY_SUSPENDED','GLOBAL_REVOCATION','SIGN_OUT_EVERYWHERE','PASSKEY_REVOKED') THEN
  RAISE EXCEPTION 'INVALID_EPOCH_REASON';
 END IF;
 PERFORM 1 FROM warehouse_identity.users WHERE user_id = p_user_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'IAM_USER_NOT_FOUND'; END IF;
 INSERT INTO warehouse_identity.iam_session_epochs_v15 AS e (user_id, epoch, reason, last_request_id)
 VALUES (p_user_id, 1, p_reason, p_request_id)
 ON CONFLICT (user_id) DO UPDATE SET epoch = e.epoch + 1, reason = EXCLUDED.reason,
   last_request_id = EXCLUDED.last_request_id, updated_at = clock_timestamp()
 RETURNING e.epoch INTO v_epoch;
 INSERT INTO warehouse_audit.security_events
  (event_type, severity, actor_user_id, entity_type, entity_id, request_id, correlation_id, details)
 VALUES ('IAM_SESSION_EPOCH_ADVANCED', 60, p_actor_user_id, 'IAM_USER', p_user_id, p_request_id, p_correlation_id,
  jsonb_build_object('reason', p_reason, 'epoch', v_epoch));
 RETURN v_epoch;
END $fn$;

-- For the authenticated IAM verification API that EOC calls. Locked, archived, missing => user_active=false.
CREATE FUNCTION warehouse_identity.iam_session_epoch_status_v15(p_user_id uuid)
RETURNS TABLE (user_active boolean, epoch bigint) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $fn$
 SELECT coalesce((SELECT u.status = 'ACTIVE' AND u.archived_at IS NULL
                          AND (u.locked_until IS NULL OR u.locked_until < clock_timestamp())
                   FROM warehouse_identity.users u WHERE u.user_id = p_user_id), false),
        coalesce((SELECT e.epoch FROM warehouse_identity.iam_session_epochs_v15 e WHERE e.user_id = p_user_id), 0);
$fn$;

-- Grants are set while postgres still owns the functions; ALTER OWNER carries them over.
REVOKE ALL ON FUNCTION warehouse_identity.recovery_consume_supplemental_proof_v15(uuid,uuid,uuid),
  warehouse_identity.iam_advance_session_epoch_v15(uuid,text,uuid,uuid,uuid),
  warehouse_identity.iam_session_epoch_status_v15(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION warehouse_identity.recovery_consume_supplemental_proof_v15(uuid,uuid,uuid),
  warehouse_identity.iam_advance_session_epoch_v15(uuid,text,uuid,uuid,uuid)
  TO tcds_login_api, tcds_login_orchestrator;
GRANT EXECUTE ON FUNCTION warehouse_identity.iam_session_epoch_status_v15(uuid) TO tcds_login_api;

-- The function owner gets exactly the table rights the three functions need (tables are owned by postgres).
GRANT SELECT, UPDATE ON warehouse_identity.recovery_proofs_v1 TO tcds_identity_function_owner;
GRANT SELECT, INSERT, UPDATE ON warehouse_identity.iam_session_epochs_v15 TO tcds_identity_function_owner;

DO $own$
DECLARE m record; had boolean; need_set boolean; had_create boolean;
BEGIN
 -- Row security is forced on both tables. Only if the function owner lacks BYPASSRLS, give it (and only it) a policy.
 IF NOT (SELECT rolbypassrls FROM pg_roles WHERE rolname = 'tcds_identity_function_owner') THEN
  EXECUTE 'CREATE POLICY r620_fn_owner_proofs ON warehouse_identity.recovery_proofs_v1 FOR ALL TO tcds_identity_function_owner USING (true) WITH CHECK (true)';
  EXECUTE 'CREATE POLICY r620_fn_owner_epochs ON warehouse_identity.iam_session_epochs_v15 FOR ALL TO tcds_identity_function_owner USING (true) WITH CHECK (true)';
 END IF;
 -- ALTER OWNER needs: postgres may SET ROLE to the new owner, and the new owner has CREATE on the schema.
 -- postgres can hold several memberships (one per grantor); only touch the one postgres itself granted, and only
 -- when no existing membership already allows SET.
 need_set := NOT pg_has_role('postgres', 'tcds_identity_function_owner', 'SET');
 SELECT inherit_option, set_option INTO m FROM pg_auth_members
  WHERE roleid = 'tcds_identity_function_owner'::regrole AND member = 'postgres'::regrole AND grantor = 'postgres'::regrole;
 had := FOUND;
 had_create := has_schema_privilege('tcds_identity_function_owner', 'warehouse_identity', 'CREATE');
 IF need_set THEN EXECUTE 'GRANT tcds_identity_function_owner TO postgres WITH SET TRUE'; END IF;
 IF NOT had_create THEN EXECUTE 'GRANT CREATE ON SCHEMA warehouse_identity TO tcds_identity_function_owner'; END IF;
 EXECUTE 'ALTER FUNCTION warehouse_identity.recovery_consume_supplemental_proof_v15(uuid,uuid,uuid) OWNER TO tcds_identity_function_owner';
 EXECUTE 'ALTER FUNCTION warehouse_identity.iam_advance_session_epoch_v15(uuid,text,uuid,uuid,uuid) OWNER TO tcds_identity_function_owner';
 EXECUTE 'ALTER FUNCTION warehouse_identity.iam_session_epoch_status_v15(uuid) OWNER TO tcds_identity_function_owner';
 IF NOT had_create THEN EXECUTE 'REVOKE CREATE ON SCHEMA warehouse_identity FROM tcds_identity_function_owner'; END IF;
 IF need_set AND had THEN
  EXECUTE format('GRANT tcds_identity_function_owner TO postgres WITH INHERIT %s, SET %s', m.inherit_option::text, m.set_option::text);
 ELSIF need_set THEN
  EXECUTE 'REVOKE tcds_identity_function_owner FROM postgres';
 END IF;
END $own$;

DO $verify$
DECLARE f regprocedure;
BEGIN
 FOREACH f IN ARRAY ARRAY['warehouse_identity.recovery_consume_supplemental_proof_v15(uuid,uuid,uuid)'::regprocedure,
   'warehouse_identity.iam_advance_session_epoch_v15(uuid,text,uuid,uuid,uuid)'::regprocedure,
   'warehouse_identity.iam_session_epoch_status_v15(uuid)'::regprocedure] LOOP
  IF (SELECT pg_get_userbyid(proowner) <> 'tcds_identity_function_owner' OR NOT prosecdef FROM pg_proc WHERE oid = f)
   THEN RAISE EXCEPTION 'R620_OWNER_OR_DEFINER_WRONG %', f; END IF;
  IF has_function_privilege('public', f, 'EXECUTE') OR has_function_privilege('anon', f, 'EXECUTE')
     OR has_function_privilege('authenticated', f, 'EXECUTE') OR has_function_privilege('service_role', f, 'EXECUTE')
   THEN RAISE EXCEPTION 'R620_EXECUTE_TOO_BROAD %', f; END IF;
  IF NOT has_function_privilege('tcds_login_api', f, 'EXECUTE') THEN RAISE EXCEPTION 'R620_LOGIN_API_CANNOT_EXECUTE %', f; END IF;
 END LOOP;
 IF has_table_privilege('tcds_login_api', 'warehouse_identity.recovery_proofs_v1', 'SELECT,INSERT,UPDATE,DELETE')
 OR has_table_privilege('tcds_login_api', 'warehouse_identity.iam_session_epochs_v15', 'SELECT,INSERT,UPDATE,DELETE')
  THEN RAISE EXCEPTION 'R620_LOGIN_API_HAS_TABLE_ACCESS'; END IF;
END $verify$;
COMMIT;
