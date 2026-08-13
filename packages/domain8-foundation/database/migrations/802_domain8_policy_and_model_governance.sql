-- TCDS Phase 3 Domain 8
-- File: 802_domain8_policy_and_model_governance.sql

BEGIN;

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '15min';

-- Policy activation is serialized by tenant/key/scope advisory locks.
CREATE OR REPLACE FUNCTION return_defense.activate_policy_version(
    p_policy_version_id uuid,
    p_actor_id uuid,
    p_effective_at timestamptz DEFAULT clock_timestamp()
)
RETURNS return_defense.policy_versions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, return_defense
AS $$
DECLARE
    v_row return_defense.policy_versions;
    v_lock_key bigint;
BEGIN
    SELECT *
    INTO v_row
    FROM return_defense.policy_versions
    WHERE policy_version_id = p_policy_version_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Unknown policy_version_id %', p_policy_version_id
            USING ERRCODE = 'P0002';
    END IF;

    IF v_row.status NOT IN ('DRAFT', 'APPROVED') THEN
        RAISE EXCEPTION 'Policy % cannot be activated from status %',
            p_policy_version_id, v_row.status
            USING ERRCODE = '55000';
    END IF;

    v_lock_key := hashtextextended(
        concat_ws('|',
            v_row.tenant_id::text,
            v_row.policy_key,
            v_row.scope_type,
            v_row.scope_key
        ),
        8
    );
    PERFORM pg_advisory_xact_lock(v_lock_key);

    UPDATE return_defense.policy_versions
    SET status = 'RETIRED',
        expires_at = COALESCE(expires_at, p_effective_at),
        updated_at = clock_timestamp()
    WHERE tenant_id = v_row.tenant_id
      AND policy_key = v_row.policy_key
      AND scope_type = v_row.scope_type
      AND scope_key = v_row.scope_key
      AND status = 'ACTIVE'
      AND policy_version_id <> p_policy_version_id;

    UPDATE return_defense.policy_versions
    SET status = 'ACTIVE',
        approved_by = COALESCE(approved_by, p_actor_id),
        approved_at = COALESCE(approved_at, clock_timestamp()),
        effective_at = p_effective_at,
        expires_at = NULL,
        updated_at = clock_timestamp()
    WHERE policy_version_id = p_policy_version_id
    RETURNING * INTO v_row;

    RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION return_defense.activate_policy_version(uuid, uuid, timestamptz)
FROM PUBLIC;

CREATE OR REPLACE FUNCTION return_defense.activate_model_version(
    p_model_version_id uuid,
    p_actor_id uuid
)
RETURNS return_defense.model_versions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, return_defense
AS $$
DECLARE
    v_row return_defense.model_versions;
    v_lock_key bigint;
BEGIN
    SELECT *
    INTO v_row
    FROM return_defense.model_versions
    WHERE model_version_id = p_model_version_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Unknown model_version_id %', p_model_version_id
            USING ERRCODE = 'P0002';
    END IF;

    IF v_row.status NOT IN ('VALIDATED', 'SHADOW') THEN
        RAISE EXCEPTION 'Model % cannot be activated from status %',
            p_model_version_id, v_row.status
            USING ERRCODE = '55000';
    END IF;

    v_lock_key := hashtextextended(
        concat_ws('|', v_row.tenant_id::text, v_row.model_key),
        8
    );
    PERFORM pg_advisory_xact_lock(v_lock_key);

    UPDATE return_defense.model_versions
    SET status = 'RETIRED',
        retired_at = COALESCE(retired_at, clock_timestamp()),
        updated_at = clock_timestamp()
    WHERE tenant_id = v_row.tenant_id
      AND model_key = v_row.model_key
      AND status = 'ACTIVE'
      AND model_version_id <> p_model_version_id;

    UPDATE return_defense.model_versions
    SET status = 'ACTIVE',
        approved_by = COALESCE(approved_by, p_actor_id),
        approved_at = COALESCE(approved_at, clock_timestamp()),
        activated_at = clock_timestamp(),
        retired_at = NULL,
        updated_at = clock_timestamp()
    WHERE model_version_id = p_model_version_id
    RETURNING * INTO v_row;

    RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION return_defense.activate_model_version(uuid, uuid)
FROM PUBLIC;

CREATE OR REPLACE FUNCTION return_defense.rollback_model_version(
    p_active_model_version_id uuid,
    p_actor_id uuid
)
RETURNS return_defense.model_versions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, return_defense
AS $$
DECLARE
    v_active return_defense.model_versions;
BEGIN
    SELECT *
    INTO v_active
    FROM return_defense.model_versions
    WHERE model_version_id = p_active_model_version_id
    FOR UPDATE;

    IF NOT FOUND OR v_active.status <> 'ACTIVE' THEN
        RAISE EXCEPTION 'Model % is not active', p_active_model_version_id
            USING ERRCODE = '55000';
    END IF;

    IF v_active.rollback_model_version_id IS NULL THEN
        RAISE EXCEPTION 'Model % has no approved rollback version',
            p_active_model_version_id
            USING ERRCODE = '55000';
    END IF;

    RETURN return_defense.activate_model_version(
        v_active.rollback_model_version_id,
        p_actor_id
    );
END;
$$;

REVOKE ALL ON FUNCTION return_defense.rollback_model_version(uuid, uuid)
FROM PUBLIC;

-- Active policy and model views keep runtime consumers away from draft records.
CREATE OR REPLACE VIEW return_defense.v_active_policies AS
SELECT
    policy_version_id,
    tenant_id,
    policy_key,
    version,
    scope_type,
    scope_key,
    policy_document,
    policy_hash,
    effective_at,
    expires_at
FROM return_defense.policy_versions
WHERE status = 'ACTIVE'
  AND effective_at <= clock_timestamp()
  AND (expires_at IS NULL OR expires_at > clock_timestamp());

CREATE OR REPLACE VIEW return_defense.v_active_models AS
SELECT
    model_version_id,
    tenant_id,
    model_key,
    version,
    model_type,
    feature_schema_version,
    artifact_uri,
    artifact_sha256,
    model_card,
    validation_metrics,
    segment_metrics,
    drift_thresholds,
    activated_at
FROM return_defense.model_versions
WHERE status = 'ACTIVE';

COMMIT;
