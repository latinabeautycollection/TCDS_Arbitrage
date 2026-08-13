-- TCDS Phase 3 Domain 8
-- File: 803_domain8_security_and_rls.sql
--
-- This migration creates roles only when the executing principal has
-- CREATEROLE. Otherwise it still enables RLS and emits NOTICE messages so
-- platform administrators can bind existing enterprise roles later.

BEGIN;

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '15min';

DO $$
BEGIN
    IF current_setting('is_superuser')::boolean
       OR EXISTS (
            SELECT 1 FROM pg_roles
            WHERE rolname = current_user AND rolcreaterole
       )
    THEN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tcds_domain8_owner') THEN
            CREATE ROLE tcds_domain8_owner NOLOGIN;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tcds_domain8_runtime') THEN
            CREATE ROLE tcds_domain8_runtime NOLOGIN;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tcds_domain8_worker') THEN
            CREATE ROLE tcds_domain8_worker NOLOGIN;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tcds_domain8_reviewer') THEN
            CREATE ROLE tcds_domain8_reviewer NOLOGIN;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tcds_domain8_auditor') THEN
            CREATE ROLE tcds_domain8_auditor NOLOGIN;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tcds_domain8_admin') THEN
            CREATE ROLE tcds_domain8_admin NOLOGIN;
        END IF;
    ELSE
        RAISE NOTICE 'Role creation skipped: current principal lacks CREATEROLE.';
    END IF;
END
$$;

REVOKE ALL ON SCHEMA return_defense FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA return_defense FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA return_defense FROM PUBLIC;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA return_defense FROM PUBLIC;

CREATE OR REPLACE FUNCTION return_defense.current_tenant_id()
RETURNS uuid
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_value text;
BEGIN
    v_value := current_setting('app.tenant_id', true);
    IF v_value IS NULL OR btrim(v_value) = '' THEN
        RAISE EXCEPTION 'app.tenant_id is required'
            USING ERRCODE = '42501';
    END IF;
    RETURN v_value::uuid;
END;
$$;

CREATE OR REPLACE FUNCTION return_defense.current_actor_id()
RETURNS uuid
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_value text;
BEGIN
    v_value := current_setting('app.actor_id', true);
    IF v_value IS NULL OR btrim(v_value) = '' THEN
        RETURN NULL;
    END IF;
    RETURN v_value::uuid;
END;
$$;

CREATE OR REPLACE FUNCTION return_defense.current_correlation_id()
RETURNS uuid
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_value text;
BEGIN
    v_value := current_setting('app.correlation_id', true);
    IF v_value IS NULL OR btrim(v_value) = '' THEN
        RETURN gen_random_uuid();
    END IF;
    RETURN v_value::uuid;
END;
$$;

-- Tenant-scoped tables available in Slice 8A.
ALTER TABLE return_defense.policy_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE return_defense.policy_versions FORCE ROW LEVEL SECURITY;
ALTER TABLE return_defense.model_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE return_defense.model_versions FORCE ROW LEVEL SECURITY;
ALTER TABLE return_defense.risk_thresholds ENABLE ROW LEVEL SECURITY;
ALTER TABLE return_defense.risk_thresholds FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_policy_versions
ON return_defense.policy_versions;
CREATE POLICY tenant_isolation_policy_versions
ON return_defense.policy_versions
USING (tenant_id = return_defense.current_tenant_id())
WITH CHECK (tenant_id = return_defense.current_tenant_id());

DROP POLICY IF EXISTS tenant_isolation_model_versions
ON return_defense.model_versions;
CREATE POLICY tenant_isolation_model_versions
ON return_defense.model_versions
USING (tenant_id = return_defense.current_tenant_id())
WITH CHECK (tenant_id = return_defense.current_tenant_id());

DROP POLICY IF EXISTS tenant_isolation_risk_thresholds
ON return_defense.risk_thresholds;
CREATE POLICY tenant_isolation_risk_thresholds
ON return_defense.risk_thresholds
USING (tenant_id = return_defense.current_tenant_id())
WITH CHECK (tenant_id = return_defense.current_tenant_id());

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tcds_domain8_runtime') THEN
        GRANT USAGE ON SCHEMA return_defense TO tcds_domain8_runtime;
        GRANT SELECT ON return_defense.v_active_policies TO tcds_domain8_runtime;
        GRANT SELECT ON return_defense.v_active_models TO tcds_domain8_runtime;
        GRANT SELECT ON return_defense.status_catalog TO tcds_domain8_runtime;
        GRANT SELECT ON return_defense.reason_code_catalog TO tcds_domain8_runtime;
        GRANT SELECT ON return_defense.control_definitions TO tcds_domain8_runtime;
    END IF;

    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tcds_domain8_worker') THEN
        GRANT USAGE ON SCHEMA return_defense TO tcds_domain8_worker;
        GRANT SELECT ON return_defense.v_active_policies TO tcds_domain8_worker;
        GRANT SELECT ON return_defense.v_active_models TO tcds_domain8_worker;
        GRANT SELECT ON return_defense.status_catalog TO tcds_domain8_worker;
        GRANT SELECT ON return_defense.reason_code_catalog TO tcds_domain8_worker;
        GRANT SELECT ON return_defense.control_definitions TO tcds_domain8_worker;
    END IF;

    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tcds_domain8_reviewer') THEN
        GRANT USAGE ON SCHEMA return_defense TO tcds_domain8_reviewer;
        GRANT SELECT ON ALL TABLES IN SCHEMA return_defense TO tcds_domain8_reviewer;
    END IF;

    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tcds_domain8_auditor') THEN
        GRANT USAGE ON SCHEMA return_defense TO tcds_domain8_auditor;
        GRANT SELECT ON ALL TABLES IN SCHEMA return_defense TO tcds_domain8_auditor;
    END IF;

    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tcds_domain8_admin') THEN
        GRANT USAGE, CREATE ON SCHEMA return_defense TO tcds_domain8_admin;
        GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA return_defense
            TO tcds_domain8_admin;
        GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA return_defense
            TO tcds_domain8_admin;
        GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA return_defense
            TO tcds_domain8_admin;
    END IF;
END
$$;

COMMIT;
