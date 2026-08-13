-- TCDS Phase 3 Domain 8
-- Slice 8A.1.1 Fortune 500 Hardening
-- File: 806_domain8_security_immutability_audit_hardening.sql
-- Additive upgrade for installations that already applied migrations 801-805.

BEGIN;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '20min';

-- ---------------------------------------------------------------------------
-- Mandatory trusted execution context
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION return_defense.current_correlation_id()
RETURNS uuid
LANGUAGE plpgsql
STABLE
AS $$
DECLARE v_value text;
BEGIN
    v_value := current_setting('app.correlation_id', true);
    IF v_value IS NULL OR btrim(v_value) = '' THEN
        RAISE EXCEPTION 'app.correlation_id is required for authoritative writes'
            USING ERRCODE = '42501';
    END IF;
    RETURN v_value::uuid;
END;
$$;

CREATE OR REPLACE FUNCTION return_defense.assert_tenant_context(p_tenant_id uuid)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
AS $$
DECLARE v_tenant uuid;
BEGIN
    v_tenant := return_defense.current_tenant_id();
    IF p_tenant_id IS DISTINCT FROM v_tenant THEN
        RAISE EXCEPTION 'Tenant context mismatch'
            USING ERRCODE = '42501',
                  DETAIL = format('session tenant=%s supplied tenant=%s', v_tenant, p_tenant_id);
    END IF;
    RETURN v_tenant;
END;
$$;

-- Harden future function privileges for the migration owner.
ALTER DEFAULT PRIVILEGES IN SCHEMA return_defense
    REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA return_defense FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- Immutable governance records and controlled transitions
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION return_defense.guard_policy_version_update()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.status IN ('APPROVED','ACTIVE','RETIRED') AND (
        NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR
        NEW.policy_key IS DISTINCT FROM OLD.policy_key OR
        NEW.version IS DISTINCT FROM OLD.version OR
        NEW.scope_type IS DISTINCT FROM OLD.scope_type OR
        NEW.scope_key IS DISTINCT FROM OLD.scope_key OR
        NEW.policy_document IS DISTINCT FROM OLD.policy_document OR
        NEW.change_summary IS DISTINCT FROM OLD.change_summary OR
        NEW.source_reference IS DISTINCT FROM OLD.source_reference OR
        NEW.approved_by IS DISTINCT FROM OLD.approved_by OR
        NEW.approved_at IS DISTINCT FROM OLD.approved_at OR
        NEW.effective_at IS DISTINCT FROM OLD.effective_at OR
        NEW.supersedes_policy_version_id IS DISTINCT FROM OLD.supersedes_policy_version_id OR
        NEW.created_by IS DISTINCT FROM OLD.created_by OR
        NEW.created_at IS DISTINCT FROM OLD.created_at
    ) THEN
        RAISE EXCEPTION 'Approved/active/retired policy content is immutable; create a new version'
            USING ERRCODE='55000';
    END IF;
    IF OLD.status='RETIRED' AND NEW.status IS DISTINCT FROM OLD.status THEN
        RAISE EXCEPTION 'Retired policy cannot be reactivated in place' USING ERRCODE='55000';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_policy_versions_guard ON return_defense.policy_versions;
CREATE TRIGGER trg_policy_versions_guard
BEFORE UPDATE ON return_defense.policy_versions
FOR EACH ROW EXECUTE FUNCTION return_defense.guard_policy_version_update();

CREATE OR REPLACE FUNCTION return_defense.guard_model_version_update()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.status IN ('VALIDATED','ACTIVE','SHADOW','RETIRED') AND (
        NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR
        NEW.model_key IS DISTINCT FROM OLD.model_key OR
        NEW.version IS DISTINCT FROM OLD.version OR
        NEW.model_type IS DISTINCT FROM OLD.model_type OR
        NEW.feature_schema_version IS DISTINCT FROM OLD.feature_schema_version OR
        NEW.training_data_cutoff_at IS DISTINCT FROM OLD.training_data_cutoff_at OR
        NEW.artifact_uri IS DISTINCT FROM OLD.artifact_uri OR
        NEW.artifact_sha256 IS DISTINCT FROM OLD.artifact_sha256 OR
        NEW.model_card IS DISTINCT FROM OLD.model_card OR
        NEW.validation_metrics IS DISTINCT FROM OLD.validation_metrics OR
        NEW.segment_metrics IS DISTINCT FROM OLD.segment_metrics OR
        NEW.drift_thresholds IS DISTINCT FROM OLD.drift_thresholds OR
        NEW.approved_by IS DISTINCT FROM OLD.approved_by OR
        NEW.approved_at IS DISTINCT FROM OLD.approved_at OR
        NEW.rollback_model_version_id IS DISTINCT FROM OLD.rollback_model_version_id OR
        NEW.created_by IS DISTINCT FROM OLD.created_by OR
        NEW.created_at IS DISTINCT FROM OLD.created_at
    ) THEN
        RAISE EXCEPTION 'Validated/active/shadow/retired model content is immutable; create a new version'
            USING ERRCODE='55000';
    END IF;
    IF OLD.status='RETIRED' AND NEW.status IS DISTINCT FROM OLD.status THEN
        RAISE EXCEPTION 'Retired model cannot be reactivated in place' USING ERRCODE='55000';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_model_versions_guard ON return_defense.model_versions;
CREATE TRIGGER trg_model_versions_guard
BEFORE UPDATE ON return_defense.model_versions
FOR EACH ROW EXECUTE FUNCTION return_defense.guard_model_version_update();

CREATE OR REPLACE FUNCTION return_defense.guard_risk_threshold_update()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.active AND (
        NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR
        NEW.threshold_key IS DISTINCT FROM OLD.threshold_key OR
        NEW.version IS DISTINCT FROM OLD.version OR
        NEW.gate_stage IS DISTINCT FROM OLD.gate_stage OR
        NEW.scope_type IS DISTINCT FROM OLD.scope_type OR
        NEW.scope_key IS DISTINCT FROM OLD.scope_key OR
        NEW.green_max IS DISTINCT FROM OLD.green_max OR
        NEW.guarded_max IS DISTINCT FROM OLD.guarded_max OR
        NEW.elevated_max IS DISTINCT FROM OLD.elevated_max OR
        NEW.high_max IS DISTINCT FROM OLD.high_max OR
        NEW.critical_max IS DISTINCT FROM OLD.critical_max OR
        NEW.review_rules IS DISTINCT FROM OLD.review_rules OR
        NEW.effective_at IS DISTINCT FROM OLD.effective_at OR
        NEW.policy_version_id IS DISTINCT FROM OLD.policy_version_id OR
        NEW.approved_by IS DISTINCT FROM OLD.approved_by OR
        NEW.approved_at IS DISTINCT FROM OLD.approved_at OR
        NEW.created_at IS DISTINCT FROM OLD.created_at
    ) THEN
        RAISE EXCEPTION 'Active threshold content is immutable; create a new version'
            USING ERRCODE='55000';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_risk_thresholds_guard ON return_defense.risk_thresholds;
CREATE TRIGGER trg_risk_thresholds_guard
BEFORE UPDATE ON return_defense.risk_thresholds
FOR EACH ROW EXECUTE FUNCTION return_defense.guard_risk_threshold_update();

-- ---------------------------------------------------------------------------
-- Database-generated tamper-evident audit chain
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS return_defense.audit_chain_heads (
    tenant_id uuid NOT NULL,
    chain_key text NOT NULL,
    last_audit_id bigint,
    last_chain_hash text,
    event_count bigint NOT NULL DEFAULT 0,
    sealed_through_at timestamptz,
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (tenant_id, chain_key),
    CONSTRAINT audit_chain_key_ck CHECK (chain_key ~ '^[A-Z][A-Z0-9_:.\\-]{2,127}$'),
    CONSTRAINT audit_head_hash_ck CHECK (last_chain_hash IS NULL OR last_chain_hash ~ '^[0-9a-f]{64}$'),
    CONSTRAINT audit_head_count_ck CHECK (event_count >= 0)
);

ALTER TABLE return_defense.audit_chain_heads ENABLE ROW LEVEL SECURITY;
ALTER TABLE return_defense.audit_chain_heads FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_audit_heads ON return_defense.audit_chain_heads;
CREATE POLICY tenant_isolation_audit_heads ON return_defense.audit_chain_heads
USING (tenant_id=return_defense.current_tenant_id())
WITH CHECK (tenant_id=return_defense.current_tenant_id());

REVOKE INSERT, UPDATE, DELETE ON return_defense.audit_log FROM PUBLIC;
REVOKE INSERT, UPDATE, DELETE ON return_defense.audit_chain_heads FROM PUBLIC;

CREATE OR REPLACE FUNCTION return_defense.append_audit_event(
    p_tenant_id uuid,
    p_chain_key text,
    p_schema_name text,
    p_table_name text,
    p_operation text,
    p_record_pk jsonb,
    p_old_data jsonb,
    p_new_data jsonb,
    p_changed_columns text[],
    p_actor_type text,
    p_actor_id uuid,
    p_request_id uuid,
    p_correlation_id uuid,
    p_source text
) RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,return_defense
AS $$
DECLARE
    v_tenant uuid;
    v_head return_defense.audit_chain_heads;
    v_row_hash text;
    v_chain_hash text;
    v_audit_id bigint;
    v_payload jsonb;
BEGIN
    v_tenant := return_defense.assert_tenant_context(p_tenant_id);
    IF p_correlation_id IS DISTINCT FROM return_defense.current_correlation_id() THEN
        RAISE EXCEPTION 'Correlation context mismatch' USING ERRCODE='42501';
    END IF;

    INSERT INTO return_defense.audit_chain_heads(tenant_id,chain_key)
    VALUES(v_tenant,p_chain_key)
    ON CONFLICT DO NOTHING;

    SELECT * INTO v_head
    FROM return_defense.audit_chain_heads
    WHERE tenant_id=v_tenant AND chain_key=p_chain_key
    FOR UPDATE;

    v_payload := jsonb_build_object(
        'tenant_id',v_tenant,'chain_key',p_chain_key,'schema_name',p_schema_name,
        'table_name',p_table_name,'operation',p_operation,'record_pk',p_record_pk,
        'old_data',p_old_data,'new_data',p_new_data,'changed_columns',p_changed_columns,
        'actor_type',p_actor_type,'actor_id',p_actor_id,'request_id',p_request_id,
        'correlation_id',p_correlation_id,'source',p_source,'txid',txid_current()
    );
    v_row_hash := return_defense.sha256_jsonb(v_payload);
    v_chain_hash := return_defense.sha256_text(
        coalesce(v_head.last_chain_hash,repeat('0',64)) || ':' || v_row_hash
    );

    INSERT INTO return_defense.audit_log(
        tenant_id,schema_name,table_name,operation,record_pk,old_data,new_data,
        changed_columns,actor_type,actor_id,request_id,correlation_id,source,
        row_hash,previous_hash,chain_hash
    ) VALUES(
        v_tenant,p_schema_name,p_table_name,p_operation,p_record_pk,p_old_data,p_new_data,
        p_changed_columns,p_actor_type,p_actor_id,p_request_id,p_correlation_id,p_source,
        v_row_hash,v_head.last_chain_hash,v_chain_hash
    ) RETURNING audit_id INTO v_audit_id;

    UPDATE return_defense.audit_chain_heads
    SET last_audit_id=v_audit_id,last_chain_hash=v_chain_hash,
        event_count=event_count+1,updated_at=clock_timestamp()
    WHERE tenant_id=v_tenant AND chain_key=p_chain_key;
    RETURN v_audit_id;
END;
$$;
REVOKE ALL ON FUNCTION return_defense.append_audit_event(uuid,text,text,text,text,jsonb,jsonb,jsonb,text[],text,uuid,uuid,uuid,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION return_defense.verify_audit_chain(p_tenant_id uuid,p_chain_key text)
RETURNS TABLE(is_valid boolean, checked_rows bigint, first_bad_audit_id bigint, expected_hash text, actual_hash text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,return_defense
AS $$
DECLARE r record; v_prev text:=NULL; v_expected text; v_count bigint:=0;
BEGIN
    PERFORM return_defense.assert_tenant_context(p_tenant_id);
    FOR r IN SELECT audit_id,row_hash,previous_hash,chain_hash FROM return_defense.audit_log
             WHERE tenant_id=p_tenant_id ORDER BY audit_id
    LOOP
        v_count:=v_count+1;
        IF r.previous_hash IS DISTINCT FROM v_prev THEN
            RETURN QUERY SELECT false,v_count,r.audit_id,v_prev,r.previous_hash; RETURN;
        END IF;
        v_expected:=return_defense.sha256_text(coalesce(v_prev,repeat('0',64))||':'||r.row_hash);
        IF r.chain_hash IS DISTINCT FROM v_expected THEN
            RETURN QUERY SELECT false,v_count,r.audit_id,v_expected,r.chain_hash; RETURN;
        END IF;
        v_prev:=r.chain_hash;
    END LOOP;
    RETURN QUERY SELECT true,v_count,NULL::bigint,NULL::text,NULL::text;
END;
$$;
REVOKE ALL ON FUNCTION return_defense.verify_audit_chain(uuid,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION return_defense.audit_governed_row_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,return_defense AS $$
DECLARE v_tenant uuid; v_pk jsonb; v_old jsonb; v_new jsonb; v_op text;
BEGIN
    v_old:=CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN to_jsonb(OLD) END;
    v_new:=CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN to_jsonb(NEW) END;
    v_tenant:=COALESCE((v_new->>'tenant_id')::uuid,(v_old->>'tenant_id')::uuid,return_defense.current_tenant_id());
    v_pk:=jsonb_build_object('identity',COALESCE(v_new,v_old));
    v_op:=TG_OP;
    PERFORM return_defense.append_audit_event(v_tenant,'GOVERNANCE',TG_TABLE_SCHEMA,TG_TABLE_NAME,v_op,
        v_pk,v_old,v_new,NULL,current_setting('app.actor_type',true),return_defense.current_actor_id(),
        NULL,return_defense.current_correlation_id(),'DATABASE_TRIGGER');
    RETURN COALESCE(NEW,OLD);
END;
$$;
REVOKE ALL ON FUNCTION return_defense.audit_governed_row_change() FROM PUBLIC;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['policy_versions','model_versions','risk_thresholds','reason_code_catalog','control_definitions']
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%I_audit ON return_defense.%I',t,t);
    EXECUTE format('CREATE TRIGGER trg_%I_audit AFTER INSERT OR UPDATE OR DELETE ON return_defense.%I FOR EACH ROW EXECUTE FUNCTION return_defense.audit_governed_row_change()',t,t);
  END LOOP;
END$$;

-- ---------------------------------------------------------------------------
-- Recreate tenant-scoped SECURITY DEFINER APIs without caller-supplied tenant
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION return_defense.claim_idempotency_key(
    p_operation_scope text,p_idempotency_key text,p_request_payload jsonb,
    p_ttl interval,p_correlation_id uuid
) RETURNS TABLE(disposition text,idempotency_id uuid,owner_token uuid,status text,response_payload jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,return_defense AS $$
DECLARE v_tenant uuid:=return_defense.current_tenant_id(); v_hash text; v_row return_defense.idempotency_keys;
BEGIN
    IF p_correlation_id IS DISTINCT FROM return_defense.current_correlation_id() THEN RAISE EXCEPTION 'Correlation context mismatch' USING ERRCODE='42501'; END IF;
    IF p_ttl<=interval '0 seconds' OR p_ttl>interval '7 days' THEN RAISE EXCEPTION 'TTL must be >0 and <=7 days' USING ERRCODE='22023'; END IF;
    v_hash:=return_defense.sha256_jsonb(return_defense.require_object_json(p_request_payload,'request payload'));
    INSERT INTO return_defense.idempotency_keys(tenant_id,operation_scope,idempotency_key,request_hash,expires_at,correlation_id)
    VALUES(v_tenant,p_operation_scope,p_idempotency_key,v_hash,clock_timestamp()+p_ttl,p_correlation_id)
    ON CONFLICT(tenant_id,operation_scope,idempotency_key) DO NOTHING RETURNING * INTO v_row;
    IF FOUND THEN RETURN QUERY SELECT 'CLAIMED',v_row.idempotency_id,v_row.owner_token,v_row.status,v_row.response_payload; RETURN; END IF;
    SELECT * INTO v_row FROM return_defense.idempotency_keys WHERE tenant_id=v_tenant AND operation_scope=p_operation_scope AND idempotency_key=p_idempotency_key FOR UPDATE;
    IF v_row.request_hash<>v_hash THEN RAISE EXCEPTION 'Idempotency key reused with different request payload' USING ERRCODE='23505'; END IF;
    IF v_row.status='COMPLETED' THEN RETURN QUERY SELECT 'REPLAY',v_row.idempotency_id,v_row.owner_token,v_row.status,v_row.response_payload; RETURN; END IF;
    IF v_row.expires_at<=clock_timestamp() AND v_row.status IN('CLAIMED','PROCESSING','FAILED','EXPIRED') THEN
      UPDATE return_defense.idempotency_keys SET status='CLAIMED',owner_token=gen_random_uuid(),claimed_at=clock_timestamp(),heartbeat_at=clock_timestamp(),expires_at=clock_timestamp()+p_ttl,completed_at=NULL,response_code=NULL,response_payload=NULL,response_hash=NULL,error_class=NULL,error_summary=NULL,correlation_id=p_correlation_id WHERE idempotency_id=v_row.idempotency_id RETURNING * INTO v_row;
      RETURN QUERY SELECT 'RECLAIMED',v_row.idempotency_id,v_row.owner_token,v_row.status,v_row.response_payload; RETURN;
    END IF;
    RETURN QUERY SELECT 'IN_PROGRESS',v_row.idempotency_id,v_row.owner_token,v_row.status,v_row.response_payload;
END;
$$;
REVOKE ALL ON FUNCTION return_defense.claim_idempotency_key(text,text,jsonb,interval,uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION return_defense.append_domain_event(
    p_aggregate_type text,p_aggregate_id text,p_event_type text,p_event_payload jsonb,
    p_metadata jsonb,p_correlation_id uuid,p_idempotency_key text DEFAULT NULL,
    p_actor_type text DEFAULT 'SYSTEM',p_actor_id uuid DEFAULT NULL,p_topic text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,return_defense AS $$
DECLARE v_tenant uuid:=return_defense.current_tenant_id(); v_event_id uuid;
BEGIN
    IF p_correlation_id IS DISTINCT FROM return_defense.current_correlation_id() THEN RAISE EXCEPTION 'Correlation context mismatch' USING ERRCODE='42501'; END IF;
    INSERT INTO return_defense.domain_events(tenant_id,aggregate_type,aggregate_id,event_type,event_payload,metadata,correlation_id,idempotency_key,actor_type,actor_id)
    VALUES(v_tenant,p_aggregate_type,p_aggregate_id,p_event_type,return_defense.require_object_json(p_event_payload,'event payload'),return_defense.require_object_json(coalesce(p_metadata,'{}'),'metadata'),p_correlation_id,p_idempotency_key,p_actor_type,p_actor_id)
    RETURNING event_id INTO v_event_id;
    IF p_topic IS NOT NULL THEN
      INSERT INTO return_defense.outbox_events(tenant_id,domain_event_id,topic,partition_key,payload,headers)
      SELECT v_tenant,event_id,p_topic,p_aggregate_id,jsonb_build_object('event_id',event_id,'aggregate_type',aggregate_type,'aggregate_id',aggregate_id,'event_type',event_type,'event_version',event_version,'occurred_at',occurred_at,'payload',event_payload,'metadata',metadata,'correlation_id',correlation_id),jsonb_build_object('event_type',event_type,'correlation_id',correlation_id)
      FROM return_defense.domain_events WHERE event_id=v_event_id;
    END IF;
    RETURN v_event_id;
END;
$$;
REVOKE ALL ON FUNCTION return_defense.append_domain_event(text,text,text,jsonb,jsonb,uuid,text,text,uuid,text) FROM PUBLIC;

-- Remove obsolete tenant-parameter signatures to prevent accidental use.
DROP FUNCTION IF EXISTS return_defense.claim_idempotency_key(uuid,text,text,jsonb,interval,uuid);
DROP FUNCTION IF EXISTS return_defense.append_domain_event(uuid,text,text,text,jsonb,jsonb,uuid,text,text,uuid,text);

-- Controlled grants only when roles exist.
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='tcds_domain8_runtime') THEN
   GRANT EXECUTE ON FUNCTION return_defense.claim_idempotency_key(text,text,jsonb,interval,uuid) TO tcds_domain8_runtime;
   GRANT EXECUTE ON FUNCTION return_defense.complete_idempotency_key(uuid,uuid,text,jsonb) TO tcds_domain8_runtime;
   GRANT EXECUTE ON FUNCTION return_defense.append_domain_event(text,text,text,jsonb,jsonb,uuid,text,text,uuid,text) TO tcds_domain8_runtime;
 END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='tcds_domain8_worker') THEN
   GRANT EXECUTE ON FUNCTION return_defense.claim_idempotency_key(text,text,jsonb,interval,uuid) TO tcds_domain8_worker;
   GRANT EXECUTE ON FUNCTION return_defense.complete_idempotency_key(uuid,uuid,text,jsonb) TO tcds_domain8_worker;
   GRANT EXECUTE ON FUNCTION return_defense.append_domain_event(text,text,text,jsonb,jsonb,uuid,text,text,uuid,text) TO tcds_domain8_worker;
 END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='tcds_domain8_auditor') THEN
   GRANT EXECUTE ON FUNCTION return_defense.verify_audit_chain(uuid,text) TO tcds_domain8_auditor;
 END IF;
END$$;

COMMIT;
