-- ============================================================================
-- TCDS DOMAIN 10 / SLICE 10D — IN-DEPTH REVIEW HARDENING
-- Migration 522
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION operations.enqueue_incident_activation_10d()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=operations,pg_temp
AS $$
BEGIN
  IF NEW.incident_required THEN
    INSERT INTO operations.incident_activation_queue_10d(notification_id)
    VALUES(NEW.notification_id)
    ON CONFLICT(notification_id) DO NOTHING;
  END IF;
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION operations.incident_actor_authorized_10d(
  p_incident_id uuid,
  p_recipient_id uuid,
  p_require_owner boolean DEFAULT false
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  i operations.incidents%ROWTYPE;
  e operations.operational_events%ROWTYPE;
BEGIN
  SELECT * INTO i FROM operations.incidents WHERE incident_id=p_incident_id;
  IF NOT FOUND THEN RETURN false; END IF;

  SELECT * INTO e FROM operations.operational_events WHERE event_id=i.root_event_id;

  IF p_require_owner THEN
    RETURN i.owner_audience_id IS NOT NULL
      AND EXISTS(
        SELECT 1
        FROM operations.resolve_authorized_audience(
          i.owner_audience_id,e.event_type,e.classification,clock_timestamp()
        ) r
        WHERE r.recipient_id=p_recipient_id
      );
  END IF;

  IF EXISTS(
    SELECT 1 FROM operations.incident_assignments a
    WHERE a.incident_id=p_incident_id
      AND a.recipient_id=p_recipient_id
      AND a.released_at IS NULL
  ) THEN RETURN true; END IF;

  IF i.owner_audience_id IS NOT NULL
     AND EXISTS(
       SELECT 1
       FROM operations.resolve_authorized_audience(
         i.owner_audience_id,e.event_type,e.classification,clock_timestamp()
       ) r
       WHERE r.recipient_id=p_recipient_id
     ) THEN RETURN true; END IF;

  RETURN EXISTS(
    SELECT 1 FROM operations.notification_recipients nr
    WHERE nr.notification_id=i.notification_id
      AND nr.recipient_id=p_recipient_id
  );
END
$$;

CREATE OR REPLACE FUNCTION operations.validate_incident_escalation_binding_for_event_10d(
  p_binding_id uuid,
  p_severity text,
  p_classification text,
  p_effective_at timestamptz
)
RETURNS text
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  b operations.incident_escalation_bindings_10d%ROWTYPE;
  v_base text;
  v_winner_count integer;
  v_winner_policy uuid;
  v_winner_version integer;
BEGIN
  v_base:=operations.validate_incident_escalation_binding_10d(p_binding_id);
  IF v_base<>'OK' THEN RETURN v_base; END IF;

  SELECT * INTO b
  FROM operations.incident_escalation_bindings_10d
  WHERE binding_id=p_binding_id AND enabled;

  WITH candidates AS(
    SELECT v.policy_id,v.version,
           dense_rank() OVER(
             ORDER BY v.decision_priority DESC,
                      length(replace(v.event_type_pattern,'*','')) DESC
           ) rk
    FROM operations.notification_policy_versions v
    WHERE v.lifecycle_state IN('FROZEN','RETIRED')
      AND operations.event_type_pattern_matches(v.event_type_pattern,b.event_type)
      AND operations.severity_rank(p_severity)>=operations.severity_rank(v.minimum_severity)
      AND operations.classification_rank(p_classification)<=operations.classification_rank(v.maximum_classification)
      AND (v.effective_from IS NULL OR v.effective_from<=p_effective_at)
      AND (v.effective_until IS NULL OR v.effective_until>p_effective_at)
  ),
  winners AS(SELECT policy_id,version FROM candidates WHERE rk=1)
  SELECT count(*),min(policy_id),min(version)
  INTO v_winner_count,v_winner_policy,v_winner_version
  FROM winners;

  IF v_winner_count=0 THEN RETURN 'NO_AUTHORITATIVE_10B_POLICY_FOR_ESCALATION_EVENT'; END IF;
  IF v_winner_count>1 THEN RETURN 'AUTHORITATIVE_10B_POLICY_AMBIGUOUS'; END IF;

  IF v_winner_policy IS DISTINCT FROM b.notification_policy_id
     OR v_winner_version IS DISTINCT FROM b.notification_policy_version THEN
    RETURN 'BOUND_10B_POLICY_NOT_AUTHORITATIVE_WINNER';
  END IF;

  RETURN 'OK';
END
$$;

ALTER TABLE operations.incident_escalation_emissions_10d
  ADD COLUMN IF NOT EXISTS emission_attempt_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS max_emission_attempts integer NOT NULL DEFAULT 10;

ALTER TABLE operations.incident_escalation_emissions_10d
  DROP CONSTRAINT IF EXISTS chk_10d_emission_attempt_count,
  DROP CONSTRAINT IF EXISTS chk_10d_emission_max_attempts;

ALTER TABLE operations.incident_escalation_emissions_10d
  ADD CONSTRAINT chk_10d_emission_attempt_count CHECK(emission_attempt_count>=0),
  ADD CONSTRAINT chk_10d_emission_max_attempts CHECK(max_emission_attempts BETWEEN 1 AND 50);

ALTER FUNCTION operations.claim_incident_activation_10d(text,integer,integer) SECURITY DEFINER;
ALTER FUNCTION operations.claim_incident_activation_10d(text,integer,integer) SET search_path=operations,pg_temp;
ALTER FUNCTION operations.activate_incident_from_notification_10d(uuid,text) SECURITY DEFINER;
ALTER FUNCTION operations.activate_incident_from_notification_10d(uuid,text) SET search_path=operations,pg_temp;
ALTER FUNCTION operations.fail_incident_activation_10d(uuid,text,text) SECURITY DEFINER;
ALTER FUNCTION operations.fail_incident_activation_10d(uuid,text,text) SET search_path=operations,pg_temp;
ALTER FUNCTION operations.claim_ack_deadlines_10d(text,integer,integer) SECURITY DEFINER;
ALTER FUNCTION operations.claim_ack_deadlines_10d(text,integer,integer) SET search_path=operations,pg_temp;
ALTER FUNCTION operations.record_ack_deadline_breach_10d(uuid,text) SECURITY DEFINER;
ALTER FUNCTION operations.record_ack_deadline_breach_10d(uuid,text) SET search_path=operations,pg_temp;
ALTER FUNCTION operations.claim_due_incident_escalations_10d(text,integer,integer) SECURITY DEFINER;
ALTER FUNCTION operations.claim_due_incident_escalations_10d(text,integer,integer) SET search_path=operations,pg_temp;
ALTER FUNCTION operations.prepare_escalation_emission_10d(uuid,text) SECURITY DEFINER;
ALTER FUNCTION operations.prepare_escalation_emission_10d(uuid,text) SET search_path=operations,pg_temp;
ALTER FUNCTION operations.mark_escalation_event_emitted_10d(uuid,text,uuid) SECURITY DEFINER;
ALTER FUNCTION operations.mark_escalation_event_emitted_10d(uuid,text,uuid) SET search_path=operations,pg_temp;
ALTER FUNCTION operations.fail_escalation_emission_10d(uuid,text,text) SECURITY DEFINER;
ALTER FUNCTION operations.fail_escalation_emission_10d(uuid,text,text) SET search_path=operations,pg_temp;
ALTER FUNCTION operations.claim_escalation_settlements_10d(text,integer,integer) SECURITY DEFINER;
ALTER FUNCTION operations.claim_escalation_settlements_10d(text,integer,integer) SET search_path=operations,pg_temp;
ALTER FUNCTION operations.settle_escalation_emission_10d(uuid,text) SECURITY DEFINER;
ALTER FUNCTION operations.settle_escalation_emission_10d(uuid,text) SET search_path=operations,pg_temp;

CREATE OR REPLACE FUNCTION operations.apply_incident_command_10d(
  p_command_id text,p_source text,p_incident_key text,p_recipient_id uuid,
  p_command text,p_occurred_at timestamptz,p_correlation_id uuid,p_evidence_hash text
)
RETURNS TABLE(command_id text,incident_id uuid,outcome text,reason text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=operations,pg_temp
AS $$
DECLARE
  i operations.incidents%ROWTYPE;
  v_existing operations.incident_commands_10d%ROWTYPE;
  v_outcome text:='APPLIED';
  v_reason text:='COMMAND_APPLIED';
BEGIN
  IF p_source NOT IN('SMS','APPLICATION')
     OR p_command NOT IN('ACK','OWN','DECLINE')
     OR btrim(coalesce(p_command_id,''))=''
     OR btrim(coalesce(p_evidence_hash,''))='' THEN
    RAISE EXCEPTION 'Invalid incident command contract';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(p_command_id));

  SELECT * INTO v_existing
  FROM operations.incident_commands_10d
  WHERE incident_commands_10d.command_id=p_command_id;

  IF FOUND THEN
    IF v_existing.recipient_id IS DISTINCT FROM p_recipient_id
       OR v_existing.source IS DISTINCT FROM p_source
       OR v_existing.command IS DISTINCT FROM p_command
       OR v_existing.evidence_hash IS DISTINCT FROM p_evidence_hash
       OR v_existing.occurred_at IS DISTINCT FROM p_occurred_at THEN
      RAISE EXCEPTION 'Incident command idempotency collision';
    END IF;
    RETURN QUERY
    SELECT v_existing.command_id,v_existing.incident_id,
           v_existing.outcome,coalesce(v_existing.reason,'DUPLICATE');
    RETURN;
  END IF;

  SELECT * INTO i
  FROM operations.incidents
  WHERE incidents.incident_key=upper(p_incident_key)
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Incident not found'; END IF;

  INSERT INTO operations.incident_commands_10d(
    command_id,incident_id,recipient_id,source,command,occurred_at,
    evidence_hash,correlation_id
  )
  VALUES(
    p_command_id,i.incident_id,p_recipient_id,p_source,p_command,p_occurred_at,
    p_evidence_hash,p_correlation_id
  );

  IF i.status IN('RESOLVED','CLOSED','CANCELLED') THEN
    v_outcome:='NOOP';
    v_reason:='INCIDENT_TERMINAL';
  ELSIF NOT operations.incident_actor_authorized_10d(i.incident_id,p_recipient_id,false) THEN
    v_outcome:='REJECTED';
    v_reason:='ACTOR_NOT_AUTHORIZED';
  ELSE
    INSERT INTO operations.incident_acknowledgements(
      incident_id,notification_id,recipient_id,channel,
      acknowledgement_type,acknowledged_at,correlation_id
    )
    VALUES(
      i.incident_id,i.notification_id,p_recipient_id,p_source,
      p_command,p_occurred_at,p_correlation_id
    )
    ON CONFLICT(incident_id,recipient_id,acknowledgement_type) DO NOTHING;

    IF p_command IN('ACK','OWN') THEN
      IF i.status='OPEN' THEN
        UPDATE operations.incidents
        SET status='ACKNOWLEDGED',
            acknowledged_at=coalesce(acknowledged_at,p_occurred_at)
        WHERE incidents.incident_id=i.incident_id;
      END IF;

      UPDATE operations.incident_ack_deadlines_10d
      SET state='SATISFIED',lease_owner=NULL,lease_expires_at=NULL
      WHERE incident_ack_deadlines_10d.incident_id=i.incident_id
        AND state IN('PENDING','CLAIMED');

      UPDATE operations.incident_escalation_runtime_10d
      SET state='CANCELLED',cancel_requested=true,
          lease_owner=NULL,lease_expires_at=NULL
      WHERE incident_escalation_runtime_10d.incident_id=i.incident_id
        AND require_ack
        AND state IN('PENDING','BLOCKED_CONFIGURATION');

      UPDATE operations.incident_escalation_runtime_10d
      SET cancel_requested=true
      WHERE incident_escalation_runtime_10d.incident_id=i.incident_id
        AND require_ack
        AND state IN('CLAIMED','WAITING_SETTLEMENT');
    END IF;

    IF p_command='OWN'
       AND NOT EXISTS(
         SELECT 1 FROM operations.incident_assignments a
         WHERE a.incident_id=i.incident_id
           AND a.recipient_id=p_recipient_id
           AND a.released_at IS NULL
       ) THEN
      INSERT INTO operations.incident_assignments(
        incident_id,recipient_id,assignment_role,assigned_by
      )
      VALUES(i.incident_id,p_recipient_id,'PRIMARY_RESPONDER',p_recipient_id::text);
    ELSIF p_command='DECLINE' THEN
      UPDATE operations.incident_assignments
      SET released_at=clock_timestamp()
      WHERE incident_assignments.incident_id=i.incident_id
        AND recipient_id=p_recipient_id
        AND released_at IS NULL;
    END IF;

    INSERT INTO operations.incident_events(
      incident_id,event_type,actor_type,actor_id,details,correlation_id
    )
    VALUES(
      i.incident_id,'INCIDENT_'||p_command,'RECIPIENT',p_recipient_id::text,
      jsonb_build_object('source',p_source,'command_id',p_command_id),
      p_correlation_id
    );
  END IF;

  UPDATE operations.incident_commands_10d
  SET outcome=v_outcome,reason=v_reason,completed_at=clock_timestamp()
  WHERE incident_commands_10d.command_id=p_command_id;

  INSERT INTO operations.audit_ledger(
    entity_type,entity_id,action,actor_type,actor_id,
    correlation_id,details,record_hash
  )
  VALUES(
    'INCIDENT',i.incident_id::text,'INCIDENT_COMMAND_'||v_outcome,
    'RECIPIENT',p_recipient_id::text,p_correlation_id,
    jsonb_build_object('command',p_command,'source',p_source,'reason',v_reason),
    'DB_TRIGGER_REPLACES'
  );

  RETURN QUERY SELECT p_command_id,i.incident_id,v_outcome,v_reason;
END
$$;

CREATE OR REPLACE FUNCTION operations.prepare_escalation_emission_10d(
  p_runtime_id uuid,p_worker_id text
)
RETURNS TABLE(
  emission_id uuid,runtime_id uuid,incident_id uuid,incident_key text,
  source_event_id text,event_type text,schema_version int,severity text,
  classification text,correlation_id uuid,root_event_id uuid,
  source_notification_id uuid,escalation_policy_key text,step_number int,
  repeat_number int,target_audience_key text,reason text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=operations,pg_temp
AS $$
DECLARE
  r operations.incident_escalation_runtime_10d%ROWTYPE;
  i operations.incidents%ROWTYPE;
  s operations.incident_escalation_plan_snapshots_10d%ROWTYPE;
  e operations.operational_events%ROWTYPE;
  em operations.incident_escalation_emissions_10d%ROWTYPE;
  v_validation text;
  v_binding_id uuid;
BEGIN
  SELECT * INTO r
  FROM operations.incident_escalation_runtime_10d
  WHERE incident_escalation_runtime_10d.runtime_id=p_runtime_id
  FOR UPDATE;

  IF NOT FOUND OR r.state<>'CLAIMED'
     OR r.lease_owner IS DISTINCT FROM p_worker_id
     OR r.lease_expires_at<=clock_timestamp() THEN
    RAISE EXCEPTION 'Escalation runtime lease lost';
  END IF;

  SELECT * INTO i FROM operations.incidents WHERE incidents.incident_id=r.incident_id;

  IF r.cancel_requested
     OR i.status IN('RESOLVED','CLOSED','CANCELLED')
     OR (
       r.require_ack AND EXISTS(
         SELECT 1 FROM operations.incident_acknowledgements a
         WHERE a.incident_id=r.incident_id
           AND a.acknowledgement_type IN('ACK','OWN')
       )
     ) THEN
    UPDATE operations.incident_escalation_runtime_10d
    SET state='CANCELLED',lease_owner=NULL,lease_expires_at=NULL
    WHERE incident_escalation_runtime_10d.runtime_id=p_runtime_id;
    RETURN;
  END IF;

  SELECT * INTO s
  FROM operations.incident_escalation_plan_snapshots_10d
  WHERE incident_escalation_plan_snapshots_10d.incident_id=r.incident_id
    AND incident_escalation_plan_snapshots_10d.step_number=r.step_number;

  IF NOT s.binding_valid THEN
    UPDATE operations.incident_escalation_runtime_10d
    SET state='BLOCKED_CONFIGURATION',
        lease_owner=NULL,lease_expires_at=NULL,last_error=s.validation_error
    WHERE incident_escalation_runtime_10d.runtime_id=p_runtime_id;
    RETURN;
  END IF;

  SELECT * INTO e
  FROM operations.operational_events
  WHERE operational_events.event_id=i.root_event_id;

  SELECT b.binding_id INTO v_binding_id
  FROM operations.incident_escalation_bindings_10d b
  WHERE b.escalation_policy_id=s.escalation_policy_id
    AND b.step_number=s.step_number
    AND b.binding_hash=s.binding_hash
    AND b.enabled;

  IF v_binding_id IS NULL THEN
    v_validation:='BINDING_MISSING_OR_DISABLED';
  ELSE
    v_validation:=operations.validate_incident_escalation_binding_for_event_10d(
      v_binding_id,i.severity,e.classification,clock_timestamp()
    );
  END IF;

  IF v_validation IS DISTINCT FROM 'OK' THEN
    UPDATE operations.incident_escalation_runtime_10d
    SET state='BLOCKED_CONFIGURATION',
        lease_owner=NULL,lease_expires_at=NULL,
        last_error='BINDING_DRIFT:'||coalesce(v_validation,'MISSING')
    WHERE incident_escalation_runtime_10d.runtime_id=p_runtime_id;

    INSERT INTO operations.incident_events(
      incident_id,event_type,actor_type,actor_id,details,correlation_id
    )
    VALUES(
      i.incident_id,'ESCALATION_BINDING_DRIFT_BLOCKED',
      'SYSTEM','DOMAIN10_10D',
      jsonb_build_object('step',r.step_number,'validation',v_validation),
      i.correlation_id
    );
    RETURN;
  END IF;

  SELECT * INTO em
  FROM operations.incident_escalation_emissions_10d
  WHERE escalation_id=r.escalation_id
    AND repeat_number=r.next_repeat_number
  FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO operations.incident_escalation_emissions_10d(
      runtime_id,escalation_id,repeat_number,source_event_id,event_type,
      event_schema_version,bound_notification_policy_id,
      bound_notification_policy_version
    )
    VALUES(
      r.runtime_id,r.escalation_id,r.next_repeat_number,
      'INC_ESC:'||r.escalation_id::text||':'||r.next_repeat_number::text,
      s.event_type,s.event_schema_version,s.notification_policy_id,
      s.notification_policy_version
    )
    RETURNING * INTO em;
  END IF;

  IF em.state='FAILED' OR em.emission_attempt_count>=em.max_emission_attempts THEN
    UPDATE operations.incident_escalation_runtime_10d
    SET state='COMPLETE',lease_owner=NULL,lease_expires_at=NULL,
        last_error='ESCALATION_EVENT_EMISSION_RETRY_EXHAUSTED'
    WHERE runtime_id=r.runtime_id;

    IF em.state<>'FAILED' THEN
      UPDATE operations.incident_escalation_emissions_10d
      SET state='FAILED',reason='ESCALATION_EVENT_EMISSION_RETRY_EXHAUSTED'
      WHERE emission_id=em.emission_id;
    END IF;
    RETURN;
  END IF;

  UPDATE operations.incident_escalation_emissions_10d
  SET emission_attempt_count=emission_attempt_count+1
  WHERE emission_id=em.emission_id
  RETURNING * INTO em;

  RETURN QUERY
  SELECT em.emission_id,r.runtime_id,i.incident_id,i.incident_key,
    em.source_event_id,em.event_type,em.event_schema_version,
    i.severity,e.classification,i.correlation_id,i.root_event_id,
    i.notification_id,s.escalation_policy_key,r.step_number,
    r.next_repeat_number,s.target_audience_key,
    'Incident '||i.incident_key||' escalation step '||
    r.step_number||' repeat '||r.next_repeat_number;
END
$$;

CREATE OR REPLACE FUNCTION operations.fail_escalation_emission_10d(
  p_runtime_id uuid,p_worker_id text,p_error text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=operations,pg_temp
AS $$
DECLARE
  r operations.incident_escalation_runtime_10d%ROWTYPE;
  em operations.incident_escalation_emissions_10d%ROWTYPE;
BEGIN
  SELECT * INTO r
  FROM operations.incident_escalation_runtime_10d
  WHERE runtime_id=p_runtime_id
  FOR UPDATE;

  IF NOT FOUND OR r.state<>'CLAIMED'
     OR r.lease_owner IS DISTINCT FROM p_worker_id THEN
    RAISE EXCEPTION 'Escalation runtime lease lost';
  END IF;

  SELECT * INTO em
  FROM operations.incident_escalation_emissions_10d
  WHERE escalation_id=r.escalation_id
    AND repeat_number=r.next_repeat_number
  FOR UPDATE;

  IF em.emission_id IS NOT NULL
     AND em.emission_attempt_count>=em.max_emission_attempts THEN
    UPDATE operations.incident_escalation_emissions_10d
    SET state='FAILED',
        reason=left('ESCALATION_EVENT_EMISSION_RETRY_EXHAUSTED: '||p_error,1000)
    WHERE emission_id=em.emission_id AND state='PREPARED';

    UPDATE operations.incident_escalation_runtime_10d
    SET state='COMPLETE',lease_owner=NULL,lease_expires_at=NULL,
        last_error=left('ESCALATION_EVENT_EMISSION_RETRY_EXHAUSTED: '||p_error,1000)
    WHERE runtime_id=p_runtime_id;
  ELSE
    UPDATE operations.incident_escalation_runtime_10d
    SET state='PENDING',
        next_due_at=clock_timestamp()+interval '30 seconds',
        lease_owner=NULL,lease_expires_at=NULL,last_error=left(p_error,1000)
    WHERE runtime_id=p_runtime_id;
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION operations.guard_incident_runtime_transition_10d()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE ok boolean:=false;
BEGIN
  IF NEW.state=OLD.state THEN RETURN NEW; END IF;
  ok:=
    (OLD.state='PENDING' AND NEW.state IN('CLAIMED','CANCELLED','BLOCKED_CONFIGURATION')) OR
    (OLD.state='CLAIMED' AND NEW.state IN('PENDING','WAITING_SETTLEMENT','COMPLETE','CANCELLED','BLOCKED_CONFIGURATION')) OR
    (OLD.state='WAITING_SETTLEMENT' AND NEW.state IN('PENDING','COMPLETE','CANCELLED')) OR
    (OLD.state='BLOCKED_CONFIGURATION' AND NEW.state='CANCELLED');
  IF NOT ok THEN
    RAISE EXCEPTION 'Invalid 10D escalation runtime transition % -> %',OLD.state,NEW.state;
  END IF;
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION operations.guard_incident_emission_identity_10d()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'incident_escalation_emissions_10d cannot be deleted';
  END IF;

  IF ROW(
    NEW.runtime_id,NEW.escalation_id,NEW.repeat_number,NEW.source_event_id,
    NEW.event_type,NEW.event_schema_version,NEW.bound_notification_policy_id,
    NEW.bound_notification_policy_version,NEW.created_at
  ) IS DISTINCT FROM ROW(
    OLD.runtime_id,OLD.escalation_id,OLD.repeat_number,OLD.source_event_id,
    OLD.event_type,OLD.event_schema_version,OLD.bound_notification_policy_id,
    OLD.bound_notification_policy_version,OLD.created_at
  ) THEN
    RAISE EXCEPTION '10D escalation emission identity is immutable';
  END IF;

  IF OLD.state IN('SETTLED','FAILED') THEN
    RAISE EXCEPTION 'settled/failed escalation emission is immutable';
  END IF;

  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_incident_emission_identity_10d
ON operations.incident_escalation_emissions_10d;

CREATE TRIGGER trg_incident_emission_identity_10d
BEFORE UPDATE OR DELETE ON operations.incident_escalation_emissions_10d
FOR EACH ROW EXECUTE FUNCTION operations.guard_incident_emission_identity_10d();

COMMIT;
