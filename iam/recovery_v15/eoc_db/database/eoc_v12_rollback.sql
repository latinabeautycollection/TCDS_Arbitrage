-- STAGING ONLY. Removes everything eoc_v12_pre + 064/071/072 + eoc_v12_post (and the staging login) created.
-- Replaces Anthony's 073: on Supabase PG17 postgres cannot DROP OWNED BY a role it only holds ADMIN on.
-- Refuses while any EOC row exists (sessions, flows, grants, attestations, approvals or audit).
BEGIN;
SET LOCAL search_path = pg_catalog, pg_temp;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
DO $preflight$
DECLARE t text; has_rows boolean;
BEGIN
 IF to_regnamespace('eoc_iam') IS NULL THEN RAISE EXCEPTION 'EOCDB_NOT_INSTALLED'; END IF;
 FOREACH t IN ARRAY ARRAY['login_flows','sessions','module_grants','audit_events','grant_verified_attestations_v12','grant_approval_consumptions_v12'] LOOP
  IF to_regclass('eoc_iam.' || t) IS NOT NULL THEN
   EXECUTE format('SELECT EXISTS (SELECT 1 FROM eoc_iam.%I)', t) INTO has_rows;
   IF has_rows THEN RAISE EXCEPTION 'EOCDB_DATA_PRESENT_REFUSE_ROLLBACK (%)', t; END IF;
  END IF;
 END LOOP;
END $preflight$;
DROP ROLE IF EXISTS eoc_iam_bff_stg;
GRANT eoc_app_runtime, eoc_iam_executor, eoc_grant_admin_runtime, eoc_grant_fn_owner, eoc_iam_verified_attestation_writer
  TO postgres WITH INHERIT TRUE, SET TRUE;
DROP SCHEMA eoc_iam CASCADE;
DROP OWNED BY eoc_app_runtime, eoc_iam_executor, eoc_grant_admin_runtime, eoc_grant_fn_owner, eoc_iam_verified_attestation_writer;
DROP ROLE eoc_app_runtime, eoc_iam_executor, eoc_grant_admin_runtime, eoc_grant_fn_owner, eoc_iam_verified_attestation_writer;
DO $verify$ BEGIN
 IF to_regnamespace('eoc_iam') IS NOT NULL
 OR EXISTS (SELECT 1 FROM pg_roles WHERE rolname IN ('eoc_app_runtime','eoc_iam_executor','eoc_grant_admin_runtime',
            'eoc_grant_fn_owner','eoc_iam_verified_attestation_writer','eoc_iam_bff_stg'))
 THEN RAISE EXCEPTION 'EOCDB_ROLLBACK_INCOMPLETE'; END IF;
END $verify$;
COMMIT;
