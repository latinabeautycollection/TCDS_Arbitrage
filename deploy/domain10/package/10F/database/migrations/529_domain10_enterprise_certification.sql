-- ============================================================================
-- TCDS DOMAIN 10 / SLICE 10F
-- Enterprise Certification, Replay Verification & Release Evidence
--
-- 10F DOES NOT deploy, send Email/SMS, choose notification policy, acknowledge
-- incidents, execute escalations, or calculate SLOs. It certifies evidence that
-- 10A-10E already produced.
-- ============================================================================
BEGIN;

CREATE TABLE operations.domain10_certification_profiles_10f(
  profile_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_key text NOT NULL UNIQUE CHECK(profile_key~'^[A-Z0-9_]+$'),
  description text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TRIGGER trg_domain10_certification_profile_updated_10f
BEFORE UPDATE ON operations.domain10_certification_profiles_10f
FOR EACH ROW EXECUTE FUNCTION operations.set_updated_at();

CREATE TABLE operations.domain10_certification_profile_versions_10f(
  profile_id uuid NOT NULL REFERENCES operations.domain10_certification_profiles_10f(profile_id),
  version integer NOT NULL CHECK(version>0),
  lifecycle_state text NOT NULL DEFAULT 'DRAFT' CHECK(lifecycle_state IN('DRAFT','FROZEN','RETIRED')),
  settlement_grace_seconds integer NOT NULL DEFAULT 300 CHECK(settlement_grace_seconds BETWEEN 0 AND 86400),
  definition_hash text,
  frozen_at timestamptz,
  frozen_by text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(profile_id,version),
  CHECK(lifecycle_state='DRAFT' OR (definition_hash IS NOT NULL AND frozen_at IS NOT NULL AND frozen_by IS NOT NULL))
);

CREATE TABLE operations.domain10_certification_profile_checks_10f(
  profile_id uuid NOT NULL,
  profile_version integer NOT NULL,
  check_key text NOT NULL CHECK(check_key IN(
    'STRUCTURAL_10A_CORE','STRUCTURAL_10B_CORE','STRUCTURAL_10C_CORE',
    'STRUCTURAL_10D_CORE','STRUCTURAL_10E_CORE','AUDIT_HASH_CHAIN',
    'DECISION_POLICY_REPLAY','DELIVERY_PLAN_INTEGRITY','GRAPH_ACCEPTANCE_SEMANTICS',
    'UNKNOWN_OUTCOME_RECONCILIATION','TELNYX_FINAL_EVIDENCE',
    'INCIDENT_REQUIRED_LINKAGE','ACK_DEADLINE_INTEGRITY','ESCALATION_SETTLEMENT_INTEGRITY',
    'ASSURANCE_RESULT_INTEGRITY','ASSURANCE_EPISODE_INTEGRITY','ASSURANCE_EVENT_LINKAGE',
    'PUBLIC_EXECUTE_LOCKDOWN'
  )),
  required boolean NOT NULL DEFAULT true,
  minimum_sample_size integer NOT NULL DEFAULT 0 CHECK(minimum_sample_size BETWEEN 0 AND 10000000),
  ordinal integer NOT NULL CHECK(ordinal>0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(profile_id,profile_version,check_key),
  UNIQUE(profile_id,profile_version,ordinal),
  FOREIGN KEY(profile_id,profile_version)
    REFERENCES operations.domain10_certification_profile_versions_10f(profile_id,version) ON DELETE CASCADE
);

CREATE TABLE operations.domain10_certification_profile_attestations_10f(
  profile_id uuid NOT NULL,
  profile_version integer NOT NULL,
  attestation_type text NOT NULL CHECK(attestation_type IN(
    'POSTGRES_MIGRATION_SUITE_PASS','PRODUCTION_ROOT_NPM_CI_PASS','PRODUCTION_ROOT_BUILD_PASS',
    'PRODUCTION_ROOT_JEST_PASS','OUTBOX_SKIP_LOCKED_CONCURRENCY_PASS',
    'GRAPH_LIVE_DELIVERY_DRILL_PASS','TELNYX_LIVE_DELIVERY_DRILL_PASS',
    'SMS_STOP_BEFORE_SEND_DRILL_PASS','INCIDENT_ACK_ESCALATION_DRILL_PASS',
    'ASSURANCE_BREACH_RECOVERY_DRILL_PASS','REPOSITORY_COLLISION_PREFLIGHT_PASS'
  )),
  required boolean NOT NULL DEFAULT true,
  ordinal integer NOT NULL CHECK(ordinal>0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(profile_id,profile_version,attestation_type),
  UNIQUE(profile_id,profile_version,ordinal),
  FOREIGN KEY(profile_id,profile_version)
    REFERENCES operations.domain10_certification_profile_versions_10f(profile_id,version) ON DELETE CASCADE
);

CREATE TABLE operations.domain10_certification_runs_10f(
  run_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL,
  profile_version integer NOT NULL,
  profile_key text NOT NULL,
  release_key text NOT NULL,
  git_commit_sha text NOT NULL CHECK(git_commit_sha~'^[0-9a-fA-F]{40}$'),
  environment text NOT NULL CHECK(environment IN('CERTIFICATION','STAGING','PRODUCTION')),
  window_start timestamptz NOT NULL,
  window_end timestamptz NOT NULL,
  requested_by text NOT NULL,
  request_id uuid NOT NULL,
  notes text,
  state text NOT NULL DEFAULT 'CREATED'
    CHECK(state IN('CREATED','RUNNING','AWAITING_ATTESTATIONS','CERTIFIED','REJECTED','ERROR')),
  schema_fingerprint text NOT NULL,
  input_hash text NOT NULL UNIQUE,
  run_hash text,
  started_at timestamptz,
  completed_at timestamptz,
  certified_at timestamptz,
  certified_by text,
  finalized_by text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY(profile_id,profile_version)
    REFERENCES operations.domain10_certification_profile_versions_10f(profile_id,version),
  CHECK(window_end>window_start)
);
CREATE INDEX idx_domain10_certification_runs_10f_release
ON operations.domain10_certification_runs_10f(release_key,created_at DESC);

CREATE TABLE operations.domain10_certification_check_results_10f(
  result_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES operations.domain10_certification_runs_10f(run_id),
  check_key text NOT NULL,
  required boolean NOT NULL,
  outcome text NOT NULL CHECK(outcome IN('PASS','FAIL','INCONCLUSIVE','ERROR')),
  sample_size bigint NOT NULL DEFAULT 0 CHECK(sample_size>=0),
  failure_count bigint NOT NULL DEFAULT 0 CHECK(failure_count>=0),
  details jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(details)='object'),
  result_hash text NOT NULL,
  evaluated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(run_id,check_key)
);

CREATE TABLE operations.domain10_certification_attestations_10f(
  attestation_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES operations.domain10_certification_runs_10f(run_id),
  attestation_type text NOT NULL,
  outcome text NOT NULL CHECK(outcome IN('PASS','FAIL')),
  evidence_sha256 text NOT NULL CHECK(evidence_sha256~'^[0-9a-f]{64}$'),
  evidence_reference text NOT NULL,
  attested_by text NOT NULL,
  tool_version text,
  notes text,
  attestation_hash text NOT NULL,
  attested_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(run_id,attestation_type)
);

-- ---------------------------------------------------------------------------
-- Frozen profile contract. Hash is DB-computed from the child check/attestation
-- contract. No arbitrary SQL is stored in configuration.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION operations.freeze_domain10_certification_profile_10f(
  p_profile_id uuid,p_version integer,p_actor text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=operations,pg_temp
AS $$
DECLARE v_hash text; v_state text;
BEGIN
  SELECT lifecycle_state INTO v_state
  FROM operations.domain10_certification_profile_versions_10f
  WHERE profile_id=p_profile_id AND version=p_version
  FOR UPDATE;
  IF v_state IS DISTINCT FROM 'DRAFT' THEN RAISE EXCEPTION '10F certification profile must be DRAFT to freeze'; END IF;

  IF NOT EXISTS(SELECT 1 FROM operations.domain10_certification_profile_checks_10f
                WHERE profile_id=p_profile_id AND profile_version=p_version) THEN
    RAISE EXCEPTION '10F certification profile has no checks';
  END IF;

  v_hash:=encode(extensions.digest(
    coalesce((SELECT string_agg(
      check_key||':'||required::text||':'||minimum_sample_size::text||':'||ordinal::text,
      '|' ORDER BY ordinal)
      FROM operations.domain10_certification_profile_checks_10f
      WHERE profile_id=p_profile_id AND profile_version=p_version),'')||E'\n'||
    coalesce((SELECT string_agg(
      attestation_type||':'||required::text||':'||ordinal::text,
      '|' ORDER BY ordinal)
      FROM operations.domain10_certification_profile_attestations_10f
      WHERE profile_id=p_profile_id AND profile_version=p_version),'')||E'\n'||
    (SELECT settlement_grace_seconds::text FROM operations.domain10_certification_profile_versions_10f
      WHERE profile_id=p_profile_id AND version=p_version),
    'sha256'),'hex');

  UPDATE operations.domain10_certification_profile_versions_10f
  SET lifecycle_state='FROZEN',definition_hash=v_hash,
      frozen_at=clock_timestamp(),frozen_by=p_actor
  WHERE profile_id=p_profile_id AND version=p_version;
  RETURN v_hash;
END $$;

CREATE OR REPLACE FUNCTION operations.guard_domain10_certification_profile_10f()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE st text;v_profile_id uuid;v_profile_version integer;
BEGIN
  IF TG_TABLE_NAME='domain10_certification_profile_versions_10f' THEN
    IF TG_OP='DELETE' THEN
      IF OLD.lifecycle_state IN('FROZEN','RETIRED') THEN
        RAISE EXCEPTION 'Frozen/retired 10F certification profile is immutable';
      END IF;
      RETURN OLD;
    END IF;

    IF OLD.lifecycle_state='FROZEN' THEN
      IF NEW.lifecycle_state='RETIRED'
         AND ROW(NEW.settlement_grace_seconds,NEW.definition_hash,NEW.frozen_at,NEW.frozen_by)
             IS NOT DISTINCT FROM
             ROW(OLD.settlement_grace_seconds,OLD.definition_hash,OLD.frozen_at,OLD.frozen_by)
      THEN RETURN NEW; END IF;
      RAISE EXCEPTION 'Frozen 10F certification profile is immutable';
    END IF;
    IF OLD.lifecycle_state='RETIRED' THEN
      RAISE EXCEPTION 'Retired 10F certification profile is immutable';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP='DELETE' THEN
    v_profile_id:=OLD.profile_id;v_profile_version:=OLD.profile_version;
  ELSE
    v_profile_id:=NEW.profile_id;v_profile_version:=NEW.profile_version;
  END IF;

  SELECT lifecycle_state INTO st
  FROM operations.domain10_certification_profile_versions_10f
  WHERE profile_id=v_profile_id AND version=v_profile_version;

  IF st IN('FROZEN','RETIRED') THEN
    RAISE EXCEPTION '10F frozen profile child configuration is immutable';
  END IF;

  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_guard_domain10_certification_profile_version_10f
BEFORE UPDATE OR DELETE ON operations.domain10_certification_profile_versions_10f
FOR EACH ROW EXECUTE FUNCTION operations.guard_domain10_certification_profile_10f();
CREATE TRIGGER trg_guard_domain10_certification_profile_checks_10f
BEFORE INSERT OR UPDATE OR DELETE ON operations.domain10_certification_profile_checks_10f
FOR EACH ROW EXECUTE FUNCTION operations.guard_domain10_certification_profile_10f();
CREATE TRIGGER trg_guard_domain10_certification_profile_attestations_10f
BEFORE INSERT OR UPDATE OR DELETE ON operations.domain10_certification_profile_attestations_10f
FOR EACH ROW EXECUTE FUNCTION operations.guard_domain10_certification_profile_10f();

-- ---------------------------------------------------------------------------
-- Schema fingerprint. 10F fingerprints prior-slice contracts but does not own
-- or modify them.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION operations.compute_domain10_schema_fingerprint_10f()
RETURNS text
LANGUAGE plpgsql
STABLE
AS $$
DECLARE v_material text;
BEGIN
  SELECT string_agg(x,'|' ORDER BY x) INTO v_material
  FROM (
    SELECT c.oid::regclass::text||':'||a.attname||':'||format_type(a.atttypid,a.atttypmod)||':'||a.attnotnull::text x
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
    WHERE n.nspname='operations'
      AND c.relname IN(
        'operational_events','notification_requests','notification_recipients','notification_deliveries',
        'delivery_attempts','notification_outbox','provider_receipts','dead_letters','sms_subscriptions','audit_ledger',
        'notification_decisions','notification_decision_candidates','delivery_reconciliation_tasks_10c',
        'incidents','incident_acknowledgements','incident_escalation_emissions_10d',
        'communication_assurance_runs_10e','communication_assurance_episodes_10e','communication_assurance_events_10e'
      )
    UNION ALL
    SELECT p.oid::regprocedure::text||':'||md5(pg_get_functiondef(p.oid))
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='operations'
      AND p.proname IN(
        'claim_notification_outbox','record_provider_acceptance','record_final_delivery',
        'resolve_authoritative_notification_policy','apply_telnyx_delivery_event_10c',
        'validate_incident_escalation_binding_for_event_10d','calculate_assurance_metric_10e',
        'mark_assurance_event_emitted_10e'
      )
  ) s;
  RETURN encode(extensions.digest(coalesce(v_material,''),'sha256'),'hex');
END $$;

-- ---------------------------------------------------------------------------
-- Begin idempotent certification run.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION operations.begin_domain10_certification_run_10f(
  p_profile_key text,p_profile_version integer,p_release_key text,p_git_commit_sha text,
  p_environment text,p_window_start timestamptz,p_window_end timestamptz,
  p_requested_by text,p_request_id uuid,p_notes text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=operations,pg_temp
AS $$
DECLARE v_profile_id uuid;v_schema text;v_input text;v_run uuid;v_state text;
BEGIN
  IF p_window_end<=p_window_start THEN RAISE EXCEPTION 'Invalid certification window'; END IF;
  IF p_git_commit_sha!~'^[0-9a-fA-F]{40}$' THEN RAISE EXCEPTION 'Invalid git commit SHA'; END IF;
  IF p_environment NOT IN('CERTIFICATION','STAGING','PRODUCTION') THEN RAISE EXCEPTION 'Invalid certification environment'; END IF;

  SELECT p.profile_id,v.lifecycle_state INTO v_profile_id,v_state
  FROM operations.domain10_certification_profiles_10f p
  JOIN operations.domain10_certification_profile_versions_10f v ON v.profile_id=p.profile_id
  WHERE p.profile_key=p_profile_key AND p.enabled AND v.version=p_profile_version;
  IF v_profile_id IS NULL OR v_state<>'FROZEN' THEN RAISE EXCEPTION '10F certification profile/version is not active FROZEN configuration'; END IF;

  v_schema:=operations.compute_domain10_schema_fingerprint_10f();
  v_input:=encode(extensions.digest(
    p_profile_key||'|'||p_profile_version::text||'|'||p_release_key||'|'||lower(p_git_commit_sha)||'|'||
    p_environment||'|'||p_window_start::text||'|'||p_window_end::text||'|'||v_schema,
    'sha256'),'hex');

  PERFORM pg_advisory_xact_lock(hashtext(v_input));
  SELECT run_id INTO v_run FROM operations.domain10_certification_runs_10f WHERE input_hash=v_input;
  IF v_run IS NOT NULL THEN RETURN v_run; END IF;

  INSERT INTO operations.domain10_certification_runs_10f(
    profile_id,profile_version,profile_key,release_key,git_commit_sha,environment,
    window_start,window_end,requested_by,request_id,notes,schema_fingerprint,input_hash
  ) VALUES(
    v_profile_id,p_profile_version,p_profile_key,p_release_key,lower(p_git_commit_sha),p_environment,
    p_window_start,p_window_end,p_requested_by,p_request_id,p_notes,v_schema,v_input
  ) RETURNING run_id INTO v_run;
  RETURN v_run;
END $$;

-- ---------------------------------------------------------------------------
-- One fixed check implementation. No dynamic SQL from configuration.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION operations.evaluate_domain10_certification_check_10f(
  p_run_id uuid,p_check_key text,p_minimum_sample_size integer
)
RETURNS TABLE(outcome text,sample_size bigint,failure_count bigint,details jsonb)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE r operations.domain10_certification_runs_10f%ROWTYPE;v_grace integer;v_sample bigint:=0;v_fail bigint:=0;v_details jsonb:='{}'::jsonb;v_event uuid;v_selected uuid;v_selected_ver integer;v_expected uuid;v_expected_ver integer;
BEGIN
  SELECT * INTO r FROM operations.domain10_certification_runs_10f WHERE run_id=p_run_id;
  IF NOT FOUND THEN RAISE EXCEPTION '10F certification run not found'; END IF;
  SELECT settlement_grace_seconds INTO v_grace
  FROM operations.domain10_certification_profile_versions_10f
  WHERE profile_id=r.profile_id AND version=r.profile_version;

  IF p_check_key='STRUCTURAL_10A_CORE' THEN
    v_sample:=8;
    v_fail:=(CASE WHEN to_regclass('operations.operational_events') IS NULL THEN 1 ELSE 0 END)+
            (CASE WHEN to_regclass('operations.notification_deliveries') IS NULL THEN 1 ELSE 0 END)+
            (CASE WHEN to_regclass('operations.delivery_attempts') IS NULL THEN 1 ELSE 0 END)+
            (CASE WHEN to_regclass('operations.audit_ledger') IS NULL THEN 1 ELSE 0 END)+
            (CASE WHEN to_regclass('operations.sms_subscriptions') IS NULL THEN 1 ELSE 0 END)+
            (CASE WHEN to_regprocedure('operations.claim_notification_outbox(text,text,integer,integer)') IS NULL THEN 1 ELSE 0 END)+
            (CASE WHEN to_regprocedure('operations.record_provider_acceptance(uuid,uuid,text,text,integer,jsonb)') IS NULL THEN 1 ELSE 0 END)+
            (CASE WHEN to_regprocedure('operations.record_final_delivery(uuid,text,text,jsonb,text,uuid)') IS NULL THEN 1 ELSE 0 END);

  ELSIF p_check_key='STRUCTURAL_10B_CORE' THEN
    v_sample:=5;
    v_fail:=(CASE WHEN to_regclass('operations.notification_decisions') IS NULL THEN 1 ELSE 0 END)+
            (CASE WHEN to_regclass('operations.notification_decision_candidates') IS NULL THEN 1 ELSE 0 END)+
            (CASE WHEN to_regclass('operations.event_planning_outbox') IS NULL THEN 1 ELSE 0 END)+
            (CASE WHEN to_regprocedure('operations.resolve_authoritative_notification_policy(uuid)') IS NULL THEN 1 ELSE 0 END)+
            (CASE WHEN to_regprocedure('operations.resolve_authorized_audience(uuid,text,text,timestamptz)') IS NULL THEN 1 ELSE 0 END);

  ELSIF p_check_key='STRUCTURAL_10C_CORE' THEN
    v_sample:=4;
    v_fail:=(CASE WHEN to_regclass('operations.delivery_reconciliation_tasks_10c') IS NULL THEN 1 ELSE 0 END)+
            (CASE WHEN to_regprocedure('operations.begin_delivery_execution_10c(uuid,text)') IS NULL THEN 1 ELSE 0 END)+
            (CASE WHEN to_regprocedure('operations.apply_telnyx_delivery_event_10c(text,text,text,timestamptz,text,jsonb,jsonb,uuid)') IS NULL THEN 1 ELSE 0 END)+
            (CASE WHEN to_regprocedure('operations.record_provider_acceptance_10c(uuid,uuid,text,text,text,integer,jsonb)') IS NULL THEN 1 ELSE 0 END);

  ELSIF p_check_key='STRUCTURAL_10D_CORE' THEN
    v_sample:=5;
    v_fail:=(CASE WHEN to_regclass('operations.incident_activation_queue_10d') IS NULL THEN 1 ELSE 0 END)+
            (CASE WHEN to_regclass('operations.incident_ack_deadlines_10d') IS NULL THEN 1 ELSE 0 END)+
            (CASE WHEN to_regclass('operations.incident_escalation_emissions_10d') IS NULL THEN 1 ELSE 0 END)+
            (CASE WHEN to_regprocedure('operations.apply_incident_command_10d(text,text,text,uuid,text,timestamptz,uuid,text)') IS NULL THEN 1 ELSE 0 END)+
            (CASE WHEN to_regprocedure('operations.validate_incident_escalation_binding_for_event_10d(uuid,text,text,timestamptz)') IS NULL THEN 1 ELSE 0 END);

  ELSIF p_check_key='STRUCTURAL_10E_CORE' THEN
    v_sample:=5;
    v_fail:=(CASE WHEN to_regclass('operations.communication_assurance_runs_10e') IS NULL THEN 1 ELSE 0 END)+
            (CASE WHEN to_regclass('operations.communication_assurance_episodes_10e') IS NULL THEN 1 ELSE 0 END)+
            (CASE WHEN to_regclass('operations.communication_assurance_events_10e') IS NULL THEN 1 ELSE 0 END)+
            (CASE WHEN to_regprocedure('operations.calculate_assurance_metric_10e(text,text,text,timestamptz,timestamptz,integer)') IS NULL THEN 1 ELSE 0 END)+
            (CASE WHEN to_regprocedure('operations.mark_assurance_event_emitted_10e(uuid,text,uuid)') IS NULL THEN 1 ELSE 0 END);

  ELSIF p_check_key='AUDIT_HASH_CHAIN' THEN
    WITH bounds AS(
      SELECT min(audit_id) min_id,max(audit_id) max_id FROM operations.audit_ledger WHERE occurred_at>=r.window_start AND occurred_at<r.window_end
    ),candidate AS(
      SELECT a.*,lag(record_hash) OVER(ORDER BY audit_id) expected_prev
      FROM operations.audit_ledger a,bounds b
      WHERE b.min_id IS NOT NULL AND a.audit_id BETWEEN greatest(1,b.min_id-1) AND b.max_id
    )
    SELECT count(*) FILTER(WHERE occurred_at>=r.window_start)::bigint,
           count(*) FILTER(WHERE occurred_at>=r.window_start AND previous_hash IS DISTINCT FROM expected_prev)::bigint
    INTO v_sample,v_fail FROM candidate;

  ELSIF p_check_key='DECISION_POLICY_REPLAY' THEN
    FOR v_event,v_selected,v_selected_ver IN
      SELECT d.event_id,d.selected_policy_id,d.selected_policy_version
      FROM operations.notification_decisions d
      WHERE d.decided_at>=r.window_start AND d.decided_at<r.window_end
    LOOP
      v_sample:=v_sample+1;v_expected:=NULL;v_expected_ver:=NULL;
      BEGIN
        SELECT policy_id,policy_version INTO v_expected,v_expected_ver
        FROM operations.resolve_authoritative_notification_policy(v_event);

        IF v_selected IS NULL THEN
          IF v_expected IS NOT NULL THEN v_fail:=v_fail+1; END IF;
        ELSIF v_expected IS DISTINCT FROM v_selected OR v_expected_ver IS DISTINCT FROM v_selected_ver THEN
          v_fail:=v_fail+1;
        END IF;
      EXCEPTION WHEN OTHERS THEN
        v_fail:=v_fail+1;
      END;
    END LOOP;

  ELSIF p_check_key='DELIVERY_PLAN_INTEGRITY' THEN
    SELECT count(*)::bigint,
           count(*) FILTER(WHERE NOT EXISTS(
             SELECT 1 FROM operations.notification_recipients nr
             WHERE nr.notification_id=d.notification_id AND nr.recipient_id=d.recipient_id
           ) OR NOT EXISTS(
             SELECT 1 FROM operations.notification_outbox o WHERE o.delivery_id=d.delivery_id
           ))::bigint
    INTO v_sample,v_fail
    FROM operations.notification_deliveries d
    WHERE d.created_at>=r.window_start AND d.created_at<r.window_end;

  ELSIF p_check_key='GRAPH_ACCEPTANCE_SEMANTICS' THEN
    SELECT count(*)::bigint,
           count(*) FILTER(WHERE NOT operations.assert_graph_not_delivery_confirmed_by_202_10c(d.delivery_id))::bigint
    INTO v_sample,v_fail
    FROM operations.notification_deliveries d
    WHERE d.provider='MICROSOFT_GRAPH' AND d.created_at>=r.window_start AND d.created_at<r.window_end;

  ELSIF p_check_key='UNKNOWN_OUTCOME_RECONCILIATION' THEN
    SELECT count(*)::bigint,
           count(*) FILTER(WHERE NOT EXISTS(
             SELECT 1 FROM operations.delivery_reconciliation_tasks_10c t WHERE t.delivery_id=d.delivery_id
           ))::bigint
    INTO v_sample,v_fail
    FROM operations.notification_deliveries d
    WHERE d.state='UNKNOWN_PROVIDER_OUTCOME' AND d.created_at>=r.window_start AND d.created_at<r.window_end;

  ELSIF p_check_key='TELNYX_FINAL_EVIDENCE' THEN
    SELECT count(*)::bigint,
           count(*) FILTER(WHERE NOT EXISTS(
             SELECT 1 FROM operations.provider_receipts pr
             WHERE pr.delivery_id=d.delivery_id AND pr.provider='TELNYX'
               AND pr.evidence_source='TELNYX_DELIVERY_WEBHOOK'
               AND pr.evidence_verified AND pr.provider_status='delivered'
           ))::bigint
    INTO v_sample,v_fail
    FROM operations.notification_deliveries d
    WHERE d.provider='TELNYX' AND d.state='DELIVERED'
      AND d.delivered_at>=r.window_start AND d.delivered_at<r.window_end;

  ELSIF p_check_key='INCIDENT_REQUIRED_LINKAGE' THEN
    SELECT count(*)::bigint,
           count(*) FILTER(WHERE NOT EXISTS(
             SELECT 1 FROM operations.incidents i WHERE i.notification_id=n.notification_id
           ))::bigint
    INTO v_sample,v_fail
    FROM operations.notification_requests n
    WHERE n.incident_required AND n.created_at>=r.window_start
      AND n.created_at<r.window_end-make_interval(secs=>v_grace);

  ELSIF p_check_key='ACK_DEADLINE_INTEGRITY' THEN
    SELECT count(*)::bigint,
           count(*) FILTER(WHERE ad.deadline_id IS NULL OR ad.due_at IS DISTINCT FROM n.acknowledgement_due_at)::bigint
    INTO v_sample,v_fail
    FROM operations.notification_requests n
    JOIN operations.incidents i ON i.notification_id=n.notification_id
    LEFT JOIN operations.incident_ack_deadlines_10d ad ON ad.incident_id=i.incident_id
    WHERE n.acknowledgement_required
      AND n.created_at>=r.window_start AND n.created_at<r.window_end-make_interval(secs=>v_grace);

  ELSIF p_check_key='ESCALATION_SETTLEMENT_INTEGRITY' THEN
    SELECT count(*)::bigint,
           count(*) FILTER(WHERE outcome IS NULL OR operational_event_id IS NULL OR notification_id IS NULL)::bigint
    INTO v_sample,v_fail
    FROM operations.incident_escalation_emissions_10d e
    WHERE e.state='SETTLED' AND e.settled_at>=r.window_start AND e.settled_at<r.window_end;

  ELSIF p_check_key='ASSURANCE_RESULT_INTEGRITY' THEN
    SELECT count(*)::bigint,
           count(*) FILTER(WHERE result_hash IS NULL OR evaluated_at IS NULL OR outcome IS NULL)::bigint
    INTO v_sample,v_fail
    FROM operations.communication_assurance_runs_10e a
    WHERE a.state='COMPLETE' AND a.evaluated_at>=r.window_start AND a.evaluated_at<r.window_end;

  ELSIF p_check_key='ASSURANCE_EPISODE_INTEGRITY' THEN
    SELECT count(*)::bigint,
           count(*) FILTER(WHERE ro.outcome IS DISTINCT FROM 'BREACH'
             OR (e.state='RECOVERED' AND rr.outcome IS DISTINCT FROM 'PASS'))::bigint
    INTO v_sample,v_fail
    FROM operations.communication_assurance_episodes_10e e
    JOIN operations.communication_assurance_runs_10e ro ON ro.run_id=e.opened_run_id
    LEFT JOIN operations.communication_assurance_runs_10e rr ON rr.run_id=e.recovered_run_id
    WHERE e.created_at>=r.window_start AND e.created_at<r.window_end;

  ELSIF p_check_key='ASSURANCE_EVENT_LINKAGE' THEN
    SELECT count(*)::bigint,
           count(*) FILTER(WHERE ae.operational_event_id IS NULL OR os.source_key IS DISTINCT FROM 'DOMAIN10_ASSURANCE'
             OR oe.source_event_id IS DISTINCT FROM ae.source_event_id OR oe.event_type IS DISTINCT FROM ae.event_type)::bigint
    INTO v_sample,v_fail
    FROM operations.communication_assurance_events_10e ae
    LEFT JOIN operations.operational_events oe ON oe.event_id=ae.operational_event_id
    LEFT JOIN operations.event_sources os ON os.source_id=oe.source_id
    WHERE ae.state='EMITTED' AND ae.emitted_at>=r.window_start AND ae.emitted_at<r.window_end;

  ELSIF p_check_key='PUBLIC_EXECUTE_LOCKDOWN' THEN
    v_sample:=8;
    SELECT count(*)::bigint INTO v_fail
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='operations'
      AND p.oid::regprocedure::text IN(
        'operations.record_sms_consent_event(text,text,text,text,timestamp with time zone,text,uuid,text,text)',
        'operations.record_provider_acceptance_10c(uuid,uuid,text,text,text,integer,jsonb)',
        'operations.apply_telnyx_delivery_event_10c(text,text,text,timestamp with time zone,text,jsonb,jsonb,uuid)',
        'operations.apply_incident_command_10d(text,text,text,uuid,text,timestamp with time zone,uuid,text)',
        'operations.prepare_escalation_emission_10d(uuid,text)',
        'operations.evaluate_assurance_run_10e(uuid,text)',
        'operations.mark_assurance_event_emitted_10e(uuid,text,uuid)',
        'operations.claim_notification_outbox(text,text,integer,integer)'
      )
      AND EXISTS(
        SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
        WHERE acl.grantee=0 AND acl.privilege_type='EXECUTE'
      );

  ELSE
    RETURN QUERY SELECT 'ERROR'::text,0::bigint,1::bigint,jsonb_build_object('error','unsupported check key');RETURN;
  END IF;

  v_details:=jsonb_build_object('check_key',p_check_key,'minimum_sample_size',p_minimum_sample_size);
  IF v_fail>0 THEN
    RETURN QUERY SELECT 'FAIL'::text,v_sample,v_fail,v_details;
  ELSIF v_sample<p_minimum_sample_size THEN
    RETURN QUERY SELECT 'INCONCLUSIVE'::text,v_sample,0::bigint,v_details;
  ELSE
    RETURN QUERY SELECT 'PASS'::text,v_sample,0::bigint,v_details;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION operations.execute_domain10_certification_run_10f(
  p_run_id uuid,p_actor text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=operations,pg_temp
AS $$
DECLARE r operations.domain10_certification_runs_10f%ROWTYPE;c record;res record;v_err text;
BEGIN
  SELECT * INTO r FROM operations.domain10_certification_runs_10f WHERE run_id=p_run_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '10F certification run not found'; END IF;
  IF r.state IN('CERTIFIED','REJECTED','ERROR') THEN RETURN; END IF;
  IF r.state NOT IN('CREATED','RUNNING') THEN RAISE EXCEPTION '10F certification run is not executable'; END IF;

  UPDATE operations.domain10_certification_runs_10f
  SET state='RUNNING',started_at=coalesce(started_at,clock_timestamp())
  WHERE run_id=p_run_id;

  FOR c IN
    SELECT * FROM operations.domain10_certification_profile_checks_10f
    WHERE profile_id=r.profile_id AND profile_version=r.profile_version ORDER BY ordinal
  LOOP
    BEGIN
      SELECT * INTO res
      FROM operations.evaluate_domain10_certification_check_10f(
        p_run_id,c.check_key,c.minimum_sample_size
      );
    EXCEPTION WHEN OTHERS THEN
      v_err:=SQLSTATE||':'||SQLERRM;
      res.outcome:='ERROR';res.sample_size:=0;res.failure_count:=1;
      res.details:=jsonb_build_object('check_key',c.check_key,'error',left(v_err,1000));
    END;

    INSERT INTO operations.domain10_certification_check_results_10f(
      run_id,check_key,required,outcome,sample_size,failure_count,details,result_hash
    ) VALUES(
      p_run_id,c.check_key,c.required,res.outcome,res.sample_size,res.failure_count,res.details,
      encode(extensions.digest(c.check_key||'|'||res.outcome||'|'||res.sample_size::text||'|'||res.failure_count::text||'|'||res.details::text,'sha256'),'hex')
    ) ON CONFLICT(run_id,check_key) DO NOTHING;
  END LOOP;

  UPDATE operations.domain10_certification_runs_10f
  SET state='AWAITING_ATTESTATIONS'
  WHERE run_id=p_run_id;
END $$;

CREATE OR REPLACE FUNCTION operations.record_domain10_certification_attestation_10f(
  p_run_id uuid,p_attestation_type text,p_outcome text,p_evidence_sha256 text,
  p_evidence_reference text,p_attested_by text,p_tool_version text DEFAULT NULL,p_notes text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=operations,pg_temp
AS $$
DECLARE r operations.domain10_certification_runs_10f%ROWTYPE;v_required boolean;v_id uuid;v_hash text;
BEGIN
  SELECT * INTO r FROM operations.domain10_certification_runs_10f WHERE run_id=p_run_id FOR UPDATE;
  IF NOT FOUND OR r.state<>'AWAITING_ATTESTATIONS' THEN RAISE EXCEPTION '10F run does not accept attestations'; END IF;
  SELECT required INTO v_required FROM operations.domain10_certification_profile_attestations_10f
  WHERE profile_id=r.profile_id AND profile_version=r.profile_version AND attestation_type=p_attestation_type;
  IF v_required IS NULL THEN RAISE EXCEPTION 'Attestation type is not part of frozen 10F profile'; END IF;
  IF p_outcome NOT IN('PASS','FAIL') OR p_evidence_sha256!~'^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'Invalid 10F attestation'; END IF;

  v_hash:=encode(extensions.digest(
    p_run_id::text||'|'||p_attestation_type||'|'||p_outcome||'|'||p_evidence_sha256||'|'||
    p_evidence_reference||'|'||p_attested_by||'|'||coalesce(p_tool_version,'')||'|'||coalesce(p_notes,''),
    'sha256'),'hex');

  INSERT INTO operations.domain10_certification_attestations_10f(
    run_id,attestation_type,outcome,evidence_sha256,evidence_reference,attested_by,tool_version,notes,attestation_hash
  ) VALUES(p_run_id,p_attestation_type,p_outcome,p_evidence_sha256,p_evidence_reference,p_attested_by,p_tool_version,p_notes,v_hash)
  RETURNING attestation_id INTO v_id;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION operations.finalize_domain10_certification_run_10f(
  p_run_id uuid,p_actor text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=operations,pg_temp
AS $$
DECLARE r operations.domain10_certification_runs_10f%ROWTYPE;v_check_fail integer;v_check_inc integer;v_missing integer;v_att_fail integer;v_run_hash text;v_state text;
BEGIN
  SELECT * INTO r FROM operations.domain10_certification_runs_10f WHERE run_id=p_run_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '10F certification run not found'; END IF;
  IF r.state IN('CERTIFIED','REJECTED') THEN RETURN; END IF;
  IF r.state<>'AWAITING_ATTESTATIONS' THEN RAISE EXCEPTION '10F certification run is not ready to finalize'; END IF;

  SELECT count(*) FILTER(WHERE required AND outcome IN('FAIL','ERROR')),
         count(*) FILTER(WHERE required AND outcome='INCONCLUSIVE')
  INTO v_check_fail,v_check_inc
  FROM operations.domain10_certification_check_results_10f WHERE run_id=p_run_id;

  SELECT count(*) INTO v_missing
  FROM operations.domain10_certification_profile_attestations_10f pa
  WHERE pa.profile_id=r.profile_id AND pa.profile_version=r.profile_version AND pa.required
    AND NOT EXISTS(
      SELECT 1 FROM operations.domain10_certification_attestations_10f a
      WHERE a.run_id=p_run_id AND a.attestation_type=pa.attestation_type
    );

  IF v_missing>0 THEN
    RAISE EXCEPTION '10F certification still requires % attestation(s)',v_missing;
  END IF;

  SELECT count(*) INTO v_att_fail
  FROM operations.domain10_certification_attestations_10f
  WHERE run_id=p_run_id AND outcome='FAIL';

  v_state:=CASE
    WHEN v_check_fail=0 AND v_check_inc=0 AND v_att_fail=0 THEN 'CERTIFIED'
    ELSE 'REJECTED'
  END;

  v_run_hash:=encode(extensions.digest(
    r.input_hash||'|'||r.schema_fingerprint||'|'||
    coalesce((SELECT string_agg(result_hash,'|' ORDER BY check_key)
              FROM operations.domain10_certification_check_results_10f WHERE run_id=p_run_id),'')||'|'||
    coalesce((SELECT string_agg(attestation_hash,'|' ORDER BY attestation_type)
              FROM operations.domain10_certification_attestations_10f WHERE run_id=p_run_id),''),
    'sha256'),'hex');

  UPDATE operations.domain10_certification_runs_10f
  SET state=v_state,run_hash=v_run_hash,completed_at=clock_timestamp(),finalized_by=p_actor,
      certified_at=CASE WHEN v_state='CERTIFIED' THEN clock_timestamp() ELSE NULL END,
      certified_by=CASE WHEN v_state='CERTIFIED' THEN p_actor ELSE NULL END
  WHERE run_id=p_run_id;
END $$;

CREATE VIEW operations.domain10_certification_summary_10f AS
SELECT r.run_id,r.profile_key,r.profile_version,r.release_key,r.git_commit_sha,r.environment,
       r.window_start,r.window_end,r.state,r.schema_fingerprint,r.run_hash,r.certified_at,
       coalesce(c.automated_pass,0) AS automated_pass,
       coalesce(c.automated_fail,0) AS automated_fail,
       coalesce(c.automated_inconclusive,0) AS automated_inconclusive,
       coalesce(pa.required_attestations,0) AS required_attestations,
       coalesce(a.passed_attestations,0) AS passed_attestations,
       coalesce(a.failed_attestations,0) AS failed_attestations
FROM operations.domain10_certification_runs_10f r
LEFT JOIN LATERAL(
  SELECT count(*) FILTER(WHERE outcome='PASS') AS automated_pass,
         count(*) FILTER(WHERE outcome IN('FAIL','ERROR')) AS automated_fail,
         count(*) FILTER(WHERE outcome='INCONCLUSIVE') AS automated_inconclusive
  FROM operations.domain10_certification_check_results_10f cr
  WHERE cr.run_id=r.run_id
) c ON true
LEFT JOIN LATERAL(
  SELECT count(*) AS required_attestations
  FROM operations.domain10_certification_profile_attestations_10f x
  WHERE x.profile_id=r.profile_id AND x.profile_version=r.profile_version AND x.required
) pa ON true
LEFT JOIN LATERAL(
  SELECT count(*) FILTER(WHERE outcome='PASS') AS passed_attestations,
         count(*) FILTER(WHERE outcome='FAIL') AS failed_attestations
  FROM operations.domain10_certification_attestations_10f at
  WHERE at.run_id=r.run_id
) a ON true;

COMMENT ON TABLE operations.domain10_certification_runs_10f IS
'10F immutable release-certification evidence. CERTIFIED means the frozen Domain 10 certification profile passed; it does not itself deploy software.';

COMMIT;
