-- ============================================================================
-- TCDS DOMAIN 10 / SLICE 10B REVISION 2 — GREEN TIER 1 HARDENING
-- Applies after reviewed 10A (510,511) and 10B 513.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. One coherent decision-time basis for retries and historical evidence.
--    received_at is when Domain 10 gained authority to notify.
-- ---------------------------------------------------------------------------

ALTER TABLE operations.event_processing
  ADD COLUMN IF NOT EXISTS decision_basis_at timestamptz;

UPDATE operations.event_processing ep
SET decision_basis_at=e.received_at
FROM operations.operational_events e
WHERE e.event_id=ep.event_id AND ep.decision_basis_at IS NULL;

ALTER TABLE operations.event_processing
  ALTER COLUMN decision_basis_at SET NOT NULL;

COMMENT ON COLUMN operations.event_processing.decision_basis_at IS
'Immutable notification decision basis. New 10B events use operational_events.received_at; all retry resolution uses this timestamp.';

CREATE OR REPLACE FUNCTION operations.guard_decision_basis()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.decision_basis_at IS DISTINCT FROM OLD.decision_basis_at THEN
    RAISE EXCEPTION 'event_processing.decision_basis_at is immutable';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_event_processing_decision_basis ON operations.event_processing;
CREATE TRIGGER trg_event_processing_decision_basis
BEFORE UPDATE OF decision_basis_at ON operations.event_processing
FOR EACH ROW EXECUTE FUNCTION operations.guard_decision_basis();

-- ---------------------------------------------------------------------------
-- 2. Full authoritative event-envelope fingerprint.
--    Duplicate source_event_id is idempotent only when all authoritative
--    immutable envelope/content fields match.
-- ---------------------------------------------------------------------------

ALTER TABLE operations.operational_events
  ADD COLUMN IF NOT EXISTS event_envelope_hash text;

UPDATE operations.operational_events
SET event_envelope_hash=encode(extensions.digest(
  source_id::text||'|'||source_event_id||'|'||event_type||'|'||
  occurred_at::text||'|'||severity||'|'||classification||'|'||
  coalesce(subject_type,'')||'|'||coalesce(subject_id,'')||'|'||
  correlation_id::text||'|'||coalesce(causation_id::text,'')||'|'||
  coalesce(trace_id,'')||'|'||coalesce(request_id::text,'')||'|'||
  schema_version::text||'|'||producer||'|'||payload_hash||'|'||
  coalesce(event_contract_hash,'')
,'sha256'),'hex')
WHERE event_envelope_hash IS NULL;

ALTER TABLE operations.operational_events
  ALTER COLUMN event_envelope_hash SET NOT NULL;

CREATE OR REPLACE FUNCTION operations.verify_event_envelope_hash()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE expected text;
BEGIN
  expected:=encode(extensions.digest(
    NEW.source_id::text||'|'||NEW.source_event_id||'|'||NEW.event_type||'|'||
    NEW.occurred_at::text||'|'||NEW.severity||'|'||NEW.classification||'|'||
    coalesce(NEW.subject_type,'')||'|'||coalesce(NEW.subject_id,'')||'|'||
    NEW.correlation_id::text||'|'||coalesce(NEW.causation_id::text,'')||'|'||
    coalesce(NEW.trace_id,'')||'|'||coalesce(NEW.request_id::text,'')||'|'||
    NEW.schema_version::text||'|'||NEW.producer||'|'||NEW.payload_hash||'|'||
    coalesce(NEW.event_contract_hash,'')
  ,'sha256'),'hex');
  IF NEW.event_envelope_hash<>expected THEN
    RAISE EXCEPTION 'operational event event_envelope_hash mismatch';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_operational_event_envelope_hash ON operations.operational_events;
CREATE TRIGGER trg_operational_event_envelope_hash
BEFORE INSERT ON operations.operational_events
FOR EACH ROW EXECUTE FUNCTION operations.verify_event_envelope_hash();

-- ---------------------------------------------------------------------------
-- 3. Configuration grammar hardening.
-- ---------------------------------------------------------------------------

ALTER TABLE operations.recipient_authorizations
  DROP CONSTRAINT IF EXISTS chk_recipient_auth_event_pattern;
ALTER TABLE operations.recipient_authorizations
  ADD CONSTRAINT chk_recipient_auth_event_pattern
  CHECK(event_type_pattern='*' OR event_type_pattern ~ '^[A-Z0-9_]+(\*)?$');

ALTER TABLE operations.suppression_rules
  DROP CONSTRAINT IF EXISTS chk_suppression_event_pattern;
ALTER TABLE operations.suppression_rules
  ADD CONSTRAINT chk_suppression_event_pattern
  CHECK(event_type_pattern='*' OR event_type_pattern ~ '^[A-Z0-9_]+(\*)?$');

CREATE OR REPLACE FUNCTION operations.jsonb_array_is_strings(v jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE STRICT AS $$
  SELECT jsonb_typeof(v)='array'
     AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(v) x WHERE jsonb_typeof(x)<>'string')
$$;

ALTER TABLE operations.suppression_rules
  DROP CONSTRAINT IF EXISTS chk_suppression_grouping_fields_strings;
ALTER TABLE operations.suppression_rules
  ADD CONSTRAINT chk_suppression_grouping_fields_strings
  CHECK(operations.jsonb_array_is_strings(grouping_fields));

ALTER TABLE operations.policy_channel_templates
  DROP CONSTRAINT IF EXISTS chk_policy_allowed_variable_paths_strings;
ALTER TABLE operations.policy_channel_templates
  ADD CONSTRAINT chk_policy_allowed_variable_paths_strings
  CHECK(operations.jsonb_array_is_strings(allowed_variable_paths));

ALTER TABLE operations.policy_channel_templates
  DROP CONSTRAINT IF EXISTS chk_policy_required_variable_paths_strings;
ALTER TABLE operations.policy_channel_templates
  ADD CONSTRAINT chk_policy_required_variable_paths_strings
  CHECK(operations.jsonb_array_is_strings(required_variable_paths));

-- Acknowledgement policy cannot be frozen without an actual timeout.
ALTER TABLE operations.notification_policy_versions
  DROP CONSTRAINT IF EXISTS chk_notification_policy_ack_timeout;
ALTER TABLE operations.notification_policy_versions
  ADD CONSTRAINT chk_notification_policy_ack_timeout
  CHECK(
    (NOT acknowledgement_required AND acknowledgement_timeout_seconds IS NULL)
    OR
    (acknowledgement_required AND acknowledgement_timeout_seconds IS NOT NULL AND acknowledgement_timeout_seconds>0)
  );

-- ---------------------------------------------------------------------------
-- 4. Policy freeze validation covers INSERT-as-FROZEN and DRAFT->FROZEN.
-- ---------------------------------------------------------------------------

DROP TRIGGER IF EXISTS trg_10b_validate_policy_before_freeze ON operations.notification_policy_versions;

CREATE OR REPLACE FUNCTION operations.validate_policy_frozen_contract()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE email_count int; sms_count int; material text;
BEGIN
  IF NEW.lifecycle_state='FROZEN'
     AND (TG_OP='INSERT' OR OLD.lifecycle_state IS DISTINCT FROM 'FROZEN') THEN

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

CREATE TRIGGER trg_10b_validate_policy_frozen_contract
BEFORE INSERT OR UPDATE OF lifecycle_state ON operations.notification_policy_versions
FOR EACH ROW EXECUTE FUNCTION operations.validate_policy_frozen_contract();

-- ---------------------------------------------------------------------------
-- 5. Suppression evidence gains explicit channel; decisions are append-only.
-- ---------------------------------------------------------------------------

ALTER TABLE operations.suppression_decisions
  ADD COLUMN IF NOT EXISTS channel text;

ALTER TABLE operations.suppression_decisions
  DROP CONSTRAINT IF EXISTS chk_suppression_decision_channel;
ALTER TABLE operations.suppression_decisions
  ADD CONSTRAINT chk_suppression_decision_channel
  CHECK(channel IS NULL OR channel IN('EMAIL','SMS'));

CREATE OR REPLACE FUNCTION operations.deny_suppression_decision_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'suppression_decisions is append-only';
END $$;

DROP TRIGGER IF EXISTS trg_suppression_decision_immutable ON operations.suppression_decisions;
CREATE TRIGGER trg_suppression_decision_immutable
BEFORE UPDATE OR DELETE ON operations.suppression_decisions
FOR EACH ROW EXECUTE FUNCTION operations.deny_suppression_decision_mutation();

-- ---------------------------------------------------------------------------
-- 6. DB-authoritative policy winner at immutable decision_basis_at.
--    RETIRED versions remain valid for decisions whose basis timestamp falls
--    inside their effective window. Current mutable parent enable flags do not
--    rewrite an already-received event's governance basis.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION operations.resolve_authoritative_notification_policy(p_event_id uuid)
RETURNS TABLE(policy_id uuid,policy_version integer)
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_event operations.operational_events%ROWTYPE;
  v_basis timestamptz;
  v_count integer;
BEGIN
  SELECT e.*,ep.decision_basis_at INTO v_event
  FROM operations.operational_events e
  JOIN operations.event_processing ep ON ep.event_id=e.event_id
  WHERE e.event_id=p_event_id;

  SELECT ep.decision_basis_at INTO v_basis
  FROM operations.event_processing ep WHERE ep.event_id=p_event_id;

  IF v_event.event_id IS NULL OR v_basis IS NULL THEN
    RAISE EXCEPTION 'Event or decision basis not found';
  END IF;

  WITH candidates AS(
    SELECT v.policy_id,v.version,v.decision_priority,
           length(replace(v.event_type_pattern,'*','')) specificity,
           dense_rank() OVER(
             ORDER BY v.decision_priority DESC,
                      length(replace(v.event_type_pattern,'*','')) DESC
           ) rk
    FROM operations.notification_policy_versions v
    WHERE v.lifecycle_state IN('FROZEN','RETIRED')
      AND operations.event_type_pattern_matches(v.event_type_pattern,v_event.event_type)
      AND operations.severity_rank(v_event.severity)>=operations.severity_rank(v.minimum_severity)
      AND operations.classification_rank(v_event.classification)<=operations.classification_rank(v.maximum_classification)
      AND (v.effective_from IS NULL OR v.effective_from<=v_basis)
      AND (v.effective_until IS NULL OR v.effective_until>v_basis)
  ),
  winners AS(SELECT * FROM candidates WHERE rk=1)
  SELECT count(*) INTO v_count FROM winners;

  IF v_count=0 THEN RETURN; END IF;
  IF v_count>1 THEN RAISE EXCEPTION 'POLICY_AMBIGUOUS for event %',p_event_id; END IF;

  RETURN QUERY
  WITH candidates AS(
    SELECT v.policy_id,v.version,
           dense_rank() OVER(
             ORDER BY v.decision_priority DESC,
                      length(replace(v.event_type_pattern,'*','')) DESC
           ) rk
    FROM operations.notification_policy_versions v
    WHERE v.lifecycle_state IN('FROZEN','RETIRED')
      AND operations.event_type_pattern_matches(v.event_type_pattern,v_event.event_type)
      AND operations.severity_rank(v_event.severity)>=operations.severity_rank(v.minimum_severity)
      AND operations.classification_rank(v_event.classification)<=operations.classification_rank(v.maximum_classification)
      AND (v.effective_from IS NULL OR v.effective_from<=v_basis)
      AND (v.effective_until IS NULL OR v.effective_until>v_basis)
  )
  SELECT c.policy_id,c.version FROM candidates c WHERE c.rk=1;
END $$;

-- ---------------------------------------------------------------------------
-- 7. DB recipient/channel authorization recheck.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION operations.is_recipient_channel_authorized(
  p_recipient_id uuid,p_audience_id uuid,p_event_type text,p_classification text,
  p_effective_at timestamptz,p_channel text
)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS(
    SELECT 1
    FROM operations.resolve_authorized_audience(
      p_audience_id,p_event_type,p_classification,p_effective_at
    ) r
    WHERE r.recipient_id=p_recipient_id
      AND (
        (p_channel='EMAIL' AND r.email_authorized AND r.email_address IS NOT NULL)
        OR
        (p_channel='SMS' AND r.sms_authorized AND r.mobile_e164 IS NOT NULL
          AND r.sms_subscription_status='SUBSCRIBED')
      )
  )
$$;

-- ---------------------------------------------------------------------------
-- 8. Planning attempts return authoritative attempt number for backoff.
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS operations.begin_event_planning_attempt(uuid,text);
CREATE FUNCTION operations.begin_event_planning_attempt(
  p_event_id uuid,p_worker_id text
)
RETURNS TABLE(planning_attempt_id uuid,attempt_number integer)
LANGUAGE plpgsql AS $$
DECLARE v_attempt uuid; v_number integer;
BEGIN
  SELECT ep.attempt_count+1 INTO v_number
  FROM operations.event_processing ep
  WHERE ep.event_id=p_event_id AND ep.processing_state='PLANNING'
    AND ep.lease_owner=p_worker_id AND ep.lease_expires_at>clock_timestamp()
  FOR UPDATE;

  IF v_number IS NULL THEN RAISE EXCEPTION 'Planner lease lost'; END IF;

  UPDATE operations.event_processing SET attempt_count=v_number WHERE event_id=p_event_id;

  INSERT INTO operations.event_planning_attempts(event_id,attempt_number,worker_id)
  VALUES(p_event_id,v_number,p_worker_id)
  RETURNING event_planning_attempts.planning_attempt_id INTO v_attempt;

  RETURN QUERY SELECT v_attempt,v_number;
END $$;

-- ---------------------------------------------------------------------------
-- 9. Decision evidence sealing. Candidate rows cannot be changed/added after
--    seal; seal re-derives the complete candidate set from PostgreSQL.
-- ---------------------------------------------------------------------------

ALTER TABLE operations.notification_decisions
  ADD COLUMN IF NOT EXISTS candidate_set_hash text,
  ADD COLUMN IF NOT EXISTS sealed_at timestamptz;

ALTER TABLE operations.notification_decisions
  DROP CONSTRAINT IF EXISTS chk_notification_decision_sealed;
ALTER TABLE operations.notification_decisions
  ADD CONSTRAINT chk_notification_decision_sealed
  CHECK(sealed_at IS NULL OR candidate_set_hash IS NOT NULL);

CREATE OR REPLACE FUNCTION operations.guard_decision_candidate_insert()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_sealed timestamptz;
BEGIN
  SELECT sealed_at INTO v_sealed FROM operations.notification_decisions WHERE decision_id=NEW.decision_id;
  IF v_sealed IS NOT NULL THEN RAISE EXCEPTION 'Cannot append candidates to sealed notification decision'; END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_notification_decision_candidate_insert_guard ON operations.notification_decision_candidates;
CREATE TRIGGER trg_notification_decision_candidate_insert_guard
BEFORE INSERT ON operations.notification_decision_candidates
FOR EACH ROW EXECUTE FUNCTION operations.guard_decision_candidate_insert();

CREATE OR REPLACE FUNCTION operations.begin_notification_decision(
  p_decision_id uuid,p_event_id uuid,p_outcome text,p_notification_id uuid,
  p_selected_policy_id uuid,p_selected_policy_version integer,p_selected_definition_hash text,
  p_reason text,p_context jsonb,p_correlation_id uuid,p_trace_id text,p_engine_version text,
  p_candidate_set_hash text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=operations,pg_temp
AS $$
BEGIN
  INSERT INTO operations.notification_decisions(
    decision_id,event_id,decision_outcome,notification_id,selected_policy_id,
    selected_policy_version,selected_definition_hash,decision_reason,decision_context,
    candidate_set_hash,correlation_id,trace_id,engine_version
  ) VALUES(
    p_decision_id,p_event_id,p_outcome,p_notification_id,p_selected_policy_id,
    p_selected_policy_version,p_selected_definition_hash,p_reason,p_context,
    p_candidate_set_hash,p_correlation_id,p_trace_id,p_engine_version
  );
END $$;

CREATE OR REPLACE FUNCTION operations.seal_notification_decision(p_decision_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=operations,pg_temp
AS $$
DECLARE
  v_event_id uuid;
  v_expected text;
  v_actual text;
  v_selected integer;
BEGIN
  SELECT event_id INTO v_event_id
  FROM operations.notification_decisions
  WHERE decision_id=p_decision_id AND sealed_at IS NULL
  FOR UPDATE;

  IF v_event_id IS NULL THEN RAISE EXCEPTION 'Unsealed decision not found'; END IF;

  WITH e AS(
    SELECT oe.*,ep.decision_basis_at
    FROM operations.operational_events oe
    JOIN operations.event_processing ep ON ep.event_id=oe.event_id
    WHERE oe.event_id=v_event_id
  ),
  c AS(
    SELECT v.policy_id,v.version,v.definition_hash,v.decision_priority,
           length(replace(v.event_type_pattern,'*','')) specificity
    FROM e
    JOIN operations.notification_policy_versions v ON
      v.lifecycle_state IN('FROZEN','RETIRED')
      AND operations.event_type_pattern_matches(v.event_type_pattern,e.event_type)
      AND operations.severity_rank(e.severity)>=operations.severity_rank(v.minimum_severity)
      AND operations.classification_rank(e.classification)<=operations.classification_rank(v.maximum_classification)
      AND (v.effective_from IS NULL OR v.effective_from<=e.decision_basis_at)
      AND (v.effective_until IS NULL OR v.effective_until>e.decision_basis_at)
  )
  SELECT encode(extensions.digest(coalesce(string_agg(
    policy_id::text||':'||version::text||':'||definition_hash||':'||
    decision_priority::text||':'||specificity::text,'|' ORDER BY
    policy_id::text,version
  ),''),'sha256'),'hex')
  INTO v_expected FROM c;

  SELECT encode(extensions.digest(coalesce(string_agg(
    policy_id::text||':'||policy_version::text||':'||definition_hash||':'||
    decision_priority::text||':'||pattern_specificity::text,'|' ORDER BY
    policy_id::text,policy_version
  ),''),'sha256'),'hex'),
  count(*) FILTER(WHERE selected)
  INTO v_actual,v_selected
  FROM operations.notification_decision_candidates
  WHERE decision_id=p_decision_id;

  IF v_actual IS DISTINCT FROM v_expected THEN
    RAISE EXCEPTION 'Decision candidate set does not match authoritative PostgreSQL candidates';
  END IF;

  IF (SELECT decision_outcome FROM operations.notification_decisions WHERE decision_id=p_decision_id)='NOTIFY'
     AND v_selected<>1 THEN
    RAISE EXCEPTION 'NOTIFY decision must have exactly one selected policy candidate';
  END IF;

  UPDATE operations.notification_decisions
  SET sealed_at=clock_timestamp()
  WHERE decision_id=p_decision_id;
END $$;

-- Prevent decision insert bypass after hardening; use begin function.
-- Existing table trigger already forbids UPDATE/DELETE.

-- ---------------------------------------------------------------------------
-- 10. Rewrite event ingestion: historical contract window + full envelope hash
--     + stable decision basis + source collision enforcement.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION operations.ingest_operational_event(
  p_source_key text,p_source_event_id text,p_event_type text,p_occurred_at timestamptz,
  p_severity text,p_classification text,p_subject_type text,p_subject_id text,
  p_correlation_id uuid,p_causation_id uuid,p_trace_id text,p_request_id uuid,
  p_schema_version integer,p_producer text,p_payload jsonb,p_event_contract_hash text
)
RETURNS TABLE(event_id uuid,inserted boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=operations,pg_temp
AS $$
DECLARE
  v_source_id uuid;
  v_payload_hash text;
  v_envelope_hash text;
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
    AND lifecycle_state IN('FROZEN','RETIRED')
    AND (effective_from IS NULL OR effective_from<=p_occurred_at)
    AND (effective_until IS NULL OR effective_until>p_occurred_at);

  IF NOT FOUND THEN RAISE EXCEPTION 'No governed event contract for % v% at occurred_at',p_event_type,p_schema_version; END IF;
  IF v_contract.schema_hash<>p_event_contract_hash THEN RAISE EXCEPTION 'Event contract hash mismatch'; END IF;
  IF jsonb_typeof(p_payload)<>'object' THEN RAISE EXCEPTION 'Event payload must be object'; END IF;

  FOREACH v_field IN ARRAY v_contract.required_top_level_fields LOOP
    IF NOT (p_payload ? v_field) THEN RAISE EXCEPTION 'Required payload field missing: %',v_field; END IF;
  END LOOP;

  FOR v_key,v_expected_type IN SELECT key,value #>> '{}' FROM jsonb_each(v_contract.top_level_types) LOOP
    IF p_payload ? v_key AND jsonb_typeof(p_payload->v_key)<>v_expected_type THEN
      RAISE EXCEPTION 'Payload field % expected type %, got %',v_key,v_expected_type,jsonb_typeof(p_payload->v_key);
    END IF;
  END LOOP;

  v_payload_hash:=encode(extensions.digest(p_payload::text,'sha256'),'hex');
  v_envelope_hash:=encode(extensions.digest(
    v_source_id::text||'|'||p_source_event_id||'|'||p_event_type||'|'||
    p_occurred_at::text||'|'||p_severity||'|'||p_classification||'|'||
    coalesce(p_subject_type,'')||'|'||coalesce(p_subject_id,'')||'|'||
    p_correlation_id::text||'|'||coalesce(p_causation_id::text,'')||'|'||
    coalesce(p_trace_id,'')||'|'||coalesce(p_request_id::text,'')||'|'||
    p_schema_version::text||'|'||p_producer||'|'||v_payload_hash||'|'||p_event_contract_hash
  ,'sha256'),'hex');

  SELECT * INTO v_existing
  FROM operations.operational_events
  WHERE source_id=v_source_id AND source_event_id=p_source_event_id;

  IF FOUND THEN
    IF v_existing.event_envelope_hash<>v_envelope_hash THEN
      RAISE EXCEPTION 'Source event ID collision with different authoritative envelope/content';
    END IF;
    RETURN QUERY SELECT v_existing.event_id,false;
    RETURN;
  END IF;

  INSERT INTO operations.operational_events(
    source_id,source_event_id,event_type,occurred_at,severity,classification,
    subject_type,subject_id,correlation_id,causation_id,trace_id,request_id,
    idempotency_key,schema_version,payload,payload_hash,event_contract_hash,event_envelope_hash,producer
  ) VALUES(
    v_source_id,p_source_event_id,p_event_type,p_occurred_at,p_severity,p_classification,
    p_subject_type,p_subject_id,p_correlation_id,p_causation_id,p_trace_id,p_request_id,
    encode(extensions.digest(v_source_id::text||'|'||p_source_event_id,'sha256'),'hex'),
    p_schema_version,p_payload,v_payload_hash,p_event_contract_hash,v_envelope_hash,p_producer
  ) RETURNING operations.operational_events.event_id INTO v_event_id;

  INSERT INTO operations.event_processing(
    event_id,processing_state,next_attempt_at,decision_basis_at
  ) VALUES(v_event_id,'PENDING',clock_timestamp(),clock_timestamp());

  INSERT INTO operations.event_planning_outbox(event_id,available_at)
  VALUES(v_event_id,clock_timestamp());

  RETURN QUERY SELECT v_event_id,true;
END $$;

-- ---------------------------------------------------------------------------
-- 11. Slice registry.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS operations.domain10_slice_contracts(
  slice_code text PRIMARY KEY,
  contract_version text NOT NULL,
  migration_id integer NOT NULL,
  installed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

INSERT INTO operations.domain10_slice_contracts(slice_code,contract_version,migration_id)
VALUES('10B','2.0.0',514)
ON CONFLICT(slice_code) DO UPDATE
SET contract_version=excluded.contract_version,
    migration_id=excluded.migration_id,
    installed_at=clock_timestamp();


-- ---------------------------------------------------------------------------
-- 12. Decision row immutability permits only the one-time sealing transition.
--     Candidate-set hash is included in decision_hash from first insert.
-- ---------------------------------------------------------------------------

DROP TRIGGER IF EXISTS trg_notification_decision_hash ON operations.notification_decisions;
CREATE OR REPLACE FUNCTION operations.compute_notification_decision_hash()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE material text;
BEGIN
  material:=NEW.event_id::text||'|'||NEW.decision_outcome||'|'||
    coalesce(NEW.notification_id::text,'')||'|'||coalesce(NEW.selected_policy_id::text,'')||'|'||
    coalesce(NEW.selected_policy_version::text,'')||'|'||coalesce(NEW.selected_definition_hash,'')||'|'||
    NEW.decision_reason||'|'||NEW.decision_context::text||'|'||
    coalesce(NEW.candidate_set_hash,'')||'|'||
    NEW.correlation_id::text||'|'||coalesce(NEW.trace_id,'')||'|'||NEW.engine_version||'|'||
    NEW.decided_at::text;
  NEW.decision_hash:=encode(extensions.digest(material,'sha256'),'hex');
  RETURN NEW;
END $$;

CREATE TRIGGER trg_notification_decision_hash
BEFORE INSERT ON operations.notification_decisions
FOR EACH ROW EXECUTE FUNCTION operations.compute_notification_decision_hash();

DROP TRIGGER IF EXISTS trg_notification_decision_immutable ON operations.notification_decisions;
CREATE OR REPLACE FUNCTION operations.guard_notification_decision_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'notification decision evidence is append-only';
  END IF;

  IF OLD.sealed_at IS NULL
     AND NEW.sealed_at IS NOT NULL
     AND ROW(
       NEW.event_id,NEW.decision_outcome,NEW.notification_id,NEW.selected_policy_id,
       NEW.selected_policy_version,NEW.selected_definition_hash,NEW.decision_reason,
       NEW.decision_context,NEW.decision_hash,NEW.candidate_set_hash,NEW.correlation_id,
       NEW.trace_id,NEW.engine_version,NEW.decided_at
     ) IS NOT DISTINCT FROM ROW(
       OLD.event_id,OLD.decision_outcome,OLD.notification_id,OLD.selected_policy_id,
       OLD.selected_policy_version,OLD.selected_definition_hash,OLD.decision_reason,
       OLD.decision_context,OLD.decision_hash,OLD.candidate_set_hash,OLD.correlation_id,
       OLD.trace_id,OLD.engine_version,OLD.decided_at
     )
  THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'sealed notification decision evidence is immutable';
END $$;

CREATE TRIGGER trg_notification_decision_immutable
BEFORE UPDATE OR DELETE ON operations.notification_decisions
FOR EACH ROW EXECUTE FUNCTION operations.guard_notification_decision_mutation();

-- Temporal contract windows must close when versions are retired.
ALTER TABLE operations.notification_policy_versions
  DROP CONSTRAINT IF EXISTS chk_retired_policy_has_effective_until;
ALTER TABLE operations.notification_policy_versions
  ADD CONSTRAINT chk_retired_policy_has_effective_until
  CHECK(lifecycle_state<>'RETIRED' OR effective_until IS NOT NULL);

ALTER TABLE operations.event_contract_versions
  DROP CONSTRAINT IF EXISTS chk_retired_event_contract_has_effective_until;
ALTER TABLE operations.event_contract_versions
  ADD CONSTRAINT chk_retired_event_contract_has_effective_until
  CHECK(lifecycle_state<>'RETIRED' OR effective_until IS NOT NULL);

COMMIT;
