-- 626 rollback: removes the central passkey functions, tables and roles. Central challenge and evidence rows in the
-- shared warehouse_identity.auth_challenges / webauthn_verification_evidence are KEPT (audit; they reference nothing
-- this rollback removes). Warehouse tables, functions and grants are not touched.
BEGIN;
SET LOCAL search_path = pg_catalog, pg_temp;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
CREATE TEMP TABLE r626_rb ON COMMIT DROP AS
SELECT NOT pg_has_role(current_user, 'tcds_identity_function_owner', 'USAGE') OR NOT pg_has_role(current_user, 'tcds_identity_function_owner', 'SET') AS need,
       (SELECT inherit_option FROM pg_auth_members WHERE roleid = 'tcds_identity_function_owner'::regrole AND member = current_user::regrole AND grantor = current_user::regrole) AS m_inherit,
       (SELECT set_option FROM pg_auth_members WHERE roleid = 'tcds_identity_function_owner'::regrole AND member = current_user::regrole AND grantor = current_user::regrole) AS m_set,
       EXISTS (SELECT 1 FROM pg_auth_members WHERE roleid = 'tcds_identity_function_owner'::regrole AND member = current_user::regrole AND grantor = current_user::regrole) AS had;
DO $up$ BEGIN
 IF (SELECT need FROM r626_rb) THEN EXECUTE format('GRANT tcds_identity_function_owner TO %I WITH INHERIT TRUE, SET TRUE', current_user); END IF;
END $up$;
DROP FUNCTION IF EXISTS
  warehouse_identity.central_finalize_login_v1(uuid,bytea,bigint,uuid,bigint,bigint,bigint,text,text,boolean,text,text,text,boolean,boolean,text,text,text,uuid,uuid),
  warehouse_identity.central_finalize_enrollment_v1(uuid,bytea,bigint,text,bytea,integer,text[],uuid,text,boolean,boolean,text,text,text,boolean,text,text,text,text,text,text,uuid,uuid),
  warehouse_identity.central_passkey_material_v1(text,text),
  warehouse_identity.central_fail_challenge_v1(uuid,bytea,text),
  warehouse_identity.central_held_claim_v1(uuid,bytea,bigint,text),
  warehouse_identity.central_claim_challenge_v1(uuid,bytea,bytea,text,text,text,text,uuid),
  warehouse_identity.central_claim_workload_nonce_v1(bytea,uuid,uuid,timestamptz),
  warehouse_identity.central_login_begin_v1(text,text,uuid,text,text,bytea,uuid,uuid,integer),
  warehouse_identity.central_enrollment_begin_v1(bytea,text,text,bytea,uuid,uuid),
  warehouse_identity.central_revoke_passkey_v1(uuid,uuid,text),
  warehouse_identity.central_issue_invite_v1(uuid,uuid,bytea,text,integer,text,uuid),
  warehouse_identity.central_user_active_v1(uuid);
DROP TABLE IF EXISTS warehouse_identity.central_challenge_context;
DROP TABLE IF EXISTS warehouse_identity.central_workload_nonces;
DROP TABLE IF EXISTS warehouse_identity.central_passkeys;
DROP TABLE IF EXISTS warehouse_identity.central_enrollment_invites;
DO $roles$ BEGIN
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tcds_identity_central_verifier') THEN
  EXECUTE 'REVOKE ALL ON SCHEMA warehouse_identity FROM tcds_identity_central_verifier';
  EXECUTE 'DROP ROLE tcds_identity_central_verifier';
 END IF;
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tcds_identity_central_admin') THEN
  EXECUTE 'REVOKE ALL ON SCHEMA warehouse_identity FROM tcds_identity_central_admin';
  EXECUTE 'DROP ROLE tcds_identity_central_admin';
 END IF;
END $roles$;
DO $down$ BEGIN
 IF (SELECT need FROM r626_rb) THEN
  IF (SELECT had FROM r626_rb) THEN
   EXECUTE format('GRANT tcds_identity_function_owner TO %I WITH INHERIT %s, SET %s', current_user,
                  (SELECT m_inherit FROM r626_rb)::text, (SELECT m_set FROM r626_rb)::text);
  ELSE EXECUTE format('REVOKE tcds_identity_function_owner FROM %I', current_user); END IF;
 END IF;
END $down$;
DO $verify$ BEGIN
 IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'warehouse_identity' AND p.proname LIKE 'central\_%')
 OR to_regclass('warehouse_identity.central_passkeys') IS NOT NULL
 OR EXISTS (SELECT 1 FROM pg_roles WHERE rolname IN ('tcds_identity_central_verifier', 'tcds_identity_central_admin'))
 THEN RAISE EXCEPTION 'R626_ROLLBACK_INCOMPLETE'; END IF;
END $verify$;
COMMIT;
