-- TCDS Phase 3 Domain 8
-- File: 808_domain8_retention_partition_governance.sql
BEGIN;
SET LOCAL lock_timeout='10s'; SET LOCAL statement_timeout='20min';

CREATE TABLE IF NOT EXISTS return_defense.retention_policies(
 retention_policy_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL,
 data_class text NOT NULL, table_name text NOT NULL, hot_retention interval NOT NULL,
 archive_retention interval NOT NULL, purge_allowed boolean NOT NULL DEFAULT false,
 legal_hold_supported boolean NOT NULL DEFAULT true, archive_target text,
 partition_strategy text NOT NULL DEFAULT 'MONTHLY', active boolean NOT NULL DEFAULT true,
 policy_version_id uuid NOT NULL REFERENCES return_defense.policy_versions(policy_version_id),
 approved_by uuid NOT NULL, approved_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(tenant_id,table_name), CHECK(hot_retention>interval '0'), CHECK(archive_retention>=hot_retention),
 CHECK(partition_strategy IN('NONE','MONTHLY','QUARTERLY','YEARLY'))
);
CREATE TABLE IF NOT EXISTS return_defense.legal_holds(
 legal_hold_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,hold_key text NOT NULL,
 scope_type text NOT NULL,scope_id text NOT NULL,reason text NOT NULL,status text NOT NULL DEFAULT 'ACTIVE',
 imposed_by uuid NOT NULL,imposed_at timestamptz NOT NULL DEFAULT clock_timestamp(),released_by uuid,released_at timestamptz,
 UNIQUE(tenant_id,hold_key),CHECK(status IN('ACTIVE','RELEASED')),CHECK((status='RELEASED' AND released_by IS NOT NULL AND released_at IS NOT NULL) OR status='ACTIVE')
);
CREATE TABLE IF NOT EXISTS return_defense.retention_runs(
 retention_run_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,table_name text NOT NULL,
 mode text NOT NULL,status text NOT NULL DEFAULT 'RUNNING',cutoff_at timestamptz NOT NULL,rows_examined bigint NOT NULL DEFAULT 0,
 rows_archived bigint NOT NULL DEFAULT 0,rows_deleted bigint NOT NULL DEFAULT 0,started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 completed_at timestamptz,error_summary text,correlation_id uuid NOT NULL,
 CHECK(mode IN('REPORT','ARCHIVE','PURGE')),CHECK(status IN('RUNNING','COMPLETED','FAILED'))
);
ALTER TABLE return_defense.retention_policies ENABLE ROW LEVEL SECURITY; ALTER TABLE return_defense.retention_policies FORCE ROW LEVEL SECURITY;
ALTER TABLE return_defense.legal_holds ENABLE ROW LEVEL SECURITY; ALTER TABLE return_defense.legal_holds FORCE ROW LEVEL SECURITY;
ALTER TABLE return_defense.retention_runs ENABLE ROW LEVEL SECURITY; ALTER TABLE return_defense.retention_runs FORCE ROW LEVEL SECURITY;
DO $$DECLARE t text;BEGIN FOREACH t IN ARRAY ARRAY['retention_policies','legal_holds','retention_runs'] LOOP EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_%I ON return_defense.%I',t,t); EXECUTE format('CREATE POLICY tenant_isolation_%I ON return_defense.%I USING (tenant_id=return_defense.current_tenant_id()) WITH CHECK (tenant_id=return_defense.current_tenant_id())',t,t); END LOOP;END$$;

CREATE OR REPLACE VIEW return_defense.v_retention_partition_readiness AS
SELECT p.tenant_id,p.table_name,p.partition_strategy,p.hot_retention,p.archive_retention,p.purge_allowed,
       c.relkind, c.relispartition,
       CASE WHEN p.partition_strategy='NONE' THEN 'NOT_REQUIRED' WHEN c.relkind='p' THEN 'READY' ELSE 'PLANNED_NOT_CONVERTED' END AS readiness
FROM return_defense.retention_policies p LEFT JOIN pg_class c ON c.oid=to_regclass('return_defense.'||quote_ident(p.table_name));

CREATE OR REPLACE FUNCTION return_defense.retention_eligibility_report(p_table_name text,p_cutoff timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,return_defense AS $$
DECLARE v_tenant uuid:=return_defense.current_tenant_id(); v_count bigint; v_sql text;
BEGIN
 IF p_table_name NOT IN('domain_events','outbox_events','audit_log','idempotency_keys') THEN RAISE EXCEPTION 'Table not retention-managed' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT 1 FROM return_defense.legal_holds WHERE tenant_id=v_tenant AND status='ACTIVE' AND scope_type='TENANT') THEN RETURN jsonb_build_object('eligible',false,'reason','ACTIVE_TENANT_LEGAL_HOLD'); END IF;
 v_sql:=format('SELECT count(*) FROM return_defense.%I WHERE tenant_id=$1 AND created_at<$2',p_table_name);
 IF p_table_name='domain_events' THEN v_sql:=format('SELECT count(*) FROM return_defense.%I WHERE tenant_id=$1 AND recorded_at<$2',p_table_name); END IF;
 IF p_table_name='audit_log' THEN v_sql:=format('SELECT count(*) FROM return_defense.%I WHERE tenant_id=$1 AND occurred_at<$2',p_table_name); END IF;
 EXECUTE v_sql INTO v_count USING v_tenant,p_cutoff;
 RETURN jsonb_build_object('eligible',true,'table',p_table_name,'cutoff',p_cutoff,'candidate_rows',v_count,'destructive_action_performed',false);
END$$;
REVOKE ALL ON FUNCTION return_defense.retention_eligibility_report(text,timestamptz) FROM PUBLIC;

-- This foundation intentionally reports and archives only; destructive purge is deferred until
-- legal-hold linkage and external archive verification are implemented in a later certified slice.
COMMIT;
