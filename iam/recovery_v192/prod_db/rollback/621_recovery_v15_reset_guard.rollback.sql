-- Rollback of 621. Run BEFORE 620's rollback.
BEGIN;
SET LOCAL search_path = pg_catalog, pg_temp;
SET LOCAL lock_timeout = '5s';
DO $rb$
DECLARE m record; had boolean; need_inherit boolean;
BEGIN
 IF to_regprocedure('warehouse_identity.recovery_reset_guard_v15(uuid,uuid)') IS NULL THEN RAISE EXCEPTION 'R621_NOT_INSTALLED'; END IF;
 -- DROP needs the owner's privileges (USAGE/inherit); grant temporarily on the grantor=postgres row only if needed.
 need_inherit := NOT pg_has_role('postgres', 'tcds_identity_function_owner', 'USAGE');
 SELECT inherit_option, set_option INTO m FROM pg_auth_members
  WHERE roleid = 'tcds_identity_function_owner'::regrole AND member = 'postgres'::regrole AND grantor = 'postgres'::regrole;
 had := FOUND;
 IF need_inherit THEN EXECUTE 'GRANT tcds_identity_function_owner TO postgres WITH INHERIT TRUE'; END IF;
 EXECUTE 'DROP FUNCTION warehouse_identity.recovery_reset_guard_v15(uuid,uuid)';
 IF need_inherit AND had THEN
  EXECUTE format('GRANT tcds_identity_function_owner TO postgres WITH INHERIT %s, SET %s', m.inherit_option::text, m.set_option::text);
 ELSIF need_inherit THEN
  EXECUTE 'REVOKE tcds_identity_function_owner FROM postgres';
 END IF;
 EXECUTE 'DROP POLICY IF EXISTS r621_fn_owner_contacts ON warehouse_identity.user_recovery_contacts';
 EXECUTE 'REVOKE SELECT ON warehouse_identity.user_recovery_contacts FROM tcds_identity_function_owner';
END $rb$;
COMMIT;
