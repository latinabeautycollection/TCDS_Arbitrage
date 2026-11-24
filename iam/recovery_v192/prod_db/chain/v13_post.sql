-- Our wrapper AFTER vendor 624 + 625. Restores the temporary schema CREATE and self-verifies; any failure aborts the
-- whole transaction (nothing is kept).
DO $restore$ BEGIN
  IF NOT (SELECT had_create FROM v13_pre_state) THEN
    EXECUTE 'REVOKE CREATE ON SCHEMA warehouse_identity FROM tcds_identity_function_owner';
  END IF;
END $restore$;

DO $verify$
DECLARE v_bad text;
BEGIN
  -- functions: owner, definer, pinned search_path
  SELECT string_agg(p.proname, ', ') INTO v_bad FROM pg_proc p
   WHERE p.pronamespace = 'warehouse_identity'::regnamespace
     AND p.proname IN ('eoc_create_binding_v13', 'eoc_bridge_retention_batch_v13')
     AND NOT (pg_get_userbyid(p.proowner) = 'tcds_identity_function_owner' AND p.prosecdef
              AND p.proconfig @> ARRAY['search_path=pg_catalog']);
  IF v_bad IS NOT NULL OR (SELECT count(*) FROM pg_proc WHERE pronamespace = 'warehouse_identity'::regnamespace
       AND proname IN ('eoc_create_binding_v13', 'eoc_bridge_retention_batch_v13')) <> 2 THEN
    RAISE EXCEPTION 'V13_POST_FUNCTION_SHAPE: %', coalesce(v_bad, 'missing');
  END IF;
  -- nobody public can execute
  SELECT string_agg(p.proname || '→' || r, ', ') INTO v_bad FROM pg_proc p
   CROSS JOIN unnest(ARRAY['anon', 'authenticated', 'service_role', 'tcds_login_api']) r
   WHERE p.pronamespace = 'warehouse_identity'::regnamespace AND p.proname LIKE 'eoc\_%\_v13'
     AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) AND has_function_privilege(r, p.oid, 'EXECUTE');
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'V13_POST_EXECUTE_TOO_BROAD: %', v_bad; END IF;
  SELECT string_agg(p.proname, ', ') INTO v_bad FROM pg_proc p
   WHERE p.pronamespace = 'warehouse_identity'::regnamespace AND p.proname LIKE 'eoc\_%\_v13'
     AND EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x WHERE x.grantee = 0);
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'V13_POST_PUBLIC_EXECUTE: %', v_bad; END IF;
  -- new tables: forced RLS, nothing for the API roles
  SELECT string_agg(c.relname, ', ') INTO v_bad FROM pg_class c
   WHERE c.relnamespace = 'warehouse_identity'::regnamespace AND c.relkind = 'r' AND c.relname LIKE 'eoc\_%\_v13'
     AND NOT (c.relrowsecurity AND c.relforcerowsecurity);
  IF v_bad IS NOT NULL OR (SELECT count(*) FROM pg_class WHERE relnamespace = 'warehouse_identity'::regnamespace
       AND relkind = 'r' AND relname LIKE 'eoc\_%\_v13') <> 5 THEN
    RAISE EXCEPTION 'V13_POST_TABLES: %', coalesce(v_bad, 'expected 5 tables');
  END IF;
  -- new roles exist and cannot log in
  IF (SELECT count(*) FROM pg_roles WHERE rolname IN ('tcds_eoc_attestation_writer', 'tcds_eoc_binding_admin',
        'tcds_eoc_audit_retention_worker', 'tcds_eoc_legal_hold_admin') AND NOT rolcanlogin) <> 4 THEN
    RAISE EXCEPTION 'V13_POST_ROLES';
  END IF;
  -- temporary schema CREATE and membership restored
  IF has_schema_privilege('tcds_identity_function_owner', 'warehouse_identity', 'CREATE') <> (SELECT had_create FROM v13_pre_state) THEN
    RAISE EXCEPTION 'V13_POST_SCHEMA_CREATE_NOT_RESTORED';
  END IF;
END $verify$;
