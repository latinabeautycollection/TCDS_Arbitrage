-- ============================================================================
-- TCDS DOMAIN 10 / SLICE 10F — IN-DEPTH ENTERPRISE REVIEW HARDENING
-- Migration 532
--
-- This migration keeps 10F a certification/evidence layer only.
-- It does not send Email/SMS, change notification policy, execute incidents,
-- mutate 10E SLO truth, or deploy software.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Expand the frozen profile vocabulary with certification-only checks.
-- ---------------------------------------------------------------------------
ALTER TABLE operations.domain10_certification_profile_checks_10f
  DROP CONSTRAINT IF EXISTS domain10_certification_profile_checks_10f_check_key_check;

ALTER TABLE operations.domain10_certification_profile_checks_10f
  ADD CONSTRAINT domain10_certification_profile_checks_10f_check_key_check
  CHECK(check_key IN(
    'STRUCTURAL_10A_CORE','STRUCTURAL_10B_CORE','STRUCTURAL_10C_CORE',
    'STRUCTURAL_10D_CORE','STRUCTURAL_10E_CORE','AUDIT_HASH_CHAIN',
    'DECISION_POLICY_REPLAY','DELIVERY_PLAN_INTEGRITY','GRAPH_ACCEPTANCE_SEMANTICS',
    'GRAPH_FINAL_DELIVERY_EVIDENCE','UNKNOWN_OUTCOME_RECONCILIATION',
    'TELNYX_FINAL_EVIDENCE','TELNYX_TERMINAL_FAILURE_EVIDENCE',
    'SMS_SEND_CONSENT_INTEGRITY',
    'INCIDENT_REQUIRED_LINKAGE','ACK_DEADLINE_INTEGRITY',
    'ESCALATION_SETTLEMENT_INTEGRITY','ASSURANCE_RESULT_INTEGRITY',
    'ASSURANCE_EPISODE_INTEGRITY','ASSURANCE_EVENT_LINKAGE',
    'PUBLIC_EXECUTE_LOCKDOWN'
  ));

DO $d$
DECLARE c text;
BEGIN
  FOR c IN SELECT conname FROM pg_constraint
    WHERE conrelid='operations.domain10_certification_profile_attestations_10f'::regclass
      AND contype='c' AND pg_get_constraintdef(oid) ILIKE '%attestation_type%'
  LOOP EXECUTE format('ALTER TABLE operations.domain10_certification_profile_attestations_10f DROP CONSTRAINT %I', c); END LOOP;
END $d$;

ALTER TABLE operations.domain10_certification_profile_attestations_10f
  ADD CONSTRAINT domain10_certification_profile_attestations_10f_attestation_type_check
  CHECK(attestation_type IN(
    'POSTGRES_MIGRATION_SUITE_PASS','PRODUCTION_ROOT_NPM_CI_PASS',
    'PRODUCTION_ROOT_BUILD_PASS','PRODUCTION_ROOT_JEST_PASS',
    'OUTBOX_SKIP_LOCKED_CONCURRENCY_PASS',
    'GRAPH_LIVE_DELIVERY_DRILL_PASS','TELNYX_LIVE_DELIVERY_DRILL_PASS',
    'SMS_STOP_BEFORE_SEND_DRILL_PASS','INCIDENT_ACK_ESCALATION_DRILL_PASS',
    'ASSURANCE_BREACH_RECOVERY_DRILL_PASS','REPOSITORY_COLLISION_PREFLIGHT_PASS',
    'GRAPH_EXCHANGE_RBAC_SCOPE_PASS',
    'GRAPH_UNSCOPED_ENTRA_MAILSEND_REMOVED_PASS',
    'GRAPH_CERTIFICATE_AUTH_EXPIRY_PASS',
    'EXCHANGE_FINAL_DELIVERY_RECONCILIATION_PASS',
    'TELNYX_WEBHOOK_SIGNATURE_VERIFICATION_PASS',
    'TELNYX_DUPLICATE_OUT_OF_ORDER_WEBHOOK_PASS',
    'SMS_START_STOP_HELP_COMPLIANCE_PASS',
    'TELNYX_10DLC_CAMPAIGN_ACTIVE_PASS'
  ));

ALTER TABLE operations.domain10_certification_profile_attestations_10f
  ADD COLUMN IF NOT EXISTS independent_attestor_required boolean NOT NULL DEFAULT false;

ALTER TABLE operations.domain10_certification_runs_10f
  ADD COLUMN IF NOT EXISTS profile_definition_hash text,
  ADD COLUMN IF NOT EXISTS security_fingerprint text,
  ADD COLUMN IF NOT EXISTS requester_db_role text NOT NULL DEFAULT session_user;

ALTER TABLE operations.domain10_certification_attestations_10f
  ADD COLUMN IF NOT EXISTS attestor_db_role text NOT NULL DEFAULT session_user;

-- ---------------------------------------------------------------------------
-- 2. Frozen-profile hash now includes separation-of-duty requirements.
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

  IF v_state IS DISTINCT FROM 'DRAFT' THEN
    RAISE EXCEPTION '10F certification profile must be DRAFT to freeze';
  END IF;

  IF NOT EXISTS(
    SELECT 1 FROM operations.domain10_certification_profile_checks_10f
    WHERE profile_id=p_profile_id AND profile_version=p_version
  ) THEN
    RAISE EXCEPTION '10F certification profile has no checks';
  END IF;

  v_hash:=encode(extensions.digest(
    coalesce((
      SELECT string_agg(
        check_key||':'||required::text||':'||
        minimum_sample_size::text||':'||ordinal::text,
        '|' ORDER BY ordinal
      )
      FROM operations.domain10_certification_profile_checks_10f
      WHERE profile_id=p_profile_id AND profile_version=p_version
    ),'')||E'\n'||
    coalesce((
      SELECT string_agg(
        attestation_type||':'||required::text||':'||
        independent_attestor_required::text||':'||ordinal::text,
        '|' ORDER BY ordinal
      )
      FROM operations.domain10_certification_profile_attestations_10f
      WHERE profile_id=p_profile_id AND profile_version=p_version
    ),'')||E'\n'||
    (
      SELECT settlement_grace_seconds::text
      FROM operations.domain10_certification_profile_versions_10f
      WHERE profile_id=p_profile_id AND version=p_version
    ),
    'sha256'
  ),'hex');

  UPDATE operations.domain10_certification_profile_versions_10f
  SET lifecycle_state='FROZEN',
      definition_hash=v_hash,
      frozen_at=clock_timestamp(),
      frozen_by=p_actor
  WHERE profile_id=p_profile_id AND version=p_version;

  RETURN v_hash;
END
$$;

-- Existing child guard must also protect the new attestation property.
-- The existing trigger already rejects all child mutations once FROZEN.

-- ---------------------------------------------------------------------------
-- 3. Stronger schema fingerprint:
--    columns + constraints + non-internal triggers + indexes + SHA-256 function
--    definitions across the prior Domain 10 contract.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION operations.compute_domain10_schema_fingerprint_10f()
RETURNS text
LANGUAGE plpgsql
STABLE
AS $$
DECLARE v_material text;
BEGIN
  WITH prior_tables(name) AS(
    VALUES
      ('operational_events'),('event_processing'),
      ('notification_requests'),('notification_recipients'),
      ('notification_deliveries'),('delivery_attempts'),
      ('notification_outbox'),('provider_receipts'),('dead_letters'),
      ('sms_subscriptions'),('sms_consent_events'),('audit_ledger'),
      ('notification_decisions'),('notification_decision_candidates'),
      ('delivery_reconciliation_tasks_10c'),
      ('incidents'),('incident_events'),('incident_assignments'),
      ('incident_acknowledgements'),('incident_escalations'),
      ('incident_escalation_executions'),
      ('incident_ack_deadlines_10d'),('incident_escalation_emissions_10d'),
      ('communication_assurance_runs_10e'),
      ('communication_assurance_episodes_10e'),
      ('communication_assurance_events_10e')
  ),
  material AS(
    SELECT 'COLUMN:'||c.relname||':'||a.attnum::text||':'||a.attname||':'||
           format_type(a.atttypid,a.atttypmod)||':'||a.attnotnull::text AS x
    FROM pg_class c
    JOIN pg_namespace n ON n.oid=c.relnamespace
    JOIN pg_attribute a ON a.attrelid=c.oid
    JOIN prior_tables t ON t.name=c.relname
    WHERE n.nspname='operations' AND a.attnum>0 AND NOT a.attisdropped

    UNION ALL

    SELECT 'CONSTRAINT:'||c.relname||':'||con.conname||':'||
           pg_get_constraintdef(con.oid,true)
    FROM pg_constraint con
    JOIN pg_class c ON c.oid=con.conrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace
    JOIN prior_tables t ON t.name=c.relname
    WHERE n.nspname='operations'

    UNION ALL

    SELECT 'TRIGGER:'||c.relname||':'||tr.tgname||':'||pg_get_triggerdef(tr.oid,true)
    FROM pg_trigger tr
    JOIN pg_class c ON c.oid=tr.tgrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace
    JOIN prior_tables t ON t.name=c.relname
    WHERE n.nspname='operations' AND NOT tr.tgisinternal

    UNION ALL

    SELECT 'INDEX:'||c.relname||':'||ic.relname||':'||pg_get_indexdef(i.indexrelid)
    FROM pg_index i
    JOIN pg_class c ON c.oid=i.indrelid
    JOIN pg_class ic ON ic.oid=i.indexrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace
    JOIN prior_tables t ON t.name=c.relname
    WHERE n.nspname='operations'

    UNION ALL

    SELECT 'FUNCTION:'||p.oid::regprocedure::text||':'||
           encode(extensions.digest(pg_get_functiondef(p.oid),'sha256'),'hex')
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='operations'
      AND p.proname IN(
        'record_sms_consent_event',
        'claim_notification_outbox',
        'record_provider_acceptance',
        'record_final_delivery',
        'resolve_authoritative_notification_policy',
        'resolve_authorized_audience',
        'record_provider_acceptance_10c',
        'apply_telnyx_delivery_event_10c',
        'validate_incident_escalation_binding_for_event_10d',
        'apply_incident_command_10d',
        'calculate_assurance_metric_10e',
        'mark_assurance_event_emitted_10e'
      )
  )
  SELECT string_agg(x,'|' ORDER BY x) INTO v_material FROM material;

  RETURN encode(extensions.digest(coalesce(v_material,''),'sha256'),'hex');
END
$$;

CREATE OR REPLACE FUNCTION operations.compute_domain10_security_fingerprint_10f()
RETURNS text
LANGUAGE plpgsql
STABLE
AS $$
DECLARE v_material text;
BEGIN
  SELECT string_agg(x,'|' ORDER BY x) INTO v_material
  FROM(
    SELECT 'FUNCTION_ACL:'||p.oid::regprocedure::text||':'||
           coalesce(array_to_string(p.proacl,','),'DEFAULT')
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='operations'
      AND p.proname IN(
        'record_sms_consent_event','claim_notification_outbox',
        'record_provider_acceptance_10c','apply_telnyx_delivery_event_10c',
        'apply_incident_command_10d','prepare_escalation_emission_10d',
        'evaluate_assurance_run_10e','mark_assurance_event_emitted_10e'
      )

    UNION ALL

    SELECT 'SCHEMA_ACL:operations:'||coalesce(array_to_string(n.nspacl,','),'DEFAULT')
    FROM pg_namespace n WHERE n.nspname='operations'
  ) s(x);

  RETURN encode(extensions.digest(coalesce(v_material,''),'sha256'),'hex');
END
$$;

-- ---------------------------------------------------------------------------
-- 4. Stronger run creation.
--    Database independently enforces evidence-window and identity bounds.
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
DECLARE
  v_profile_id uuid;
  v_schema text;
  v_security text;
  v_definition text;
  v_input text;
  v_run uuid;
  v_state text;
BEGIN
  IF p_window_end<=p_window_start
     OR p_window_end-p_window_start>interval '31 days' THEN
    RAISE EXCEPTION 'Invalid certification window';
  END IF;

  IF p_window_end>clock_timestamp()+interval '5 minutes' THEN
    RAISE EXCEPTION 'Certification window cannot end materially in the future';
  END IF;

  IF p_git_commit_sha!~'^[0-9a-fA-F]{40}$' THEN
    RAISE EXCEPTION 'Invalid git commit SHA';
  END IF;

  IF p_environment NOT IN('CERTIFICATION','STAGING','PRODUCTION') THEN
    RAISE EXCEPTION 'Invalid certification environment';
  END IF;

  IF btrim(coalesce(p_release_key,''))=''
     OR length(p_release_key)>160
     OR btrim(coalesce(p_requested_by,''))=''
     OR length(p_requested_by)>200
     OR length(coalesce(p_notes,''))>2000 THEN
    RAISE EXCEPTION 'Invalid certification run metadata';
  END IF;

  SELECT p.profile_id,v.lifecycle_state,v.definition_hash
  INTO v_profile_id,v_state,v_definition
  FROM operations.domain10_certification_profiles_10f p
  JOIN operations.domain10_certification_profile_versions_10f v
    ON v.profile_id=p.profile_id
  WHERE p.profile_key=p_profile_key
    AND p.enabled
    AND v.version=p_profile_version;

  IF v_profile_id IS NULL OR v_state<>'FROZEN' OR v_definition IS NULL THEN
    RAISE EXCEPTION '10F certification profile/version is not active FROZEN configuration';
  END IF;

  v_schema:=operations.compute_domain10_schema_fingerprint_10f();
  v_security:=operations.compute_domain10_security_fingerprint_10f();

  v_input:=encode(extensions.digest(
    p_profile_key||'|'||p_profile_version::text||'|'||v_definition||'|'||
    p_release_key||'|'||lower(p_git_commit_sha)||'|'||p_environment||'|'||
    p_window_start::text||'|'||p_window_end::text||'|'||v_schema||'|'||v_security,
    'sha256'
  ),'hex');

  PERFORM pg_advisory_xact_lock(hashtext(v_input));

  SELECT run_id INTO v_run
  FROM operations.domain10_certification_runs_10f
  WHERE input_hash=v_input;

  IF v_run IS NOT NULL THEN RETURN v_run; END IF;

  INSERT INTO operations.domain10_certification_runs_10f(
    profile_id,profile_version,profile_key,release_key,git_commit_sha,environment,
    window_start,window_end,requested_by,request_id,notes,
    schema_fingerprint,security_fingerprint,profile_definition_hash,input_hash,
    requester_db_role
  )
  VALUES(
    v_profile_id,p_profile_version,p_profile_key,p_release_key,lower(p_git_commit_sha),
    p_environment,p_window_start,p_window_end,p_requested_by,p_request_id,p_notes,
    v_schema,v_security,v_definition,v_input,session_user
  )
  RETURNING run_id INTO v_run;

  RETURN v_run;
END
$$;

-- ---------------------------------------------------------------------------
-- 5. Preserve the v1 fixed evaluator and wrap it with stronger certification
--    checks. No configuration-supplied SQL is introduced.
-- ---------------------------------------------------------------------------
ALTER FUNCTION operations.evaluate_domain10_certification_check_10f(uuid,text,integer)
  RENAME TO evaluate_domain10_certification_check_10f_v1;

CREATE OR REPLACE FUNCTION operations.evaluate_domain10_certification_check_10f(
  p_run_id uuid,p_check_key text,p_minimum_sample_size integer
)
RETURNS TABLE(outcome text,sample_size bigint,failure_count bigint,details jsonb)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  r operations.domain10_certification_runs_10f%ROWTYPE;
  v_sample bigint:=0;
  v_fail bigint:=0;
  v_details jsonb:='{}'::jsonb;
BEGIN
  SELECT * INTO r
  FROM operations.domain10_certification_runs_10f
  WHERE run_id=p_run_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION '10F certification run not found';
  END IF;

  IF p_check_key='AUDIT_HASH_CHAIN' THEN
    WITH bounds AS(
      SELECT min(audit_id) min_id,max(audit_id) max_id
      FROM operations.audit_ledger
      WHERE occurred_at>=r.window_start AND occurred_at<r.window_end
    ),
    candidate AS(
      SELECT a.*,
             lag(record_hash) OVER(ORDER BY audit_id) expected_prev,
             encode(extensions.digest(
               coalesce(entity_type,'')||'|'||coalesce(entity_id,'')||'|'||
               coalesce(action,'')||'|'||coalesce(actor_type,'')||'|'||
               coalesce(actor_id,'')||'|'||coalesce(request_id::text,'')||'|'||
               coalesce(correlation_id::text,'')||'|'||coalesce(trace_id,'')||'|'||
               details::text||'|'||coalesce(previous_hash,'')||'|'||occurred_at::text,
               'sha256'
             ),'hex') recomputed_hash
      FROM operations.audit_ledger a,bounds b
      WHERE b.min_id IS NOT NULL
        AND a.audit_id BETWEEN greatest(1,b.min_id-1) AND b.max_id
    )
    SELECT
      count(*) FILTER(WHERE occurred_at>=r.window_start AND occurred_at<r.window_end)::bigint,
      count(*) FILTER(
        WHERE occurred_at>=r.window_start AND occurred_at<r.window_end
          AND (
            record_hash IS DISTINCT FROM recomputed_hash OR
            previous_hash IS DISTINCT FROM expected_prev
          )
      )::bigint
    INTO v_sample,v_fail
    FROM candidate;

  ELSIF p_check_key='GRAPH_ACCEPTANCE_SEMANTICS' THEN
    SELECT count(*)::bigint,
           count(*) FILTER(
             WHERE d.provider_accepted_at IS NOT NULL
               AND NOT EXISTS(
                 SELECT 1 FROM operations.delivery_attempts a
                 WHERE a.delivery_id=d.delivery_id
                   AND a.outcome='ACCEPTED'
                   AND a.http_status=202
               )
           )::bigint
    INTO v_sample,v_fail
    FROM operations.notification_deliveries d
    WHERE d.provider='MICROSOFT_GRAPH'
      AND d.created_at>=r.window_start
      AND d.created_at<r.window_end;

  ELSIF p_check_key='GRAPH_FINAL_DELIVERY_EVIDENCE' THEN
    SELECT count(*)::bigint,
           count(*) FILTER(
             WHERE NOT EXISTS(
               SELECT 1 FROM operations.provider_receipts pr
               WHERE pr.delivery_id=d.delivery_id
                 AND pr.provider='MICROSOFT_GRAPH'
                 AND pr.receipt_type='DELIVERY_CONFIRMED'
                 AND pr.evidence_verified
                 AND pr.evidence_source IN(
                   'EXCHANGE_MESSAGE_TRACE','EXCHANGE_NDR_RECONCILIATION'
                 )
             )
           )::bigint
    INTO v_sample,v_fail
    FROM operations.notification_deliveries d
    WHERE d.provider='MICROSOFT_GRAPH'
      AND d.state='DELIVERED'
      AND d.delivered_at>=r.window_start
      AND d.delivered_at<r.window_end;

  ELSIF p_check_key='TELNYX_TERMINAL_FAILURE_EVIDENCE' THEN
    SELECT count(*)::bigint,
           count(*) FILTER(
             WHERE NOT EXISTS(
               SELECT 1 FROM operations.provider_receipts pr
               WHERE pr.delivery_id=d.delivery_id
                 AND pr.provider='TELNYX'
                 AND pr.evidence_verified
                 AND pr.evidence_source='TELNYX_DELIVERY_WEBHOOK'
                 AND pr.receipt_type='TELNYX_FINALIZED'
                 AND pr.provider_status IN('sending_failed','delivery_failed')
             )
           )::bigint
    INTO v_sample,v_fail
    FROM operations.notification_deliveries d
    WHERE d.provider='TELNYX'
      AND d.state='DEAD_LETTERED'
      AND d.last_error_class='TELNYX_FINAL_DELIVERY_FAILURE'
      AND d.updated_at>=r.window_start
      AND d.updated_at<r.window_end;

  ELSIF p_check_key='SMS_SEND_CONSENT_INTEGRITY' THEN
    -- For each Telnyx acceptance, reconstruct the latest consent action at the
    -- provider-acceptance instant. TCDS's approved SMS enrollment path is
    -- keyword based, so an acceptance whose last known consent action is not
    -- OPT_IN is a certification failure.
    SELECT count(*)::bigint,
           count(*) FILTER(
             WHERE consent.action IS DISTINCT FROM 'OPT_IN'
           )::bigint
    INTO v_sample,v_fail
    FROM operations.notification_deliveries d
    JOIN operations.notification_recipients nr
      ON nr.notification_id=d.notification_id
     AND nr.recipient_id=d.recipient_id
    LEFT JOIN LATERAL(
      SELECT ce.action
      FROM operations.sms_consent_events ce
      WHERE ce.mobile_e164=nr.mobile_snapshot
        AND ce.occurred_at<=d.provider_accepted_at
      ORDER BY ce.occurred_at DESC,
               CASE ce.action WHEN 'OPT_OUT' THEN 0 WHEN 'OPT_IN' THEN 1 ELSE 2 END,
               ce.consent_event_id DESC
      LIMIT 1
    ) consent ON true
    WHERE d.provider='TELNYX'
      AND d.provider_accepted_at>=r.window_start
      AND d.provider_accepted_at<r.window_end;

  ELSIF p_check_key='PUBLIC_EXECUTE_LOCKDOWN' THEN
    WITH protected(signature) AS(
      VALUES
        ('operations.record_sms_consent_event(text,text,text,text,timestamptz,text,uuid,text,text)'),
        ('operations.claim_notification_outbox(text,text,integer,integer)'),
        ('operations.record_provider_acceptance_10c(uuid,uuid,text,text,text,integer,jsonb)'),
        ('operations.apply_telnyx_delivery_event_10c(text,text,text,timestamptz,text,jsonb,jsonb,uuid)'),
        ('operations.apply_incident_command_10d(text,text,text,uuid,text,timestamptz,uuid,text)'),
        ('operations.prepare_escalation_emission_10d(uuid,text)'),
        ('operations.evaluate_assurance_run_10e(uuid,text)'),
        ('operations.mark_assurance_event_emitted_10e(uuid,text,uuid)')
    ),
    resolved AS(
      SELECT signature,to_regprocedure(signature) fn FROM protected
    )
    SELECT count(*)::bigint,
           count(*) FILTER(
             WHERE fn IS NULL OR has_function_privilege('public',fn,'EXECUTE')
           )::bigint
    INTO v_sample,v_fail
    FROM resolved;

  ELSE
    RETURN QUERY
    SELECT *
    FROM operations.evaluate_domain10_certification_check_10f_v1(
      p_run_id,p_check_key,p_minimum_sample_size
    );
    RETURN;
  END IF;

  v_details:=jsonb_build_object(
    'check_key',p_check_key,
    'minimum_sample_size',p_minimum_sample_size
  );

  IF v_fail>0 THEN
    RETURN QUERY SELECT 'FAIL'::text,v_sample,v_fail,v_details;
  ELSIF v_sample<p_minimum_sample_size THEN
    RETURN QUERY SELECT 'INCONCLUSIVE'::text,v_sample,0::bigint,v_details;
  ELSE
    RETURN QUERY SELECT 'PASS'::text,v_sample,0::bigint,v_details;
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 6. Evidence hashes are DB-generated and cryptographically bound to the run,
--    required flag and evidence timestamps.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION operations.verify_domain10_certification_evidence_hash_10f()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_TABLE_NAME='domain10_certification_check_results_10f' THEN
    NEW.result_hash:=encode(extensions.digest(
      NEW.run_id::text||'|'||NEW.check_key||'|'||NEW.required::text||'|'||
      NEW.outcome||'|'||NEW.sample_size::text||'|'||NEW.failure_count::text||'|'||
      NEW.details::text||'|'||NEW.evaluated_at::text,
      'sha256'
    ),'hex');
  ELSE
    NEW.attestor_db_role:=session_user;
    NEW.attestation_hash:=encode(extensions.digest(
      NEW.run_id::text||'|'||NEW.attestation_type||'|'||NEW.outcome||'|'||
      NEW.evidence_sha256||'|'||NEW.evidence_reference||'|'||
      NEW.attested_by||'|'||NEW.attestor_db_role||'|'||
      coalesce(NEW.tool_version,'')||'|'||coalesce(NEW.notes,'')||'|'||
      NEW.attested_at::text,
      'sha256'
    ),'hex');
  END IF;

  RETURN NEW;
END
$$;

-- ---------------------------------------------------------------------------
-- 7. Attestation recording adds separation-of-duty enforcement.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION operations.record_domain10_certification_attestation_10f(
  p_run_id uuid,p_attestation_type text,p_outcome text,p_evidence_sha256 text,
  p_evidence_reference text,p_attested_by text,p_tool_version text DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=operations,pg_temp
AS $$
DECLARE
  r operations.domain10_certification_runs_10f%ROWTYPE;
  v_required boolean;
  v_independent boolean;
  v_id uuid;
BEGIN
  SELECT * INTO r
  FROM operations.domain10_certification_runs_10f
  WHERE run_id=p_run_id
  FOR UPDATE;

  IF NOT FOUND OR r.state<>'AWAITING_ATTESTATIONS' THEN
    RAISE EXCEPTION '10F run does not accept attestations';
  END IF;

  SELECT required,independent_attestor_required
  INTO v_required,v_independent
  FROM operations.domain10_certification_profile_attestations_10f
  WHERE profile_id=r.profile_id
    AND profile_version=r.profile_version
    AND attestation_type=p_attestation_type;

  IF v_required IS NULL THEN
    RAISE EXCEPTION 'Attestation type is not part of frozen 10F profile';
  END IF;

  IF p_outcome NOT IN('PASS','FAIL')
     OR lower(p_evidence_sha256)!~'^[0-9a-f]{64}$'
     OR btrim(coalesce(p_evidence_reference,''))=''
     OR length(p_evidence_reference)>1000
     OR btrim(coalesce(p_attested_by,''))=''
     OR length(p_attested_by)>200
     OR length(coalesce(p_tool_version,''))>200
     OR length(coalesce(p_notes,''))>2000 THEN
    RAISE EXCEPTION 'Invalid 10F attestation';
  END IF;

  IF v_independent
     AND lower(btrim(p_attested_by))=lower(btrim(r.requested_by)) THEN
    RAISE EXCEPTION 'This 10F attestation requires an independent attestor';
  END IF;

  INSERT INTO operations.domain10_certification_attestations_10f(
    run_id,attestation_type,outcome,evidence_sha256,evidence_reference,
    attested_by,tool_version,notes,attestation_hash,attestor_db_role
  )
  VALUES(
    p_run_id,p_attestation_type,p_outcome,lower(p_evidence_sha256),
    p_evidence_reference,p_attested_by,p_tool_version,p_notes,
    repeat('0',64),session_user
  )
  RETURNING attestation_id INTO v_id;

  RETURN v_id;
END
$$;

-- ---------------------------------------------------------------------------
-- 8. Final run hash binds frozen profile + schema/security fingerprints + all
--    automated/live evidence hashes.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION operations.finalize_domain10_certification_run_10f(
  p_run_id uuid,p_actor text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=operations,pg_temp
AS $$
DECLARE
  r operations.domain10_certification_runs_10f%ROWTYPE;
  v_check_fail integer;
  v_check_inc integer;
  v_missing integer;
  v_att_fail integer;
  v_run_hash text;
  v_state text;
BEGIN
  SELECT * INTO r
  FROM operations.domain10_certification_runs_10f
  WHERE run_id=p_run_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION '10F certification run not found'; END IF;
  IF r.state IN('CERTIFIED','REJECTED') THEN RETURN; END IF;

  IF r.state<>'AWAITING_ATTESTATIONS' THEN
    RAISE EXCEPTION '10F certification run is not ready to finalize';
  END IF;

  SELECT count(*) FILTER(WHERE required AND outcome IN('FAIL','ERROR')),
         count(*) FILTER(WHERE required AND outcome='INCONCLUSIVE')
  INTO v_check_fail,v_check_inc
  FROM operations.domain10_certification_check_results_10f
  WHERE run_id=p_run_id;

  SELECT count(*) INTO v_missing
  FROM operations.domain10_certification_profile_attestations_10f pa
  WHERE pa.profile_id=r.profile_id
    AND pa.profile_version=r.profile_version
    AND pa.required
    AND NOT EXISTS(
      SELECT 1
      FROM operations.domain10_certification_attestations_10f a
      WHERE a.run_id=p_run_id
        AND a.attestation_type=pa.attestation_type
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
    r.input_hash||'|'||
    coalesce(r.profile_definition_hash,'')||'|'||
    r.schema_fingerprint||'|'||coalesce(r.security_fingerprint,'')||'|'||
    coalesce((
      SELECT string_agg(result_hash,'|' ORDER BY check_key)
      FROM operations.domain10_certification_check_results_10f
      WHERE run_id=p_run_id
    ),'')||'|'||
    coalesce((
      SELECT string_agg(attestation_hash,'|' ORDER BY attestation_type)
      FROM operations.domain10_certification_attestations_10f
      WHERE run_id=p_run_id
    ),''),
    'sha256'
  ),'hex');

  UPDATE operations.domain10_certification_runs_10f
  SET state=v_state,
      run_hash=v_run_hash,
      completed_at=clock_timestamp(),
      finalized_by=p_actor,
      certified_at=CASE WHEN v_state='CERTIFIED' THEN clock_timestamp() ELSE NULL END,
      certified_by=CASE WHEN v_state='CERTIFIED' THEN p_actor ELSE NULL END
  WHERE run_id=p_run_id;
END
$$;

CREATE OR REPLACE VIEW operations.domain10_certification_summary_10f AS
SELECT
  r.run_id,r.profile_key,r.profile_version,r.release_key,r.git_commit_sha,
  r.environment,r.window_start,r.window_end,r.state,
  r.schema_fingerprint,r.run_hash,r.certified_at,
  coalesce(c.automated_pass,0) AS automated_pass,
  coalesce(c.automated_fail,0) AS automated_fail,
  coalesce(c.automated_inconclusive,0) AS automated_inconclusive,
  coalesce(pa.required_attestations,0) AS required_attestations,
  coalesce(a.passed_attestations,0) AS passed_attestations,
  coalesce(a.failed_attestations,0) AS failed_attestations,
  r.profile_definition_hash,
  r.security_fingerprint,
  r.requester_db_role
FROM operations.domain10_certification_runs_10f r
LEFT JOIN LATERAL(
  SELECT
    count(*) FILTER(WHERE outcome='PASS') AS automated_pass,
    count(*) FILTER(WHERE outcome IN('FAIL','ERROR')) AS automated_fail,
    count(*) FILTER(WHERE outcome='INCONCLUSIVE') AS automated_inconclusive
  FROM operations.domain10_certification_check_results_10f cr
  WHERE cr.run_id=r.run_id
) c ON true
LEFT JOIN LATERAL(
  SELECT count(*) AS required_attestations
  FROM operations.domain10_certification_profile_attestations_10f x
  WHERE x.profile_id=r.profile_id
    AND x.profile_version=r.profile_version
    AND x.required
) pa ON true
LEFT JOIN LATERAL(
  SELECT
    count(*) FILTER(WHERE outcome='PASS') AS passed_attestations,
    count(*) FILTER(WHERE outcome='FAIL') AS failed_attestations
  FROM operations.domain10_certification_attestations_10f at
  WHERE at.run_id=r.run_id
) a ON true;

COMMIT;
