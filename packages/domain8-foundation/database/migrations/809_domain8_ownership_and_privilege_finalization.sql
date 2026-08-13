-- TCDS Phase 3 Domain 8
-- File: 809_domain8_ownership_and_privilege_finalization.sql
-- Version: 8A1.1.1
--
-- Purpose:
--   Finalize PUBLIC privilege lockdown and, only when PostgreSQL permits the
--   deployment principal to become the target owner role, transfer ownership
--   to tcds_domain8_owner.
--
-- Important:
--   PostgreSQL requires the current principal to be a superuser or a member of
--   the target owner role before ALTER ... OWNER TO can succeed. Managed
--   platforms frequently prohibit that membership. Ownership transfer is
--   therefore capability-aware and non-fatal; privilege hardening remains
--   mandatory and always executes.

BEGIN;

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '15min';

REVOKE ALL ON SCHEMA return_defense FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA return_defense FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA return_defense FROM PUBLIC;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA return_defense FROM PUBLIC;

-- These defaults apply to objects subsequently created by the migration role.
ALTER DEFAULT PRIVILEGES IN SCHEMA return_defense
    REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA return_defense
    REVOKE ALL ON SEQUENCES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA return_defense
    REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

DO $domain8_ownership$
DECLARE
    r record;
    v_owner_exists boolean;
    v_can_assume_owner boolean;
    v_schema_transferred boolean := false;
    v_transferred_count integer := 0;
    v_skipped_count integer := 0;
BEGIN
    SELECT EXISTS (
        SELECT 1 FROM pg_roles WHERE rolname = 'tcds_domain8_owner'
    ) INTO v_owner_exists;

    IF NOT v_owner_exists THEN
        RAISE NOTICE 'tcds_domain8_owner does not exist. Ownership transfer is pending platform administration; PUBLIC privilege lockdown completed.';
        RETURN;
    END IF;

    -- pg_has_role(..., 'MEMBER') is the relevant prerequisite for SET ROLE and
    -- ALTER OWNER. Superusers are also eligible.
    SELECT
        current_setting('is_superuser')::boolean
        OR pg_has_role(current_user, 'tcds_domain8_owner', 'MEMBER')
    INTO v_can_assume_owner;

    IF NOT v_can_assume_owner THEN
        RAISE NOTICE 'Deployment principal % cannot SET ROLE tcds_domain8_owner. Ownership transfer skipped safely; grant membership temporarily or run the provided admin finalization block later.', current_user;
        RETURN;
    END IF;

    BEGIN
        ALTER SCHEMA return_defense OWNER TO tcds_domain8_owner;
        v_schema_transferred := true;
    EXCEPTION
        WHEN insufficient_privilege THEN
            RAISE NOTICE 'Schema ownership transfer skipped: insufficient privilege for current principal %.', current_user;
        WHEN object_not_in_prerequisite_state THEN
            RAISE NOTICE 'Schema ownership transfer skipped: object is not in a transferable state.';
    END;

    FOR r IN
        SELECT c.relkind, n.nspname, c.relname
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'return_defense'
          AND c.relkind IN ('r', 'p', 'v', 'm', 'S')
        ORDER BY c.relkind, c.relname
    LOOP
        BEGIN
            EXECUTE format(
                'ALTER %s %I.%I OWNER TO tcds_domain8_owner',
                CASE r.relkind
                    WHEN 'S' THEN 'SEQUENCE'
                    WHEN 'v' THEN 'VIEW'
                    WHEN 'm' THEN 'MATERIALIZED VIEW'
                    ELSE 'TABLE'
                END,
                r.nspname,
                r.relname
            );
            v_transferred_count := v_transferred_count + 1;
        EXCEPTION
            WHEN insufficient_privilege OR wrong_object_type OR object_not_in_prerequisite_state THEN
                v_skipped_count := v_skipped_count + 1;
                RAISE NOTICE 'Ownership transfer skipped for %.%', r.nspname, r.relname;
        END;
    END LOOP;

    -- Functions, aggregates and window functions use ALTER FUNCTION.
    FOR r IN
        SELECT p.oid::regprocedure AS signature
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'return_defense'
          AND p.prokind IN ('f', 'a', 'w')
        ORDER BY p.oid::regprocedure::text
    LOOP
        BEGIN
            EXECUTE format(
                'ALTER FUNCTION %s OWNER TO tcds_domain8_owner',
                r.signature
            );
            v_transferred_count := v_transferred_count + 1;
        EXCEPTION
            WHEN insufficient_privilege OR wrong_object_type OR object_not_in_prerequisite_state THEN
                v_skipped_count := v_skipped_count + 1;
                RAISE NOTICE 'Function ownership transfer skipped for %', r.signature;
        END;
    END LOOP;

    -- Procedures require ALTER PROCEDURE rather than ALTER FUNCTION.
    FOR r IN
        SELECT p.oid::regprocedure AS signature
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'return_defense'
          AND p.prokind = 'p'
        ORDER BY p.oid::regprocedure::text
    LOOP
        BEGIN
            EXECUTE format(
                'ALTER PROCEDURE %s OWNER TO tcds_domain8_owner',
                r.signature
            );
            v_transferred_count := v_transferred_count + 1;
        EXCEPTION
            WHEN insufficient_privilege OR wrong_object_type OR object_not_in_prerequisite_state THEN
                v_skipped_count := v_skipped_count + 1;
                RAISE NOTICE 'Procedure ownership transfer skipped for %', r.signature;
        END;
    END LOOP;

    RAISE NOTICE 'Domain 8 ownership finalization complete. schema_transferred=%, objects_transferred=%, objects_skipped=%',
        v_schema_transferred, v_transferred_count, v_skipped_count;
END
$domain8_ownership$;

-- Reassert lockdown after any ownership changes.
REVOKE ALL ON SCHEMA return_defense FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA return_defense FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA return_defense FROM PUBLIC;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA return_defense FROM PUBLIC;

COMMIT;
