-- TCDS Phase 3 Domain 8
-- File: 804_domain8_audit_outbox_and_idempotency.sql

BEGIN;

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '15min';

CREATE TABLE IF NOT EXISTS return_defense.idempotency_keys (
    idempotency_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL,
    operation_scope text NOT NULL,
    idempotency_key text NOT NULL,
    request_hash text NOT NULL,
    status text NOT NULL DEFAULT 'CLAIMED',
    owner_token uuid NOT NULL DEFAULT gen_random_uuid(),
    claimed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    heartbeat_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    expires_at timestamptz NOT NULL,
    completed_at timestamptz,
    response_code text,
    response_payload jsonb,
    response_hash text,
    error_class text,
    error_summary text,
    correlation_id uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT idempotency_business_uk UNIQUE (
        tenant_id, operation_scope, idempotency_key
    ),
    CONSTRAINT idempotency_scope_ck CHECK (
        operation_scope ~ '^[A-Z][A-Z0-9_:.\\-]{2,127}$'
    ),
    CONSTRAINT idempotency_request_hash_ck CHECK (
        request_hash ~ '^[0-9a-f]{64}$'
    ),
    CONSTRAINT idempotency_status_ck CHECK (
        status IN ('CLAIMED', 'PROCESSING', 'COMPLETED', 'FAILED', 'EXPIRED')
    ),
    CONSTRAINT idempotency_expiry_ck CHECK (expires_at > claimed_at),
    CONSTRAINT idempotency_completion_ck CHECK (
        (status = 'COMPLETED' AND completed_at IS NOT NULL AND response_hash IS NOT NULL)
        OR status <> 'COMPLETED'
    ),
    CONSTRAINT idempotency_response_hash_ck CHECK (
        response_hash IS NULL OR response_hash ~ '^[0-9a-f]{64}$'
    ),
    CONSTRAINT idempotency_response_payload_ck CHECK (
        response_payload IS NULL OR jsonb_typeof(response_payload) IN ('object', 'array')
    )
);

CREATE INDEX IF NOT EXISTS ix_idempotency_claim_recovery
ON return_defense.idempotency_keys (
    tenant_id, status, expires_at
)
WHERE status IN ('CLAIMED', 'PROCESSING');

DROP TRIGGER IF EXISTS trg_idempotency_updated_at
ON return_defense.idempotency_keys;
CREATE TRIGGER trg_idempotency_updated_at
BEFORE UPDATE ON return_defense.idempotency_keys
FOR EACH ROW EXECUTE FUNCTION return_defense.set_updated_at();

CREATE TABLE IF NOT EXISTS return_defense.domain_events (
    event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL,
    aggregate_type text NOT NULL,
    aggregate_id text NOT NULL,
    event_type text NOT NULL,
    event_version integer NOT NULL DEFAULT 1,
    event_payload jsonb NOT NULL,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    causation_event_id uuid,
    correlation_id uuid NOT NULL,
    idempotency_key text,
    actor_type text NOT NULL DEFAULT 'SYSTEM',
    actor_id uuid,
    occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    payload_hash text GENERATED ALWAYS AS (
        return_defense.sha256_jsonb(event_payload)
    ) STORED,
    CONSTRAINT domain_events_aggregate_ck CHECK (
        aggregate_type ~ '^[A-Z][A-Z0-9_]{1,63}$'
        AND length(aggregate_id) BETWEEN 1 AND 256
    ),
    CONSTRAINT domain_events_type_ck CHECK (
        event_type ~ '^[A-Z][A-Z0-9_]{2,127}$'
    ),
    CONSTRAINT domain_events_version_ck CHECK (event_version > 0),
    CONSTRAINT domain_events_payload_ck CHECK (jsonb_typeof(event_payload) = 'object'),
    CONSTRAINT domain_events_metadata_ck CHECK (jsonb_typeof(metadata) = 'object'),
    CONSTRAINT domain_events_actor_type_ck CHECK (
        actor_type IN ('SYSTEM', 'USER', 'WORKER', 'WEBHOOK', 'ADMIN', 'MIGRATION')
    ),
    CONSTRAINT domain_events_causation_fk FOREIGN KEY (causation_event_id)
        REFERENCES return_defense.domain_events(event_id)
        DEFERRABLE INITIALLY DEFERRED
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_domain_event_idempotency
ON return_defense.domain_events (
    tenant_id, aggregate_type, aggregate_id, idempotency_key
)
WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_domain_events_aggregate
ON return_defense.domain_events (
    tenant_id, aggregate_type, aggregate_id, occurred_at, event_id
);

CREATE INDEX IF NOT EXISTS ix_domain_events_correlation
ON return_defense.domain_events (tenant_id, correlation_id, occurred_at);

DROP TRIGGER IF EXISTS trg_domain_events_no_update
ON return_defense.domain_events;
CREATE TRIGGER trg_domain_events_no_update
BEFORE UPDATE ON return_defense.domain_events
FOR EACH ROW EXECUTE FUNCTION return_defense.prevent_update();

DROP TRIGGER IF EXISTS trg_domain_events_no_delete
ON return_defense.domain_events;
CREATE TRIGGER trg_domain_events_no_delete
BEFORE DELETE ON return_defense.domain_events
FOR EACH ROW EXECUTE FUNCTION return_defense.prevent_delete();

CREATE TABLE IF NOT EXISTS return_defense.outbox_events (
    outbox_event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL,
    domain_event_id uuid NOT NULL,
    topic text NOT NULL,
    partition_key text NOT NULL,
    payload jsonb NOT NULL,
    headers jsonb NOT NULL DEFAULT '{}'::jsonb,
    status text NOT NULL DEFAULT 'PENDING',
    available_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    attempt_count integer NOT NULL DEFAULT 0,
    max_attempts integer NOT NULL DEFAULT 12,
    locked_by text,
    locked_at timestamptz,
    last_attempt_at timestamptz,
    published_at timestamptz,
    last_error text,
    dead_lettered_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT outbox_domain_event_uk UNIQUE (domain_event_id, topic),
    CONSTRAINT outbox_topic_ck CHECK (topic ~ '^[a-zA-Z0-9._\\-]{3,160}$'),
    CONSTRAINT outbox_payload_ck CHECK (jsonb_typeof(payload) = 'object'),
    CONSTRAINT outbox_headers_ck CHECK (jsonb_typeof(headers) = 'object'),
    CONSTRAINT outbox_status_ck CHECK (
        status IN ('PENDING', 'LOCKED', 'PUBLISHED', 'RETRY', 'DEAD_LETTER')
    ),
    CONSTRAINT outbox_attempt_ck CHECK (
        attempt_count >= 0 AND max_attempts BETWEEN 1 AND 100
    ),
    CONSTRAINT outbox_published_ck CHECK (
        (status = 'PUBLISHED' AND published_at IS NOT NULL)
        OR status <> 'PUBLISHED'
    ),
    CONSTRAINT outbox_dead_letter_ck CHECK (
        (status = 'DEAD_LETTER' AND dead_lettered_at IS NOT NULL)
        OR status <> 'DEAD_LETTER'
    ),
    CONSTRAINT outbox_domain_event_fk FOREIGN KEY (domain_event_id)
        REFERENCES return_defense.domain_events(event_id)
);

CREATE INDEX IF NOT EXISTS ix_outbox_publish_claim
ON return_defense.outbox_events (
    status, available_at, created_at
)
WHERE status IN ('PENDING', 'RETRY');

DROP TRIGGER IF EXISTS trg_outbox_updated_at
ON return_defense.outbox_events;
CREATE TRIGGER trg_outbox_updated_at
BEFORE UPDATE ON return_defense.outbox_events
FOR EACH ROW EXECUTE FUNCTION return_defense.set_updated_at();

CREATE TABLE IF NOT EXISTS return_defense.audit_log (
    audit_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id uuid,
    schema_name text NOT NULL,
    table_name text NOT NULL,
    operation text NOT NULL,
    record_pk jsonb,
    old_data jsonb,
    new_data jsonb,
    changed_columns text[],
    actor_type text NOT NULL DEFAULT 'SYSTEM',
    actor_id uuid,
    request_id uuid,
    correlation_id uuid,
    source text NOT NULL DEFAULT 'APPLICATION',
    occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    txid bigint NOT NULL DEFAULT txid_current(),
    row_hash text NOT NULL,
    previous_hash text,
    chain_hash text NOT NULL,
    CONSTRAINT audit_operation_ck CHECK (
        operation IN ('INSERT', 'UPDATE', 'DELETE', 'EXECUTE', 'OVERRIDE', 'SECURITY')
    ),
    CONSTRAINT audit_record_pk_ck CHECK (
        record_pk IS NULL OR jsonb_typeof(record_pk) = 'object'
    ),
    CONSTRAINT audit_old_data_ck CHECK (
        old_data IS NULL OR jsonb_typeof(old_data) = 'object'
    ),
    CONSTRAINT audit_new_data_ck CHECK (
        new_data IS NULL OR jsonb_typeof(new_data) = 'object'
    ),
    CONSTRAINT audit_hash_ck CHECK (
        row_hash ~ '^[0-9a-f]{64}$'
        AND chain_hash ~ '^[0-9a-f]{64}$'
        AND (previous_hash IS NULL OR previous_hash ~ '^[0-9a-f]{64}$')
    )
);

CREATE INDEX IF NOT EXISTS ix_audit_log_entity
ON return_defense.audit_log (
    tenant_id, schema_name, table_name, occurred_at, audit_id
);

CREATE INDEX IF NOT EXISTS ix_audit_log_correlation
ON return_defense.audit_log (correlation_id, occurred_at, audit_id);

DROP TRIGGER IF EXISTS trg_audit_log_no_update
ON return_defense.audit_log;
CREATE TRIGGER trg_audit_log_no_update
BEFORE UPDATE ON return_defense.audit_log
FOR EACH ROW EXECUTE FUNCTION return_defense.prevent_update();

DROP TRIGGER IF EXISTS trg_audit_log_no_delete
ON return_defense.audit_log;
CREATE TRIGGER trg_audit_log_no_delete
BEFORE DELETE ON return_defense.audit_log
FOR EACH ROW EXECUTE FUNCTION return_defense.prevent_delete();

CREATE OR REPLACE FUNCTION return_defense.claim_idempotency_key(
    p_tenant_id uuid,
    p_operation_scope text,
    p_idempotency_key text,
    p_request_payload jsonb,
    p_ttl interval,
    p_correlation_id uuid
)
RETURNS TABLE (
    disposition text,
    idempotency_id uuid,
    owner_token uuid,
    status text,
    response_payload jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, return_defense
AS $$
DECLARE
    v_hash text;
    v_row return_defense.idempotency_keys;
BEGIN
    IF p_ttl <= interval '0 seconds' OR p_ttl > interval '7 days' THEN
        RAISE EXCEPTION 'TTL must be > 0 and <= 7 days'
            USING ERRCODE = '22023';
    END IF;

    v_hash := return_defense.sha256_jsonb(
        return_defense.require_object_json(p_request_payload, 'request payload')
    );

    INSERT INTO return_defense.idempotency_keys (
        tenant_id,
        operation_scope,
        idempotency_key,
        request_hash,
        expires_at,
        correlation_id
    )
    VALUES (
        p_tenant_id,
        p_operation_scope,
        p_idempotency_key,
        v_hash,
        clock_timestamp() + p_ttl,
        p_correlation_id
    )
    ON CONFLICT (tenant_id, operation_scope, idempotency_key)
    DO NOTHING
    RETURNING * INTO v_row;

    IF FOUND THEN
        RETURN QUERY SELECT
            'CLAIMED'::text,
            v_row.idempotency_id,
            v_row.owner_token,
            v_row.status,
            v_row.response_payload;
        RETURN;
    END IF;

    SELECT *
    INTO v_row
    FROM return_defense.idempotency_keys
    WHERE tenant_id = p_tenant_id
      AND operation_scope = p_operation_scope
      AND idempotency_key = p_idempotency_key
    FOR UPDATE;

    IF v_row.request_hash <> v_hash THEN
        RAISE EXCEPTION 'Idempotency key reused with different request payload'
            USING ERRCODE = '23505';
    END IF;

    IF v_row.status = 'COMPLETED' THEN
        RETURN QUERY SELECT
            'REPLAY'::text,
            v_row.idempotency_id,
            v_row.owner_token,
            v_row.status,
            v_row.response_payload;
        RETURN;
    END IF;

    IF v_row.expires_at <= clock_timestamp()
       AND v_row.status IN ('CLAIMED', 'PROCESSING', 'FAILED')
    THEN
        UPDATE return_defense.idempotency_keys
        SET status = 'CLAIMED',
            owner_token = gen_random_uuid(),
            claimed_at = clock_timestamp(),
            heartbeat_at = clock_timestamp(),
            expires_at = clock_timestamp() + p_ttl,
            completed_at = NULL,
            response_code = NULL,
            response_payload = NULL,
            response_hash = NULL,
            error_class = NULL,
            error_summary = NULL,
            correlation_id = p_correlation_id,
            updated_at = clock_timestamp()
        WHERE idempotency_id = v_row.idempotency_id
        RETURNING * INTO v_row;

        RETURN QUERY SELECT
            'RECLAIMED'::text,
            v_row.idempotency_id,
            v_row.owner_token,
            v_row.status,
            v_row.response_payload;
        RETURN;
    END IF;

    RETURN QUERY SELECT
        'IN_PROGRESS'::text,
        v_row.idempotency_id,
        v_row.owner_token,
        v_row.status,
        v_row.response_payload;
END;
$$;

CREATE OR REPLACE FUNCTION return_defense.complete_idempotency_key(
    p_idempotency_id uuid,
    p_owner_token uuid,
    p_response_code text,
    p_response_payload jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, return_defense
AS $$
DECLARE
    v_updated integer;
    v_payload jsonb;
BEGIN
    v_payload := COALESCE(p_response_payload, '{}'::jsonb);

    IF jsonb_typeof(v_payload) NOT IN ('object', 'array') THEN
        RAISE EXCEPTION 'response payload must be object or array'
            USING ERRCODE = '22023';
    END IF;

    UPDATE return_defense.idempotency_keys
    SET status = 'COMPLETED',
        completed_at = clock_timestamp(),
        response_code = p_response_code,
        response_payload = v_payload,
        response_hash = return_defense.sha256_jsonb(
            CASE
                WHEN jsonb_typeof(v_payload) = 'object' THEN v_payload
                ELSE jsonb_build_object('items', v_payload)
            END
        ),
        updated_at = clock_timestamp()
    WHERE idempotency_id = p_idempotency_id
      AND owner_token = p_owner_token
      AND status IN ('CLAIMED', 'PROCESSING');

    GET DIAGNOSTICS v_updated = ROW_COUNT;

    IF v_updated <> 1 THEN
        RAISE EXCEPTION 'Idempotency ownership lost or record not completable'
            USING ERRCODE = '55000';
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION return_defense.append_domain_event(
    p_tenant_id uuid,
    p_aggregate_type text,
    p_aggregate_id text,
    p_event_type text,
    p_event_payload jsonb,
    p_metadata jsonb,
    p_correlation_id uuid,
    p_idempotency_key text DEFAULT NULL,
    p_actor_type text DEFAULT 'SYSTEM',
    p_actor_id uuid DEFAULT NULL,
    p_topic text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, return_defense
AS $$
DECLARE
    v_event_id uuid;
BEGIN
    INSERT INTO return_defense.domain_events (
        tenant_id,
        aggregate_type,
        aggregate_id,
        event_type,
        event_payload,
        metadata,
        correlation_id,
        idempotency_key,
        actor_type,
        actor_id
    )
    VALUES (
        p_tenant_id,
        p_aggregate_type,
        p_aggregate_id,
        p_event_type,
        return_defense.require_object_json(p_event_payload, 'event payload'),
        return_defense.require_object_json(COALESCE(p_metadata, '{}'::jsonb), 'metadata'),
        p_correlation_id,
        p_idempotency_key,
        p_actor_type,
        p_actor_id
    )
    RETURNING event_id INTO v_event_id;

    IF p_topic IS NOT NULL THEN
        INSERT INTO return_defense.outbox_events (
            tenant_id,
            domain_event_id,
            topic,
            partition_key,
            payload,
            headers
        )
        SELECT
            p_tenant_id,
            event_id,
            p_topic,
            p_aggregate_id,
            jsonb_build_object(
                'event_id', event_id,
                'aggregate_type', aggregate_type,
                'aggregate_id', aggregate_id,
                'event_type', event_type,
                'event_version', event_version,
                'occurred_at', occurred_at,
                'payload', event_payload,
                'metadata', metadata,
                'correlation_id', correlation_id
            ),
            jsonb_build_object(
                'event_type', event_type,
                'correlation_id', correlation_id
            )
        FROM return_defense.domain_events
        WHERE event_id = v_event_id;
    END IF;

    RETURN v_event_id;
END;
$$;

-- RLS
ALTER TABLE return_defense.idempotency_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE return_defense.idempotency_keys FORCE ROW LEVEL SECURITY;
ALTER TABLE return_defense.domain_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE return_defense.domain_events FORCE ROW LEVEL SECURITY;
ALTER TABLE return_defense.outbox_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE return_defense.outbox_events FORCE ROW LEVEL SECURITY;
ALTER TABLE return_defense.audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE return_defense.audit_log FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_idempotency
ON return_defense.idempotency_keys;
CREATE POLICY tenant_isolation_idempotency
ON return_defense.idempotency_keys
USING (tenant_id = return_defense.current_tenant_id())
WITH CHECK (tenant_id = return_defense.current_tenant_id());

DROP POLICY IF EXISTS tenant_isolation_domain_events
ON return_defense.domain_events;
CREATE POLICY tenant_isolation_domain_events
ON return_defense.domain_events
USING (tenant_id = return_defense.current_tenant_id())
WITH CHECK (tenant_id = return_defense.current_tenant_id());

DROP POLICY IF EXISTS tenant_isolation_outbox
ON return_defense.outbox_events;
CREATE POLICY tenant_isolation_outbox
ON return_defense.outbox_events
USING (tenant_id = return_defense.current_tenant_id())
WITH CHECK (tenant_id = return_defense.current_tenant_id());

DROP POLICY IF EXISTS tenant_isolation_audit
ON return_defense.audit_log;
CREATE POLICY tenant_isolation_audit
ON return_defense.audit_log
USING (
    tenant_id IS NULL
    OR tenant_id = return_defense.current_tenant_id()
)
WITH CHECK (
    tenant_id IS NULL
    OR tenant_id = return_defense.current_tenant_id()
);

COMMIT;
