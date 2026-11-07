-- TCDS staging correction, runs AFTER Anthony's 064 -> 071 -> 072 in the same transaction.
SET LOCAL search_path = pg_catalog, pg_temp;

-- BFF /api/eoc/auth/ready runs "SELECT 1 FROM eoc_iam.sessions LIMIT 1", but 071 revokes all table access from
-- eoc_app_runtime, so ready can only ever answer 503. This definer probe replaces that query (one-line BFF change).
CREATE FUNCTION eoc_iam.db_ready_v12() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT count(*) >= 0 FROM (SELECT 1 FROM eoc_iam.sessions LIMIT 1) s
$$;
GRANT CREATE ON SCHEMA eoc_iam TO eoc_iam_executor;
ALTER FUNCTION eoc_iam.db_ready_v12() OWNER TO eoc_iam_executor;
REVOKE CREATE ON SCHEMA eoc_iam FROM eoc_iam_executor;
REVOKE ALL ON FUNCTION eoc_iam.db_ready_v12() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION eoc_iam.db_ready_v12() TO eoc_app_runtime;

-- Supabase API roles get nothing in eoc_iam (064 only revokes PUBLIC; default privileges may have granted more).
DO $lock$
DECLARE r text;
BEGIN
 EXECUTE 'REVOKE ALL ON ALL FUNCTIONS IN SCHEMA eoc_iam FROM PUBLIC';
 FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
   EXECUTE format('REVOKE ALL ON SCHEMA eoc_iam FROM %I', r);
   EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA eoc_iam FROM %I', r);
   EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA eoc_iam FROM %I', r);
   EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA eoc_iam FROM %I', r);
  END IF;
 END LOOP;
END $lock$;
COMMENT ON SCHEMA eoc_iam IS 'EOC 6.4 V1.2 application schema: Anthony 064/071/072 + TCDS staging corrections (eoc_v12_pre/post)';

-- Remove the temporary membership; postgres keeps only the ADMIN it got as creator (needed to drop the roles later).
REVOKE eoc_app_runtime, eoc_iam_executor, eoc_grant_admin_runtime, eoc_grant_fn_owner, eoc_iam_verified_attestation_writer FROM postgres;

DO $verify$
DECLARE
 roles text[] := ARRAY['eoc_app_runtime','eoc_iam_executor','eoc_grant_admin_runtime','eoc_grant_fn_owner','eoc_iam_verified_attestation_writer'];
 n int; got text;
BEGIN
 SELECT count(*) INTO n FROM pg_class WHERE relnamespace = 'eoc_iam'::regnamespace AND relkind = 'r' AND relrowsecurity AND relforcerowsecurity;
 IF n <> 6 OR (SELECT count(*) FROM pg_class WHERE relnamespace = 'eoc_iam'::regnamespace AND relkind = 'r') <> 6
 THEN RAISE EXCEPTION 'EOCDB_VERIFY_FORCED_RLS %', n; END IF;

 -- Nobody outside the five EOC roles (and the owner postgres) holds anything in eoc_iam.
 SELECT string_agg(DISTINCT g, ',') INTO got FROM (
   SELECT CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END g
     FROM pg_class c, aclexplode(c.relacl) a WHERE c.relnamespace = 'eoc_iam'::regnamespace
   UNION ALL SELECT CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END
     FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a WHERE p.pronamespace = 'eoc_iam'::regnamespace
   UNION ALL SELECT CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END
     FROM pg_namespace s, aclexplode(s.nspacl) a WHERE s.nspname = 'eoc_iam') x
  WHERE g <> 'postgres' AND g <> ALL (roles);
 IF got IS NOT NULL THEN RAISE EXCEPTION 'EOCDB_VERIFY_UNEXPECTED_GRANTEES %', got; END IF;

 -- Runtime, grant-admin and attestation-writer roles: no direct table access except the writer's INSERT.
 SELECT string_agg(r || ':' || c.relname, ',') INTO got
   FROM unnest(ARRAY['eoc_app_runtime','eoc_grant_admin_runtime','eoc_iam_verified_attestation_writer']) r, pg_class c
  WHERE c.relnamespace = 'eoc_iam'::regnamespace AND c.relkind = 'r'
    AND (has_table_privilege(r, c.oid, 'SELECT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
         OR (has_table_privilege(r, c.oid, 'INSERT')
             AND NOT (r = 'eoc_iam_verified_attestation_writer' AND c.relname = 'grant_verified_attestations_v12')));
 IF got IS NOT NULL THEN RAISE EXCEPTION 'EOCDB_VERIFY_DIRECT_TABLE_ACCESS %', got; END IF;
 IF NOT has_table_privilege('eoc_iam_verified_attestation_writer', 'eoc_iam.grant_verified_attestations_v12', 'INSERT')
 THEN RAISE EXCEPTION 'EOCDB_VERIFY_WRITER_INSERT'; END IF;

 SELECT string_agg(proname, ',' ORDER BY proname) INTO got FROM pg_proc
  WHERE pronamespace = 'eoc_iam'::regnamespace AND has_function_privilege('eoc_app_runtime', oid, 'EXECUTE');
 IF got IS DISTINCT FROM 'audit_event_v12,consume_flow_v12,create_flow_v12,create_session_and_audit_v12,db_ready_v12,grants_for_subject_v12,revoke_session_v12,session_by_hash_v12,touch_session_v12'
 THEN RAISE EXCEPTION 'EOCDB_VERIFY_APP_EXECUTE %', got; END IF;
 SELECT string_agg(proname, ',' ORDER BY proname) INTO got FROM pg_proc
  WHERE pronamespace = 'eoc_iam'::regnamespace AND has_function_privilege('eoc_grant_admin_runtime', oid, 'EXECUTE');
 IF got IS DISTINCT FROM 'create_governed_grant_v12' THEN RAISE EXCEPTION 'EOCDB_VERIFY_ADMIN_EXECUTE %', got; END IF;
 IF EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'eoc_iam'::regnamespace
            AND has_function_privilege('eoc_iam_verified_attestation_writer', oid, 'EXECUTE'))
 THEN RAISE EXCEPTION 'EOCDB_VERIFY_WRITER_EXECUTE'; END IF;

 -- Owners: 10 definer functions, pinned search_path.
 SELECT string_agg(proname || '=' || pg_get_userbyid(proowner), ',') INTO got FROM pg_proc
  WHERE pronamespace = 'eoc_iam'::regnamespace
    AND (NOT prosecdef OR proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']
         OR pg_get_userbyid(proowner) <> CASE WHEN proname = 'create_governed_grant_v12' THEN 'eoc_grant_fn_owner' ELSE 'eoc_iam_executor' END);
 IF got IS NOT NULL OR (SELECT count(*) FROM pg_proc WHERE pronamespace = 'eoc_iam'::regnamespace) <> 10
 THEN RAISE EXCEPTION 'EOCDB_VERIFY_FUNCTION_OWNERS %', got; END IF;

 -- The EOC roles reach nothing outside eoc_iam, belong to no role, cannot log in, and keep no CREATE.
 IF EXISTS (SELECT 1 FROM pg_class c, aclexplode(c.relacl) a WHERE c.relnamespace <> 'eoc_iam'::regnamespace AND pg_get_userbyid(a.grantee) = ANY (roles))
 OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a WHERE p.pronamespace <> 'eoc_iam'::regnamespace AND pg_get_userbyid(a.grantee) = ANY (roles))
 OR EXISTS (SELECT 1 FROM pg_namespace s, aclexplode(s.nspacl) a WHERE s.nspname <> 'eoc_iam' AND pg_get_userbyid(a.grantee) = ANY (roles))
 OR EXISTS (SELECT 1 FROM pg_auth_members WHERE pg_get_userbyid(member) = ANY (roles))
 OR EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ANY (roles) AND (rolcanlogin OR rolbypassrls OR rolcreaterole OR rolcreatedb))
 OR EXISTS (SELECT 1 FROM unnest(roles) r WHERE has_schema_privilege(r, 'eoc_iam', 'CREATE'))
 THEN RAISE EXCEPTION 'EOCDB_VERIFY_ROLE_ISOLATION'; END IF;

 IF EXISTS (SELECT 1 FROM unnest(roles) r WHERE pg_has_role('postgres', r, 'USAGE') OR pg_has_role('postgres', r, 'SET'))
 THEN RAISE EXCEPTION 'EOCDB_VERIFY_POSTGRES_MEMBERSHIP_LEFT'; END IF;
END $verify$;
