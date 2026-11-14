-- Our wrapper BEFORE vendor 624 + 625 (central IAM staging, Supabase PG17). Runs inside the caller's transaction.
-- 1. Preflight: 623 present; the function owner does NOT already hold any privilege 624/625 grant it (so our rollback
--    can revoke exactly those and nothing that existed before).
-- 2. The fix: vendor 624/625 copy 623's temporary role membership but not its temporary
--    GRANT CREATE ON SCHEMA warehouse_identity TO tcds_identity_function_owner, without which
--    ALTER FUNCTION ... OWNER TO tcds_identity_function_owner is refused on Supabase. Granted here, restored in v13_post.sql.
DO $pre$
DECLARE v_bad text;
BEGIN
  IF to_regprocedure('warehouse_identity.eoc_resolve_federation_v623(text,text,uuid)') IS NULL THEN
    RAISE EXCEPTION 'V13_PRE_623_MISSING';
  END IF;
  IF to_regclass('warehouse_identity.webauthn_verification_evidence') IS NULL THEN
    RAISE EXCEPTION 'V13_PRE_WEBAUTHN_EVIDENCE_TABLE_MISSING';
  END IF;
  -- column-level grants 624 adds
  SELECT string_agg(c.relname || '.' || a.attname, ', ') INTO v_bad
    FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
    CROSS JOIN LATERAL aclexplode(a.attacl) x
   WHERE c.relnamespace = 'warehouse_identity'::regnamespace AND a.attacl IS NOT NULL
     AND x.grantee = 'tcds_identity_function_owner'::regrole
     AND c.relname IN ('users', 'auth_sessions', 'webauthn_verification_evidence', 'user_role_assignments', 'roles');
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'V13_PRE_FN_OWNER_ALREADY_HAS_COLUMN_GRANTS: %', v_bad; END IF;
  -- table-level grants 624/625 add on 623 tables
  IF has_table_privilege('tcds_identity_function_owner', 'warehouse_identity.eoc_federated_subject_bindings_v12', 'INSERT')
     OR has_table_privilege('tcds_identity_function_owner', 'warehouse_identity.eoc_federated_subject_bindings_v12', 'UPDATE')
     OR has_table_privilege('tcds_identity_function_owner', 'warehouse_identity.eoc_bridge_audit_v12', 'SELECT')
     OR has_table_privilege('tcds_identity_function_owner', 'warehouse_identity.eoc_bridge_audit_v12', 'DELETE')
     OR has_table_privilege('tcds_identity_function_owner', 'warehouse_identity.eoc_bridge_audit_v12', 'UPDATE') THEN
    RAISE EXCEPTION 'V13_PRE_FN_OWNER_ALREADY_HAS_623_TABLE_GRANTS';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE policyname ~ '^eoc62[45]_') THEN
    RAISE EXCEPTION 'V13_PRE_POLICIES_ALREADY_PRESENT';
  END IF;
END $pre$;

CREATE TEMP TABLE v13_pre_state ON COMMIT DROP AS
SELECT has_schema_privilege('tcds_identity_function_owner', 'warehouse_identity', 'CREATE') AS had_create;
DO $grant$ BEGIN
  IF NOT (SELECT had_create FROM v13_pre_state) THEN
    EXECUTE 'GRANT CREATE ON SCHEMA warehouse_identity TO tcds_identity_function_owner';
  END IF;
END $grant$;
