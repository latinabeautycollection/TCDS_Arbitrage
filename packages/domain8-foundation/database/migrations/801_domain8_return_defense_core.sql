-- TCDS Phase 3 Domain 8
-- Slice 8A.1: Authoritative Return & Dispute Defense Database Contract
-- File: 801_domain8_return_defense_core.sql
-- PostgreSQL 15+
--
-- Design rules:
--   1. Domain 8 owns judgment, prevention, exposure, cases, recovery, and learning.
--   2. Operational source data remains owned by Retail, ARB, Warehouse,
--      Warehouse Control, Shipping, and Domain 7.
--   3. Cross-domain foreign keys are intentionally deferred to Slice 8B.
--   4. Foundation records are tenant-scoped, correlation-aware, versioned,
--      idempotent, and auditable.
--   5. Application roles must never own these objects.

BEGIN;

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '15min';
SET LOCAL idle_in_transaction_session_timeout = '5min';

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE SCHEMA IF NOT EXISTS return_defense;
COMMENT ON SCHEMA return_defense IS
'TCDS Domain 8 authoritative control plane for end-to-end return prevention, dispute defense, loss recovery, labor protection, and verified-outcome learning.';

-- ---------------------------------------------------------------------------
-- Utility functions
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION return_defense.utc_now()
RETURNS timestamptz
LANGUAGE sql
STABLE
PARALLEL SAFE
AS $$
    SELECT clock_timestamp();
$$;

CREATE OR REPLACE FUNCTION return_defense.require_object_json(
    p_value jsonb,
    p_name text
)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
    IF p_value IS NULL OR jsonb_typeof(p_value) <> 'object' THEN
        RAISE EXCEPTION '% must be a JSON object', p_name
            USING ERRCODE = '22023';
    END IF;
    RETURN p_value;
END;
$$;

CREATE OR REPLACE FUNCTION return_defense.sha256_jsonb(p_value jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
AS $$
    SELECT encode(
        digest(
            convert_to(
                jsonb_strip_nulls(p_value)::text,
                'UTF8'
            ),
            'sha256'
        ),
        'hex'
    );
$$;

CREATE OR REPLACE FUNCTION return_defense.sha256_text(p_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
AS $$
    SELECT encode(digest(convert_to(p_value, 'UTF8'), 'sha256'), 'hex');
$$;

CREATE OR REPLACE FUNCTION return_defense.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at := clock_timestamp();
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION return_defense.prevent_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'DELETE is prohibited on %.%', TG_TABLE_SCHEMA, TG_TABLE_NAME
        USING ERRCODE = '55000';
END;
$$;

CREATE OR REPLACE FUNCTION return_defense.prevent_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'UPDATE is prohibited on %.%', TG_TABLE_SCHEMA, TG_TABLE_NAME
        USING ERRCODE = '55000';
END;
$$;

-- ---------------------------------------------------------------------------
-- Controlled value catalogs
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS return_defense.status_catalog (
    status_domain text NOT NULL,
    status_code text NOT NULL,
    display_name text NOT NULL,
    description text,
    terminal boolean NOT NULL DEFAULT false,
    success_state boolean NOT NULL DEFAULT false,
    active boolean NOT NULL DEFAULT true,
    sort_order integer NOT NULL DEFAULT 100,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT status_catalog_pkey PRIMARY KEY (status_domain, status_code),
    CONSTRAINT status_catalog_domain_ck CHECK (status_domain ~ '^[A-Z][A-Z0-9_]{1,63}$'),
    CONSTRAINT status_catalog_code_ck CHECK (status_code ~ '^[A-Z][A-Z0-9_]{1,63}$'),
    CONSTRAINT status_catalog_metadata_ck CHECK (jsonb_typeof(metadata) = 'object')
);

DROP TRIGGER IF EXISTS trg_status_catalog_updated_at
ON return_defense.status_catalog;
CREATE TRIGGER trg_status_catalog_updated_at
BEFORE UPDATE ON return_defense.status_catalog
FOR EACH ROW EXECUTE FUNCTION return_defense.set_updated_at();

CREATE TABLE IF NOT EXISTS return_defense.reason_code_catalog (
    reason_code text PRIMARY KEY,
    reason_domain text NOT NULL,
    severity smallint NOT NULL DEFAULT 50,
    hard_block_eligible boolean NOT NULL DEFAULT false,
    human_review_eligible boolean NOT NULL DEFAULT true,
    display_name text NOT NULL,
    description text NOT NULL,
    remediation_template jsonb NOT NULL DEFAULT '{}'::jsonb,
    active boolean NOT NULL DEFAULT true,
    effective_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    expires_at timestamptz,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT reason_code_format_ck CHECK (reason_code ~ '^[A-Z][A-Z0-9_]{2,95}$'),
    CONSTRAINT reason_domain_format_ck CHECK (reason_domain ~ '^[A-Z][A-Z0-9_]{1,63}$'),
    CONSTRAINT reason_severity_ck CHECK (severity BETWEEN 0 AND 100),
    CONSTRAINT reason_expiry_ck CHECK (expires_at IS NULL OR expires_at > effective_at),
    CONSTRAINT reason_remediation_ck CHECK (jsonb_typeof(remediation_template) = 'object'),
    CONSTRAINT reason_metadata_ck CHECK (jsonb_typeof(metadata) = 'object')
);

DROP TRIGGER IF EXISTS trg_reason_code_catalog_updated_at
ON return_defense.reason_code_catalog;
CREATE TRIGGER trg_reason_code_catalog_updated_at
BEFORE UPDATE ON return_defense.reason_code_catalog
FOR EACH ROW EXECUTE FUNCTION return_defense.set_updated_at();

CREATE TABLE IF NOT EXISTS return_defense.control_definitions (
    control_code text PRIMARY KEY,
    control_domain text NOT NULL,
    display_name text NOT NULL,
    description text NOT NULL,
    control_type text NOT NULL,
    evidence_required boolean NOT NULL DEFAULT true,
    can_be_waived boolean NOT NULL DEFAULT false,
    default_expiration_interval interval,
    verification_contract jsonb NOT NULL DEFAULT '{}'::jsonb,
    active boolean NOT NULL DEFAULT true,
    effective_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    expires_at timestamptz,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT control_code_format_ck CHECK (control_code ~ '^[A-Z][A-Z0-9_]{2,95}$'),
    CONSTRAINT control_domain_format_ck CHECK (control_domain ~ '^[A-Z][A-Z0-9_]{1,63}$'),
    CONSTRAINT control_type_ck CHECK (
        control_type IN (
            'PREVENTIVE', 'DETECTIVE', 'CORRECTIVE',
            'EVIDENCE', 'FINANCIAL', 'MANUAL_REVIEW'
        )
    ),
    CONSTRAINT control_expiry_ck CHECK (expires_at IS NULL OR expires_at > effective_at),
    CONSTRAINT control_contract_ck CHECK (jsonb_typeof(verification_contract) = 'object'),
    CONSTRAINT control_metadata_ck CHECK (jsonb_typeof(metadata) = 'object')
);

DROP TRIGGER IF EXISTS trg_control_definitions_updated_at
ON return_defense.control_definitions;
CREATE TRIGGER trg_control_definitions_updated_at
BEFORE UPDATE ON return_defense.control_definitions
FOR EACH ROW EXECUTE FUNCTION return_defense.set_updated_at();

-- ---------------------------------------------------------------------------
-- Policy and model governance
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS return_defense.policy_versions (
    policy_version_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL,
    policy_key text NOT NULL,
    version integer NOT NULL,
    status text NOT NULL DEFAULT 'DRAFT',
    scope_type text NOT NULL DEFAULT 'GLOBAL',
    scope_key text NOT NULL DEFAULT '*',
    policy_document jsonb NOT NULL,
    policy_hash text GENERATED ALWAYS AS (
        return_defense.sha256_jsonb(policy_document)
    ) STORED,
    change_summary text NOT NULL,
    source_reference text,
    approved_by uuid,
    approved_at timestamptz,
    effective_at timestamptz,
    expires_at timestamptz,
    supersedes_policy_version_id uuid,
    created_by uuid,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT policy_versions_business_uk UNIQUE (
        tenant_id, policy_key, version, scope_type, scope_key
    ),
    CONSTRAINT policy_key_ck CHECK (policy_key ~ '^[A-Z][A-Z0-9_]{2,95}$'),
    CONSTRAINT policy_version_ck CHECK (version > 0),
    CONSTRAINT policy_status_ck CHECK (
        status IN ('DRAFT', 'APPROVED', 'ACTIVE', 'RETIRED', 'REJECTED')
    ),
    CONSTRAINT policy_scope_type_ck CHECK (
        scope_type IN (
            'GLOBAL', 'PLATFORM', 'RETAILER', 'CATEGORY',
            'PRODUCT_FAMILY', 'CARRIER', 'FACILITY', 'RISK_TIER'
        )
    ),
    CONSTRAINT policy_doc_ck CHECK (jsonb_typeof(policy_document) = 'object'),
    CONSTRAINT policy_approval_ck CHECK (
        (status IN ('APPROVED', 'ACTIVE', 'RETIRED') AND approved_by IS NOT NULL AND approved_at IS NOT NULL)
        OR status IN ('DRAFT', 'REJECTED')
    ),
    CONSTRAINT policy_activation_ck CHECK (
        (status = 'ACTIVE' AND effective_at IS NOT NULL)
        OR status <> 'ACTIVE'
    ),
    CONSTRAINT policy_expiry_ck CHECK (
        expires_at IS NULL OR effective_at IS NULL OR expires_at > effective_at
    ),
    CONSTRAINT policy_supersedes_fk FOREIGN KEY (supersedes_policy_version_id)
        REFERENCES return_defense.policy_versions(policy_version_id)
        DEFERRABLE INITIALLY DEFERRED
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_policy_one_active_scope
ON return_defense.policy_versions (
    tenant_id, policy_key, scope_type, scope_key
)
WHERE status = 'ACTIVE';

CREATE INDEX IF NOT EXISTS ix_policy_versions_lookup
ON return_defense.policy_versions (
    tenant_id, policy_key, scope_type, scope_key, effective_at DESC
);

DROP TRIGGER IF EXISTS trg_policy_versions_updated_at
ON return_defense.policy_versions;
CREATE TRIGGER trg_policy_versions_updated_at
BEFORE UPDATE ON return_defense.policy_versions
FOR EACH ROW EXECUTE FUNCTION return_defense.set_updated_at();

CREATE TABLE IF NOT EXISTS return_defense.model_versions (
    model_version_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL,
    model_key text NOT NULL,
    version text NOT NULL,
    status text NOT NULL DEFAULT 'DRAFT',
    model_type text NOT NULL,
    feature_schema_version text NOT NULL,
    training_data_cutoff_at timestamptz,
    artifact_uri text,
    artifact_sha256 text,
    model_card jsonb NOT NULL DEFAULT '{}'::jsonb,
    validation_metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
    segment_metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
    drift_thresholds jsonb NOT NULL DEFAULT '{}'::jsonb,
    approved_by uuid,
    approved_at timestamptz,
    activated_at timestamptz,
    retired_at timestamptz,
    rollback_model_version_id uuid,
    created_by uuid,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT model_versions_business_uk UNIQUE (tenant_id, model_key, version),
    CONSTRAINT model_key_ck CHECK (model_key ~ '^[A-Z][A-Z0-9_]{2,95}$'),
    CONSTRAINT model_status_ck CHECK (
        status IN ('DRAFT', 'VALIDATED', 'ACTIVE', 'SHADOW', 'RETIRED', 'REJECTED')
    ),
    CONSTRAINT model_type_ck CHECK (
        model_type IN ('RULES', 'STATISTICAL', 'ML', 'AI_ASSISTED', 'HYBRID')
    ),
    CONSTRAINT model_artifact_hash_ck CHECK (
        artifact_sha256 IS NULL OR artifact_sha256 ~ '^[0-9a-f]{64}$'
    ),
    CONSTRAINT model_card_ck CHECK (jsonb_typeof(model_card) = 'object'),
    CONSTRAINT model_validation_ck CHECK (jsonb_typeof(validation_metrics) = 'object'),
    CONSTRAINT model_segment_ck CHECK (jsonb_typeof(segment_metrics) = 'object'),
    CONSTRAINT model_drift_ck CHECK (jsonb_typeof(drift_thresholds) = 'object'),
    CONSTRAINT model_approval_ck CHECK (
        (status IN ('VALIDATED', 'ACTIVE', 'SHADOW', 'RETIRED') AND approved_by IS NOT NULL AND approved_at IS NOT NULL)
        OR status IN ('DRAFT', 'REJECTED')
    ),
    CONSTRAINT model_activation_ck CHECK (
        (status = 'ACTIVE' AND activated_at IS NOT NULL)
        OR status <> 'ACTIVE'
    ),
    CONSTRAINT model_rollback_fk FOREIGN KEY (rollback_model_version_id)
        REFERENCES return_defense.model_versions(model_version_id)
        DEFERRABLE INITIALLY DEFERRED
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_model_one_active
ON return_defense.model_versions (tenant_id, model_key)
WHERE status = 'ACTIVE';

DROP TRIGGER IF EXISTS trg_model_versions_updated_at
ON return_defense.model_versions;
CREATE TRIGGER trg_model_versions_updated_at
BEFORE UPDATE ON return_defense.model_versions
FOR EACH ROW EXECUTE FUNCTION return_defense.set_updated_at();

CREATE TABLE IF NOT EXISTS return_defense.risk_thresholds (
    risk_threshold_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL,
    threshold_key text NOT NULL,
    version integer NOT NULL,
    gate_stage text NOT NULL,
    scope_type text NOT NULL DEFAULT 'GLOBAL',
    scope_key text NOT NULL DEFAULT '*',
    green_max numeric NOT NULL,
    guarded_max numeric NOT NULL,
    elevated_max numeric NOT NULL,
    high_max numeric NOT NULL,
    critical_max numeric NOT NULL DEFAULT 100,
    review_rules jsonb NOT NULL DEFAULT '{}'::jsonb,
    effective_at timestamptz NOT NULL,
    expires_at timestamptz,
    active boolean NOT NULL DEFAULT false,
    policy_version_id uuid NOT NULL,
    approved_by uuid NOT NULL,
    approved_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT risk_thresholds_business_uk UNIQUE (
        tenant_id, threshold_key, version, gate_stage, scope_type, scope_key
    ),
    CONSTRAINT risk_threshold_key_ck CHECK (threshold_key ~ '^[A-Z][A-Z0-9_]{2,95}$'),
    CONSTRAINT risk_gate_stage_ck CHECK (
        gate_stage IN (
            'RETAIL_SOURCE_QUALITY',
            'ACQUISITION_PROFIT_DEFENSE',
            'SOURCE_RECOVERY_WINDOW',
            'RECEIVING_IDENTITY',
            'INVENTORY_INTEGRITY',
            'LISTING_DEFENSIBILITY',
            'ORDER_FULFILLMENT',
            'PACKING_SHIPMENT_RELEASE',
            'DELIVERY_INTERVENTION',
            'RETURN_DISPUTE_RECOVERY'
        )
    ),
    CONSTRAINT risk_scope_type_ck CHECK (
        scope_type IN (
            'GLOBAL', 'PLATFORM', 'RETAILER', 'CATEGORY',
            'PRODUCT_FAMILY', 'CARRIER', 'FACILITY', 'RISK_TIER'
        )
    ),
    CONSTRAINT risk_bounds_ck CHECK (
        green_max >= 0
        AND green_max < guarded_max
        AND guarded_max < elevated_max
        AND elevated_max < high_max
        AND high_max < critical_max
        AND critical_max <= 100
    ),
    CONSTRAINT risk_expiry_ck CHECK (expires_at IS NULL OR expires_at > effective_at),
    CONSTRAINT risk_review_rules_ck CHECK (jsonb_typeof(review_rules) = 'object'),
    CONSTRAINT risk_policy_fk FOREIGN KEY (policy_version_id)
        REFERENCES return_defense.policy_versions(policy_version_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_risk_threshold_one_active_scope
ON return_defense.risk_thresholds (
    tenant_id, threshold_key, gate_stage, scope_type, scope_key
)
WHERE active;

DROP TRIGGER IF EXISTS trg_risk_thresholds_updated_at
ON return_defense.risk_thresholds;
CREATE TRIGGER trg_risk_thresholds_updated_at
BEFORE UPDATE ON return_defense.risk_thresholds
FOR EACH ROW EXECUTE FUNCTION return_defense.set_updated_at();

-- ---------------------------------------------------------------------------
-- Foundation audit and release metadata
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS return_defense.schema_contract_versions (
    contract_version_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    contract_key text NOT NULL,
    contract_version text NOT NULL,
    migration_start integer NOT NULL,
    migration_end integer NOT NULL,
    status text NOT NULL DEFAULT 'INSTALLED',
    release_manifest jsonb NOT NULL,
    manifest_sha256 text GENERATED ALWAYS AS (
        return_defense.sha256_jsonb(release_manifest)
    ) STORED,
    installed_by text NOT NULL DEFAULT session_user,
    installed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    certified_at timestamptz,
    certification_report jsonb,
    CONSTRAINT schema_contract_versions_uk UNIQUE (contract_key, contract_version),
    CONSTRAINT schema_contract_status_ck CHECK (
        status IN ('INSTALLED', 'CERTIFIED', 'RETIRED', 'FAILED')
    ),
    CONSTRAINT schema_contract_migration_ck CHECK (
        migration_start > 0 AND migration_end >= migration_start
    ),
    CONSTRAINT schema_contract_manifest_ck CHECK (
        jsonb_typeof(release_manifest) = 'object'
    ),
    CONSTRAINT schema_contract_certification_ck CHECK (
        certification_report IS NULL OR jsonb_typeof(certification_report) = 'object'
    )
);

INSERT INTO return_defense.schema_contract_versions (
    contract_key,
    contract_version,
    migration_start,
    migration_end,
    release_manifest
)
VALUES (
    'DOMAIN8_AUTHORITATIVE_FOUNDATION',
    '8A1.1.0',
    801,
    805,
    jsonb_build_object(
        'domain', 8,
        'slice', '8A1',
        'name', 'Authoritative Database Foundation',
        'cross_domain_foreign_keys_deferred_to', '8B',
        'installed_at', clock_timestamp()
    )
)
ON CONFLICT (contract_key, contract_version) DO NOTHING;

COMMIT;
