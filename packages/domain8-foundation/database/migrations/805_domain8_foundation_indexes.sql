-- TCDS Phase 3 Domain 8
-- File: 805_domain8_foundation_indexes.sql

BEGIN;

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '15min';

CREATE INDEX IF NOT EXISTS ix_reason_catalog_domain_active
ON return_defense.reason_code_catalog (
    reason_domain, active, severity DESC, reason_code
);

CREATE INDEX IF NOT EXISTS ix_control_catalog_domain_active
ON return_defense.control_definitions (
    control_domain, active, control_type, control_code
);

CREATE INDEX IF NOT EXISTS ix_policy_versions_status
ON return_defense.policy_versions (
    tenant_id, status, effective_at, expires_at
);

CREATE INDEX IF NOT EXISTS ix_model_versions_status
ON return_defense.model_versions (
    tenant_id, model_key, status, activated_at DESC
);

CREATE INDEX IF NOT EXISTS ix_risk_thresholds_effective
ON return_defense.risk_thresholds (
    tenant_id, gate_stage, scope_type, scope_key,
    active, effective_at DESC
);

CREATE INDEX IF NOT EXISTS ix_outbox_locked_recovery
ON return_defense.outbox_events (
    status, locked_at
)
WHERE status = 'LOCKED';

CREATE INDEX IF NOT EXISTS ix_outbox_dead_letter
ON return_defense.outbox_events (
    tenant_id, dead_lettered_at DESC
)
WHERE status = 'DEAD_LETTER';

CREATE INDEX IF NOT EXISTS ix_idempotency_completed
ON return_defense.idempotency_keys (
    tenant_id, completed_at DESC
)
WHERE status = 'COMPLETED';

ANALYZE return_defense.status_catalog;
ANALYZE return_defense.reason_code_catalog;
ANALYZE return_defense.control_definitions;
ANALYZE return_defense.policy_versions;
ANALYZE return_defense.model_versions;
ANALYZE return_defense.risk_thresholds;
ANALYZE return_defense.idempotency_keys;
ANALYZE return_defense.domain_events;
ANALYZE return_defense.outbox_events;

COMMIT;
