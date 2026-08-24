-- ============================================================================
-- TCDS DOMAIN 10 / SLICE 10B
-- Event Intake & Notification Decision Engine database support
-- Prerequisites: reviewed 10A migrations 510 + 511
-- PostgreSQL 15+
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Frozen event contracts. TypeScript performs full JSON Schema validation;
--    PostgreSQL independently enforces top-level required fields/types.
-- ---------------------------------------------------------------------------

CREATE TABLE operations.event_contract_versions(
  event_type text NOT NULL REFERENCES operations.event_types(event_type),
  schema_version integer NOT NULL CHECK(schema_version>0),
  lifecycle_state text NOT NULL DEFAULT 'DRAFT'
    CHECK(lifecycle_state IN('DRAFT','FROZEN','RETIRED')),
  json_schema jsonb NOT NULL CHECK(jsonb_typeof(json_schema)='object'),
  required_top_level_fields text[] NOT NULL DEFAULT '{}',
  top_level_types jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK(jsonb_typeof(top_level_types)='object'),
  schema_hash text NOT NULL,
  effective_from timestamptz,
  effective_until timestamptz,
  frozen_at timestamptz,
  frozen_by text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(event_type,schema_version),
  CHECK(effective_until IS NULL OR effective_from IS NULL OR effective_until>effective_from),
  CHECK(lifecycle_state='DRAFT' OR (frozen_at IS NOT NULL AND frozen_by IS NOT NULL))
);

CREATE OR REPLACE FUNCTION operations.verify_event_contract_hash()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE expected text;
BEGIN
  expected:=encode(extensions.digest(
    NEW.json_schema::text||E'\n'||
    array_to_string(NEW.required_top_level_fields,',')||E'\n'||
    NEW.top_level_types::text,'sha256'),'hex');
  IF NEW.schema_hash<>expected THEN
    RAISE EXCEPTION 'event contract schema_hash mismatch';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_event_contract_hash
BEFORE INSERT OR UPDATE OF json_schema,required_top_level_fields,top_level_types,schema_hash
ON operations.event_contract_versions
FOR EACH ROW EXECUTE FUNCTION operations.verify_event_contract_hash();

CREATE OR REPLACE FUNCTION operations.guard_event_contract_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' AND OLD.lifecycle_state IN('FROZEN','RETIRED') THEN
    RAISE EXCEPTION 'Frozen/retired event contracts cannot be deleted';
  END IF;
  IF TG_OP='UPDATE' AND OLD.lifecycle_state='FROZEN' THEN
    IF NEW.lifecycle_state='RETIRED'
       AND ROW(NEW.json_schema,NEW.required_top_level_fields,NEW.top_level_types,
               NEW.schema_hash,NEW.effective_from,NEW.effective_until,NEW.frozen_at,NEW.frozen_by)
          IS NOT DISTINCT FROM
           ROW(OLD.json_schema,OLD.required_top_level_fields,OLD.top_level_types,
               OLD.schema_hash,OLD.effective_from,OLD.effective_until,OLD.frozen_at,OLD.frozen_by)
    THEN RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Frozen event contract definition is immutable';
  END IF;
  IF TG_OP='UPDATE' AND OLD.lifecycle_state='RETIRED' THEN
    RAISE EXCEPTION 'Retired event contracts are immutable';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_event_contract_frozen_immutable
BEFORE UPDATE OR DELETE ON operations.event_contract_versions
FOR EACH ROW EXECUTE FUNCTION operations.guard_event_contract_mutation();

ALTER TABLE operations.operational_events
  ADD COLUMN IF NOT EXISTS event_contract_hash text;

COMMENT ON COLUMN operations.operational_events.event_contract_hash IS
'Frozen event-contract hash used by the intake validator. Required for 10B-ingested events.';

-- ---------------------------------------------------------------------------
-- 2. Deterministic event-pattern matching and policy precedence.
--    Only exact or trailing-* prefix patterns are legal.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION operations.event_type_pattern_matches(p_pattern text,p_event_type text)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE STRICT AS $$
BEGIN
  IF p_pattern='*' THEN RETURN true; END IF;
  IF p_pattern !~ '^[A-Z0-9_]+(\*)?$' THEN
    RAISE EXCEPTION 'Invalid event_type_pattern: %',p_pattern;
  END IF;
  IF right(p_pattern,1)='*' THEN
    RETURN left(p_event_type,length(p_pattern)-1)=left(p_pattern,length(p_pattern)-1);
  END IF;
  RETURN p_pattern=p_event_type;
END $$;

ALTER TABLE operations.notification_policy_versions
  ADD COLUMN IF NOT EXISTS decision_priority integer NOT NULL DEFAULT 100;

ALTER TABLE operations.notification_policy_versions
  ADD CONSTRAINT chk_notification_policy_decision_priority
  CHECK(decision_priority BETWEEN 0 AND 100000);

ALTER TABLE operations.notification_policy_versions
  ADD CONSTRAINT chk_notification_policy_event_pattern
  CHECK(event_type_pattern='*' OR event_type_pattern ~ '^[A-Z0-9_]+(\*)?$');

-- ---------------------------------------------------------------------------
-- 3. Exact policy -> channel -> template binding and safe variable allowlists.
-- ---------------------------------------------------------------------------

CREATE TABLE operations.policy_channel_templates(
  policy_id uuid NOT NULL,
  policy_version integer NOT NULL,
  channel text NOT NULL CHECK(channel IN('EMAIL','SMS')),
  template_id uuid NOT NULL,
  template_version integer NOT NULL,
  allowed_variable_paths jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK(jsonb_typeof(allowed_variable_paths)='array'),
  required_variable_paths jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK(jsonb_typeof(required_variable_paths)='array'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(policy_id,policy_version,channel),
  FOREIGN KEY(policy_id,policy_version)
    REFERENCES operations.notification_policy_versions(policy_id,version) ON DELETE CASCADE,
  FOREIGN KEY(template_id,template_version)
    REFERENCES operations.notification_template_versions(template_id,version)
);

CREATE OR REPLACE FUNCTION operations.guard_policy_template_binding()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE st text; template_st text; expected_channel text;
BEGIN
  SELECT lifecycle_state INTO st
  FROM operations.notification_policy_versions
  WHERE policy_id=COALESCE(NEW.policy_id,OLD.policy_id)
    AND version=COALESCE(NEW.policy_version,OLD.policy_version);

  IF st IN('FROZEN','RETIRED') THEN
    RAISE EXCEPTION 'Template bindings for frozen/retired policies are immutable';
  END IF;

  IF TG_OP<>'DELETE' THEN
    SELECT tv.lifecycle_state,t.channel INTO template_st,expected_channel
    FROM operations.notification_template_versions tv
    JOIN operations.notification_templates t ON t.template_id=tv.template_id
    WHERE tv.template_id=NEW.template_id AND tv.version=NEW.template_version;

    IF template_st IS DISTINCT FROM 'FROZEN' THEN
      RAISE EXCEPTION 'Policy binding requires a FROZEN template version';
    END IF;
    IF expected_channel IS DISTINCT FROM NEW.channel THEN
      RAISE EXCEPTION 'Template channel does not match policy binding channel';
    END IF;
  END IF;
  RETURN COALESCE(NEW,OLD);
END $$;

CREATE TRIGGER trg_policy_template_binding_guard
BEFORE INSERT OR UPDATE OR DELETE ON operations.policy_channel_templates
FOR EACH ROW EXECUTE FUNCTION operations.guard_policy_template_binding();

CREATE OR REPLACE FUNCTION operations.validate_policy_before_freeze()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE email_count int; sms_count int; material text;
BEGIN
  IF OLD.lifecycle_state='DRAFT' AND NEW.lifecycle_state='FROZEN' THEN
    SELECT count(*) FILTER(WHERE channel='EMAIL'),
           count(*) FILTER(WHERE channel='SMS')
    INTO email_count,sms_count
    FROM operations.policy_channel_templates
    WHERE policy_id=NEW.policy_id AND policy_version=NEW.version;

    IF NEW.email_enabled AND email_count<>1 THEN
      RAISE EXCEPTION 'Frozen email-enabled policy requires exactly one EMAIL template binding';
    END IF;
    IF NOT NEW.email_enabled AND email_count<>0 THEN
      RAISE EXCEPTION 'Email-disabled policy cannot have EMAIL template binding';
    END IF;
    IF NEW.sms_enabled AND sms_count<>1 THEN
      RAISE EXCEPTION 'Frozen SMS-enabled policy requires exactly one SMS template binding';
    END IF;
    IF NOT NEW.sms_enabled AND sms_count<>0 THEN
      RAISE EXCEPTION 'SMS-disabled policy cannot have SMS template binding';
    END IF;

    material:=
      NEW.event_type_pattern||'|'||NEW.minimum_severity||'|'||NEW.maximum_classification||'|'||
      NEW.audience_id::text||'|'||NEW.email_enabled::text||'|'||NEW.sms_enabled::text||'|'||
      NEW.acknowledgement_required::text||'|'||coalesce(NEW.acknowledgement_timeout_seconds::text,'')||'|'||
      NEW.incident_required::text||'|'||NEW.suppression_window_seconds::text||'|'||
      NEW.max_delivery_attempts::text||'|'||coalesce(NEW.escalation_policy_id::text,'')||'|'||
      NEW.decision_priority::text||'|'||
      coalesce((
        SELECT string_agg(
          channel||':'||template_id::text||':'||template_version::text||':'||
          allowed_variable_paths::text||':'||required_variable_paths::text,
          '|' ORDER BY channel)
        FROM operations.policy_channel_templates
        WHERE policy_id=NEW.policy_id AND policy_version=NEW.version
      ),'');

    NEW.definition_hash:=encode(extensions.digest(material,'sha256'),'hex');
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_10b_validate_policy_before_freeze
BEFORE UPDATE OF lifecycle_state ON operations.notification_policy_versions
FOR EACH ROW EXECUTE FUNCTION operations.validate_policy_before_freeze();

-- ---------------------------------------------------------------------------
-- 4. Declarative audience resolver.
-- ---------------------------------------------------------------------------

CREATE TABLE operations.audience_resolution_rules(
  audience_id uuid PRIMARY KEY REFERENCES operations.notification_audiences(audience_id) ON DELETE CASCADE,
  resolver_type text NOT NULL
    CHECK(resolver_type IN('STATIC_MEMBERSHIP','ALL_ENABLED','DEPARTMENT','ROLE')),
  department_filter text,
  role_filter text,
  recipient_types text[] NOT NULL DEFAULT ARRAY['OWNER','EXECUTIVE','EMPLOYEE','CONTRACTOR']::text[],
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK(
    (resolver_type='DEPARTMENT' AND department_filter IS NOT NULL AND role_filter IS NULL) OR
    (resolver_type='ROLE' AND role_filter IS NOT NULL AND department_filter IS NULL) OR
    (resolver_type IN('STATIC_MEMBERSHIP','ALL_ENABLED') AND department_filter IS NULL AND role_filter IS NULL)
  )
);

CREATE TRIGGER trg_audience_resolution_rule_updated
BEFORE UPDATE ON operations.audience_resolution_rules
FOR EACH ROW EXECUTE FUNCTION operations.set_updated_at();

CREATE OR REPLACE FUNCTION operations.resolve_authorized_audience(
  p_audience_id uuid,
  p_event_type text,
  p_classification text,
  p_effective_at timestamptz
)
RETURNS TABLE(
  recipient_id uuid,
  display_name text,
  email_address text,
  mobile_e164 text,
  email_authorized boolean,
  sms_authorized boolean,
  sms_subscription_status text,
  authorization_snapshot jsonb
)
LANGUAGE sql STABLE AS $$
WITH rule AS (
  SELECT * FROM operations.audience_resolution_rules
  WHERE audience_id=p_audience_id AND enabled
),
base AS (
  SELECT r.*
  FROM operations.recipient_directory r
  CROSS JOIN rule ar
  WHERE r.enabled
    AND r.recipient_type=ANY(ar.recipient_types)
    AND (
      ar.resolver_type='ALL_ENABLED'
      OR (ar.resolver_type='DEPARTMENT' AND r.department=ar.department_filter)
      OR (ar.resolver_type='ROLE' AND r.role_key=ar.role_filter)
      OR (
        ar.resolver_type='STATIC_MEMBERSHIP'
        AND EXISTS(
          SELECT 1 FROM operations.audience_members am
          WHERE am.audience_id=p_audience_id
            AND am.recipient_id=r.recipient_id
            AND am.valid_from<=p_effective_at
            AND (am.valid_until IS NULL OR am.valid_until>p_effective_at)
        )
      )
    )
),
auth AS (
  SELECT b.*,
    bool_or(a.allow_email) FILTER(WHERE
      a.enabled AND a.valid_from<=p_effective_at
      AND (a.valid_until IS NULL OR a.valid_until>p_effective_at)
      AND operations.event_type_pattern_matches(a.event_type_pattern,p_event_type)
      AND operations.classification_rank(a.max_classification)>=operations.classification_rank(p_classification)
    ) AS email_ok,
    bool_or(a.allow_sms) FILTER(WHERE
      a.enabled AND a.valid_from<=p_effective_at
      AND (a.valid_until IS NULL OR a.valid_until>p_effective_at)
      AND operations.event_type_pattern_matches(a.event_type_pattern,p_event_type)
      AND operations.classification_rank(a.max_classification)>=operations.classification_rank(p_classification)
    ) AS sms_ok,
    jsonb_agg(jsonb_build_object(
      'authorization_id',a.authorization_id,
      'event_type_pattern',a.event_type_pattern,
      'max_classification',a.max_classification,
      'allow_email',a.allow_email,
      'allow_sms',a.allow_sms,
      'approved_by',a.approved_by,
      'approval_reference',a.approval_reference
    )) FILTER(WHERE a.authorization_id IS NOT NULL) AS auth_snapshot
  FROM base b
  LEFT JOIN operations.recipient_authorizations a ON a.recipient_id=b.recipient_id
  GROUP BY b.recipient_id,b.employee_key,b.display_name,b.email_address,b.mobile_e164,b.recipient_type,
           b.department,b.role_key,b.enabled,b.source_system,b.source_version,b.created_at,b.updated_at
)
SELECT a.recipient_id,a.display_name,a.email_address,a.mobile_e164,
       coalesce(a.email_ok,false),coalesce(a.sms_ok,false),
       s.status,
       coalesce(a.auth_snapshot,'[]'::jsonb)
FROM auth a
LEFT JOIN operations.sms_subscriptions s ON s.mobile_e164=a.mobile_e164
ORDER BY lower(a.display_name),a.recipient_id
$$;

-- ---------------------------------------------------------------------------
-- 5. Event-planning outbox and planning attempt evidence.
-- ---------------------------------------------------------------------------

ALTER TABLE operations.event_processing
  ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS lease_owner text,
  ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_error_code text;

CREATE TABLE operations.event_planning_outbox(
  planning_outbox_id bigserial PRIMARY KEY,
  event_id uuid NOT NULL UNIQUE REFERENCES operations.operational_events(event_id),
  available_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  locked_at timestamptz,
  lock_owner text,
  lock_expires_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK(lock_expires_at IS NULL OR locked_at IS NULL OR lock_expires_at>=locked_at)
);

CREATE INDEX idx_event_planning_outbox_claim
ON operations.event_planning_outbox(available_at,completed_at,lock_expires_at,planning_outbox_id);

CREATE TABLE operations.event_planning_attempts(
  planning_attempt_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES operations.operational_events(event_id),
  attempt_number integer NOT NULL CHECK(attempt_number>0),
  worker_id text NOT NULL,
  outcome text NOT NULL DEFAULT 'STARTED'
    CHECK(outcome IN('STARTED','PLANNED','SUPPRESSED','NO_POLICY','NO_RECIPIENTS','RETRYABLE_FAILURE','FINAL_FAILURE')),
  error_code text,
  error_message text,
  started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  completed_at timestamptz,
  UNIQUE(event_id,attempt_number)
);

CREATE OR REPLACE FUNCTION operations.guard_event_planning_attempt()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'event_planning_attempts is append-only'; END IF;
  IF OLD.outcome<>'STARTED' THEN RAISE EXCEPTION 'completed planning attempts are immutable'; END IF;
  IF NEW.event_id<>OLD.event_id OR NEW.attempt_number<>OLD.attempt_number OR
     NEW.worker_id<>OLD.worker_id OR NEW.started_at<>OLD.started_at THEN
    RAISE EXCEPTION 'planning attempt identity is immutable';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_event_planning_attempt_evidence
BEFORE UPDATE OR DELETE ON operations.event_planning_attempts
FOR EACH ROW EXECUTE FUNCTION operations.guard_event_planning_attempt();

-- ---------------------------------------------------------------------------
-- 6. Immutable decision evidence and candidate explainability.
-- ---------------------------------------------------------------------------

CREATE TABLE operations.notification_decisions(
  decision_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL UNIQUE REFERENCES operations.operational_events(event_id),
  decision_outcome text NOT NULL
    CHECK(decision_outcome IN('NOTIFY','SUPPRESSED','NO_POLICY','NO_RECIPIENTS','ERROR')),
  notification_id uuid REFERENCES operations.notification_requests(notification_id),
  selected_policy_id uuid,
  selected_policy_version integer,
  selected_definition_hash text,
  decision_reason text NOT NULL,
  decision_context jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(decision_context)='object'),
  decision_hash text NOT NULL DEFAULT '',
  correlation_id uuid NOT NULL,
  trace_id text,
  engine_version text NOT NULL,
  decided_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY(selected_policy_id,selected_policy_version)
    REFERENCES operations.notification_policy_versions(policy_id,version),
  CHECK(
    (decision_outcome='NOTIFY' AND notification_id IS NOT NULL AND selected_policy_id IS NOT NULL)
    OR decision_outcome<>'NOTIFY'
  )
);

CREATE TABLE operations.notification_decision_candidates(
  decision_id uuid NOT NULL REFERENCES operations.notification_decisions(decision_id) ON DELETE CASCADE,
  policy_id uuid NOT NULL,
  policy_version integer NOT NULL,
  policy_key text NOT NULL,
  decision_priority integer NOT NULL,
  pattern_specificity integer NOT NULL,
  definition_hash text NOT NULL,
  selected boolean NOT NULL DEFAULT false,
  PRIMARY KEY(decision_id,policy_id,policy_version),
  FOREIGN KEY(policy_id,policy_version)
    REFERENCES operations.notification_policy_versions(policy_id,version)
);

CREATE OR REPLACE FUNCTION operations.compute_notification_decision_hash()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE material text;
BEGIN
  material:=NEW.event_id::text||'|'||NEW.decision_outcome||'|'||
    coalesce(NEW.notification_id::text,'')||'|'||coalesce(NEW.selected_policy_id::text,'')||'|'||
    coalesce(NEW.selected_policy_version::text,'')||'|'||coalesce(NEW.selected_definition_hash,'')||'|'||
    NEW.decision_reason||'|'||NEW.decision_context::text||'|'||
    NEW.correlation_id::text||'|'||coalesce(NEW.trace_id,'')||'|'||NEW.engine_version||'|'||
    NEW.decided_at::text;
  NEW.decision_hash:=encode(extensions.digest(material,'sha256'),'hex');
  RETURN NEW;
END $$;

CREATE TRIGGER trg_notification_decision_hash
BEFORE INSERT ON operations.notification_decisions
FOR EACH ROW EXECUTE FUNCTION operations.compute_notification_decision_hash();

CREATE OR REPLACE FUNCTION operations.deny_notification_decision_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'notification decision evidence is append-only'; END $$;

CREATE TRIGGER trg_notification_decision_immutable
BEFORE UPDATE OR DELETE ON operations.notification_decisions
FOR EACH ROW EXECUTE FUNCTION operations.deny_notification_decision_mutation();

CREATE TRIGGER trg_notification_decision_candidates_immutable
BEFORE UPDATE OR DELETE ON operations.notification_decision_candidates
FOR EACH ROW EXECUTE FUNCTION operations.deny_notification_decision_mutation();

-- ---------------------------------------------------------------------------
-- 7. Authoritative intake function. Duplicate same-content source events are
--    idempotent; source-event ID reuse with changed content is rejected.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION operations.ingest_operational_event(
  p_source_key text,
  p_source_event_id text,
  p_event_type text,
  p_occurred_at timestamptz,
  p_severity text,
  p_classification text,
  p_subject_type text,
  p_subject_id text,
  p_correlation_id uuid,
  p_causation_id uuid,
  p_trace_id text,
  p_request_id uuid,
  p_schema_version integer,
  p_producer text,
  p_payload jsonb,
  p_event_contract_hash text
)
RETURNS TABLE(event_id uuid,inserted boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=operations,pg_temp
AS $$
DECLARE
  v_source_id uuid;
  v_payload_hash text;
  v_contract operations.event_contract_versions%ROWTYPE;
  v_existing operations.operational_events%ROWTYPE;
  v_event_id uuid;
  v_key text;
  v_field text;
  v_expected_type text;
BEGIN
  SELECT source_id INTO v_source_id
  FROM operations.event_sources
  WHERE source_key=p_source_key AND enabled;
  IF v_source_id IS NULL THEN RAISE EXCEPTION 'Unknown/disabled event source %',p_source_key; END IF;

  IF NOT EXISTS(SELECT 1 FROM operations.event_types WHERE event_type=p_event_type AND enabled) THEN
    RAISE EXCEPTION 'Unknown/disabled event type %',p_event_type;
  END IF;

  SELECT * INTO v_contract
  FROM operations.event_contract_versions
  WHERE event_type=p_event_type AND schema_version=p_schema_version
    AND lifecycle_state='FROZEN'
    AND (effective_from IS NULL OR effective_from<=clock_timestamp())
    AND (effective_until IS NULL OR effective_until>clock_timestamp());

  IF NOT FOUND THEN RAISE EXCEPTION 'No active frozen event contract for % v%',p_event_type,p_schema_version; END IF;
  IF v_contract.schema_hash<>p_event_contract_hash THEN RAISE EXCEPTION 'Event contract hash mismatch'; END IF;
  IF jsonb_typeof(p_payload)<>'object' THEN RAISE EXCEPTION 'Event payload must be object'; END IF;

  FOREACH v_field IN ARRAY v_contract.required_top_level_fields LOOP
    IF NOT (p_payload ? v_field) THEN RAISE EXCEPTION 'Required payload field missing: %',v_field; END IF;
  END LOOP;

  FOR v_key,v_expected_type IN SELECT key,value #>> '{}' FROM jsonb_each(v_contract.top_level_types) LOOP
    IF p_payload ? v_key AND jsonb_typeof(p_payload->v_key)<>v_expected_type THEN
      RAISE EXCEPTION 'Payload field % expected type %, got %',
        v_key,v_expected_type,jsonb_typeof(p_payload->v_key);
    END IF;
  END LOOP;

  v_payload_hash:=encode(extensions.digest(p_payload::text,'sha256'),'hex');

  SELECT * INTO v_existing
  FROM operations.operational_events
  WHERE source_id=v_source_id AND source_event_id=p_source_event_id;

  IF FOUND THEN
    IF v_existing.event_type<>p_event_type OR v_existing.schema_version<>p_schema_version OR
       v_existing.payload_hash<>v_payload_hash OR
       v_existing.event_contract_hash IS DISTINCT FROM p_event_contract_hash THEN
      RAISE EXCEPTION 'Source event ID collision with different authoritative content';
    END IF;
    RETURN QUERY SELECT v_existing.event_id,false;
    RETURN;
  END IF;

  INSERT INTO operations.operational_events(
    source_id,source_event_id,event_type,occurred_at,severity,classification,
    subject_type,subject_id,correlation_id,causation_id,trace_id,request_id,
    idempotency_key,schema_version,payload,payload_hash,event_contract_hash,producer
  ) VALUES(
    v_source_id,p_source_event_id,p_event_type,p_occurred_at,p_severity,p_classification,
    p_subject_type,p_subject_id,p_correlation_id,p_causation_id,p_trace_id,p_request_id,
    encode(extensions.digest(v_source_id::text||'|'||p_source_event_id,'sha256'),'hex'),
    p_schema_version,p_payload,v_payload_hash,p_event_contract_hash,p_producer
  ) RETURNING operations.operational_events.event_id INTO v_event_id;

  INSERT INTO operations.event_processing(event_id,processing_state,next_attempt_at)
  VALUES(v_event_id,'PENDING',clock_timestamp());

  INSERT INTO operations.event_planning_outbox(event_id,available_at)
  VALUES(v_event_id,clock_timestamp());

  RETURN QUERY SELECT v_event_id,true;
END $$;

-- ---------------------------------------------------------------------------
-- 8. Safe planning claims. Planning itself has no provider side effect, so an
--    expired PLANNING lease can safely return to PENDING.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION operations.claim_event_planning_outbox(
  p_worker_id text,p_batch_size integer DEFAULT 20,p_lease_seconds integer DEFAULT 120
)
RETURNS TABLE(planning_outbox_id bigint,event_id uuid)
LANGUAGE plpgsql AS $$
BEGIN
  IF p_batch_size<1 OR p_batch_size>100 THEN RAISE EXCEPTION 'Invalid planning batch size'; END IF;
  IF p_lease_seconds<30 OR p_lease_seconds>600 THEN RAISE EXCEPTION 'Invalid planning lease'; END IF;

  UPDATE operations.event_processing
  SET processing_state='PENDING',lease_owner=NULL,lease_expires_at=NULL,
      last_error_code='PLANNER_LEASE_EXPIRED',last_error='Planner lease expired before commit'
  WHERE processing_state='PLANNING'
    AND lease_expires_at IS NOT NULL AND lease_expires_at<clock_timestamp();

  RETURN QUERY
  WITH picked AS(
    SELECT o.planning_outbox_id,o.event_id
    FROM operations.event_planning_outbox o
    JOIN operations.event_processing p USING(event_id)
    WHERE o.completed_at IS NULL
      AND o.available_at<=clock_timestamp()
      AND (o.lock_expires_at IS NULL OR o.lock_expires_at<clock_timestamp())
      AND p.processing_state IN('PENDING','FAILED')
    ORDER BY o.available_at,o.planning_outbox_id
    FOR UPDATE OF o SKIP LOCKED
    LIMIT p_batch_size
  ),
  locked AS(
    UPDATE operations.event_planning_outbox o
    SET locked_at=clock_timestamp(),lock_owner=p_worker_id,
        lock_expires_at=clock_timestamp()+make_interval(secs=>p_lease_seconds)
    FROM picked p WHERE o.planning_outbox_id=p.planning_outbox_id
    RETURNING o.planning_outbox_id,o.event_id
  ),
  claimed AS(
    UPDATE operations.event_processing ep
    SET processing_state='PLANNING',lease_owner=p_worker_id,
        lease_expires_at=clock_timestamp()+make_interval(secs=>p_lease_seconds)
    FROM locked l WHERE ep.event_id=l.event_id
    RETURNING ep.event_id
  )
  SELECT l.planning_outbox_id,l.event_id FROM locked l;
END $$;

CREATE OR REPLACE FUNCTION operations.begin_event_planning_attempt(
  p_event_id uuid,p_worker_id text
)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_attempt uuid; v_number integer;
BEGIN
  SELECT attempt_count+1 INTO v_number
  FROM operations.event_processing
  WHERE event_id=p_event_id AND processing_state='PLANNING'
    AND lease_owner=p_worker_id AND lease_expires_at>clock_timestamp()
  FOR UPDATE;
  IF v_number IS NULL THEN RAISE EXCEPTION 'Planner lease lost'; END IF;

  UPDATE operations.event_processing SET attempt_count=v_number WHERE event_id=p_event_id;

  INSERT INTO operations.event_planning_attempts(event_id,attempt_number,worker_id)
  VALUES(p_event_id,v_number,p_worker_id)
  RETURNING planning_attempt_id INTO v_attempt;
  RETURN v_attempt;
END $$;

CREATE OR REPLACE FUNCTION operations.complete_event_planning(
  p_event_id uuid,p_planning_attempt_id uuid,p_worker_id text,
  p_state text,p_reason text
)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_outcome text;
BEGIN
  IF p_state NOT IN('PLANNED','SUPPRESSED') THEN RAISE EXCEPTION 'Invalid completion state'; END IF;
  v_outcome:=CASE WHEN p_state='SUPPRESSED' THEN 'SUPPRESSED' ELSE
    COALESCE((SELECT decision_outcome FROM operations.notification_decisions WHERE event_id=p_event_id),'PLANNED') END;

  UPDATE operations.event_planning_attempts
  SET outcome=CASE WHEN v_outcome IN('NO_POLICY','NO_RECIPIENTS') THEN v_outcome ELSE p_state END,
      completed_at=clock_timestamp()
  WHERE planning_attempt_id=p_planning_attempt_id AND event_id=p_event_id AND worker_id=p_worker_id AND outcome='STARTED';
  IF NOT FOUND THEN RAISE EXCEPTION 'Active planning attempt not found'; END IF;

  UPDATE operations.event_processing
  SET processing_state=p_state,planned_at=CASE WHEN p_state='PLANNED' THEN clock_timestamp() ELSE planned_at END,
      suppressed_at=CASE WHEN p_state='SUPPRESSED' THEN clock_timestamp() ELSE suppressed_at END,
      suppression_reason=CASE WHEN p_state='SUPPRESSED' THEN p_reason ELSE suppression_reason END,
      lease_owner=NULL,lease_expires_at=NULL,last_error=NULL,last_error_code=NULL
  WHERE event_id=p_event_id AND processing_state='PLANNING' AND lease_owner=p_worker_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Event is not owned by planner'; END IF;

  UPDATE operations.event_planning_outbox
  SET completed_at=clock_timestamp(),lock_owner=NULL,lock_expires_at=NULL
  WHERE event_id=p_event_id;
END $$;

CREATE OR REPLACE FUNCTION operations.fail_event_planning(
  p_event_id uuid,p_planning_attempt_id uuid,p_worker_id text,
  p_error_code text,p_error_message text,p_retryable boolean,
  p_next_attempt_at timestamptz,p_max_attempts integer
)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_count integer; v_retry boolean;
BEGIN
  SELECT attempt_count INTO v_count FROM operations.event_processing
  WHERE event_id=p_event_id FOR UPDATE;
  v_retry:=p_retryable AND v_count<p_max_attempts;

  UPDATE operations.event_planning_attempts
  SET outcome=CASE WHEN v_retry THEN 'RETRYABLE_FAILURE' ELSE 'FINAL_FAILURE' END,
      error_code=p_error_code,error_message=left(p_error_message,1000),completed_at=clock_timestamp()
  WHERE planning_attempt_id=p_planning_attempt_id AND event_id=p_event_id
    AND worker_id=p_worker_id AND outcome='STARTED';
  IF NOT FOUND THEN RAISE EXCEPTION 'Active planning attempt not found'; END IF;

  UPDATE operations.event_processing
  SET processing_state='FAILED',last_error_code=p_error_code,last_error=left(p_error_message,1000),
      next_attempt_at=CASE WHEN v_retry THEN p_next_attempt_at ELSE NULL END,
      lease_owner=NULL,lease_expires_at=NULL
  WHERE event_id=p_event_id AND lease_owner=p_worker_id;

  UPDATE operations.event_planning_outbox
  SET available_at=CASE WHEN v_retry THEN p_next_attempt_at ELSE available_at END,
      completed_at=CASE WHEN v_retry THEN NULL ELSE clock_timestamp() END,
      lock_owner=NULL,lock_expires_at=NULL,locked_at=NULL
  WHERE event_id=p_event_id;
END $$;

COMMENT ON TABLE operations.notification_decisions IS
'Immutable 10B decision evidence: policy candidates, winner, suppression/no-action outcome, and exact engine version.';
COMMENT ON TABLE operations.event_planning_outbox IS
'Durable internal planning queue. Safe to retry because planning has no external provider side effect.';
COMMENT ON TABLE operations.policy_channel_templates IS
'Frozen policy-to-template binding with explicit variable allowlist; required before policy freeze.';

COMMIT;
