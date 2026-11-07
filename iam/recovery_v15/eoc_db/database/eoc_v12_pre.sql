-- TCDS staging correction, runs BEFORE Anthony's 064 -> 071 -> 072 (unchanged) in the same transaction.
-- Supabase PG17: postgres is not a superuser and createrole_self_grant is empty, so a role postgres creates gives it
-- ADMIN only. 071/072 then fail at ALTER FUNCTION ... OWNER TO <new role> (needs SET), and their GRANT/REVOKE on those
-- functions would act without owner rights. Fix: create the five roles first (064/071/072 skip existing roles) and give
-- postgres temporary INHERIT+SET membership; eoc_v12_post.sql removes it again.
SET LOCAL search_path = pg_catalog, pg_temp;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
DO $pre$
BEGIN
 IF current_user <> 'postgres' THEN RAISE EXCEPTION 'EOCDB_RUN_AS_POSTGRES'; END IF;
 IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'eoc_iam') THEN RAISE EXCEPTION 'EOCDB_SCHEMA_EXISTS_RECONCILE'; END IF;
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname IN ('eoc_app_runtime','eoc_iam_executor','eoc_grant_admin_runtime',
            'eoc_grant_fn_owner','eoc_iam_verified_attestation_writer','eoc_iam_bff_stg'))
 THEN RAISE EXCEPTION 'EOCDB_ROLES_EXIST_RECONCILE'; END IF;
END $pre$;
CREATE ROLE eoc_app_runtime NOLOGIN;
CREATE ROLE eoc_iam_executor NOLOGIN;
CREATE ROLE eoc_grant_admin_runtime NOLOGIN;
CREATE ROLE eoc_grant_fn_owner NOLOGIN;
CREATE ROLE eoc_iam_verified_attestation_writer NOLOGIN;
GRANT eoc_app_runtime, eoc_iam_executor, eoc_grant_admin_runtime, eoc_grant_fn_owner, eoc_iam_verified_attestation_writer
  TO postgres WITH INHERIT TRUE, SET TRUE;
