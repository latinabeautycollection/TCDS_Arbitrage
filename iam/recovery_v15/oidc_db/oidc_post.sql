-- Our step AFTER vendor 001 -> 002 -> 003, inside the caller's transaction, connected to database eoc_oidc.
-- Database-level access (the vendor SQL does not cover it): only the issuer runtime role may connect. Then self-verify;
-- any failure aborts the whole transaction.
DO $db$ BEGIN
  IF current_database() <> 'eoc_oidc' THEN RAISE EXCEPTION 'OIDC_POST_WRONG_DATABASE: %', current_database(); END IF;
  EXECUTE 'REVOKE CONNECT, TEMPORARY ON DATABASE eoc_oidc FROM PUBLIC';
  EXECUTE 'GRANT CONNECT ON DATABASE eoc_oidc TO eoc_oidc_runtime';
END $db$;

DO $verify$
DECLARE v_bad text;
BEGIN
  IF (SELECT count(*) FROM pg_class WHERE relnamespace = 'eoc_oidc'::regnamespace AND relkind = 'r'
        AND relrowsecurity AND relforcerowsecurity) <> 5 THEN
    RAISE EXCEPTION 'OIDC_POST_EXPECTED_5_FORCED_RLS_TABLES';
  END IF;
  SELECT string_agg(c.relname || '→' || r, ', ') INTO v_bad FROM pg_class c
   CROSS JOIN unnest(ARRAY['anon', 'authenticated', 'service_role']) r
   WHERE c.relnamespace = 'eoc_oidc'::regnamespace AND c.relkind = 'r' AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r)
     AND (has_table_privilege(r, c.oid, 'SELECT') OR has_table_privilege(r, c.oid, 'INSERT')
          OR has_table_privilege(r, c.oid, 'UPDATE') OR has_table_privilege(r, c.oid, 'DELETE'));
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'OIDC_POST_API_ROLE_TABLE_ACCESS: %', v_bad; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'eoc_oidc_runtime'
             AND (rolcanlogin OR rolbypassrls OR rolsuper OR rolcreaterole OR rolcreatedb)) THEN
    RAISE EXCEPTION 'OIDC_POST_RUNTIME_ROLE_TOO_STRONG';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_database d, aclexplode(coalesce(d.datacl, acldefault('d', d.datdba))) x
             WHERE d.datname = 'eoc_oidc' AND x.grantee = 0) THEN
    RAISE EXCEPTION 'OIDC_POST_PUBLIC_STILL_HAS_DATABASE_ACCESS';
  END IF;
END $verify$;
