-- ============================================================================
-- TCDS DOMAIN 10 / SLICE 10D
-- Incident Lifecycle, Acknowledgement & Escalation Engine
-- Prerequisites: reviewed 10A 510-512, reviewed 10B 513-515, reviewed 10C 516-518
--
-- OWNERSHIP:
-- 10A owns incidents, incident events/assignments/acks/escalations/executions,
--     notification truth, recipients/audiences, policy truth and audit truth.
-- 10B owns event intake, notification decision/planning, audience/channel/template decisions.
-- 10C owns provider delivery execution and provider-outcome reconciliation.
-- 10D owns only incident orchestration/runtime control and acknowledgement/escalation execution.
-- ============================================================================
BEGIN;

CREATE TABLE operations.incident_activation_queue_10d(
 activation_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 notification_id uuid NOT NULL UNIQUE REFERENCES operations.notification_requests(notification_id),
 state text NOT NULL DEFAULT 'PENDING' CHECK(state IN('PENDING','CLAIMED','COMPLETED','FAILED_FINAL')),
 attempt_count integer NOT NULL DEFAULT 0 CHECK(attempt_count>=0),
 available_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 lease_owner text,lease_expires_at timestamptz,last_error text,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE INDEX idx_incident_activation_10d_claim ON operations.incident_activation_queue_10d(state,available_at,lease_expires_at,created_at);
CREATE TRIGGER trg_incident_activation_10d_updated BEFORE UPDATE ON operations.incident_activation_queue_10d FOR EACH ROW EXECUTE FUNCTION operations.set_updated_at();

CREATE TABLE operations.incident_runtime_10d(
 incident_id uuid PRIMARY KEY REFERENCES operations.incidents(incident_id),
 source_notification_id uuid NOT NULL UNIQUE REFERENCES operations.notification_requests(notification_id),
 escalation_state text NOT NULL DEFAULT 'NONE' CHECK(escalation_state IN('NONE','ACTIVE','BLOCKED_CONFIGURATION','COMPLETE')),
 escalation_plan_hash text,
 configuration_error text,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TRIGGER trg_incident_runtime_10d_updated BEFORE UPDATE ON operations.incident_runtime_10d FOR EACH ROW EXECUTE FUNCTION operations.set_updated_at();

CREATE TABLE operations.incident_escalation_bindings_10d(
 binding_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 escalation_policy_id uuid NOT NULL REFERENCES operations.escalation_policies(escalation_policy_id),
 step_number integer NOT NULL CHECK(step_number>0),
 event_type text NOT NULL REFERENCES operations.event_types(event_type),
 event_schema_version integer NOT NULL CHECK(event_schema_version>0),
 notification_policy_id uuid NOT NULL,
 notification_policy_version integer NOT NULL CHECK(notification_policy_version>0),
 enabled boolean NOT NULL DEFAULT true,
 binding_hash text NOT NULL,
 approved_by text NOT NULL,approval_reference text,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(escalation_policy_id,step_number),
 FOREIGN KEY(notification_policy_id,notification_policy_version)
   REFERENCES operations.notification_policy_versions(policy_id,version),
 FOREIGN KEY(event_type,event_schema_version)
   REFERENCES operations.event_contract_versions(event_type,schema_version));

CREATE TABLE operations.incident_escalation_plan_snapshots_10d(
 incident_id uuid NOT NULL REFERENCES operations.incidents(incident_id),
 step_number integer NOT NULL CHECK(step_number>0),
 escalation_policy_id uuid NOT NULL REFERENCES operations.escalation_policies(escalation_policy_id),
 escalation_policy_key text NOT NULL,
 wait_seconds integer NOT NULL CHECK(wait_seconds>=0),
 target_audience_id uuid NOT NULL REFERENCES operations.notification_audiences(audience_id),
 target_audience_key text NOT NULL,
 use_email boolean NOT NULL,use_sms boolean NOT NULL,require_ack boolean NOT NULL,
 repeat_count integer NOT NULL CHECK(repeat_count BETWEEN 1 AND 10),
 repeat_interval_seconds integer NOT NULL CHECK(repeat_interval_seconds>=60),
 event_type text,event_schema_version integer,
 notification_policy_id uuid,notification_policy_version integer,
 binding_hash text,binding_valid boolean NOT NULL,validation_error text,
 snapshot_hash text NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(incident_id,step_number));

CREATE OR REPLACE FUNCTION operations.deny_incident_plan_snapshot_mutation_10d() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'incident_escalation_plan_snapshots_10d is immutable'; END $$;
CREATE TRIGGER trg_incident_plan_snapshot_10d_immutable BEFORE UPDATE OR DELETE ON operations.incident_escalation_plan_snapshots_10d
FOR EACH ROW EXECUTE FUNCTION operations.deny_incident_plan_snapshot_mutation_10d();

CREATE TABLE operations.incident_ack_deadlines_10d(
 deadline_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),incident_id uuid NOT NULL UNIQUE REFERENCES operations.incidents(incident_id),
 notification_id uuid NOT NULL REFERENCES operations.notification_requests(notification_id),due_at timestamptz NOT NULL,
 state text NOT NULL DEFAULT 'PENDING' CHECK(state IN('PENDING','CLAIMED','BREACHED','SATISFIED','CANCELLED')),
 lease_owner text,lease_expires_at timestamptz,breached_at timestamptz,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE INDEX idx_incident_ack_deadline_10d_claim ON operations.incident_ack_deadlines_10d(state,due_at,lease_expires_at);
CREATE TRIGGER trg_incident_ack_deadline_10d_updated BEFORE UPDATE ON operations.incident_ack_deadlines_10d FOR EACH ROW EXECUTE FUNCTION operations.set_updated_at();

CREATE TABLE operations.incident_escalation_runtime_10d(
 runtime_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),incident_id uuid NOT NULL REFERENCES operations.incidents(incident_id),
 escalation_id uuid NOT NULL UNIQUE REFERENCES operations.incident_escalations(escalation_id),step_number integer NOT NULL CHECK(step_number>0),
 require_ack boolean NOT NULL,max_repeats integer NOT NULL CHECK(max_repeats BETWEEN 1 AND 10),
 next_repeat_number integer NOT NULL DEFAULT 1 CHECK(next_repeat_number>0),repeat_interval_seconds integer NOT NULL CHECK(repeat_interval_seconds>=60),
 next_due_at timestamptz NOT NULL,state text NOT NULL DEFAULT 'PENDING' CHECK(state IN('PENDING','CLAIMED','WAITING_SETTLEMENT','COMPLETE','CANCELLED','BLOCKED_CONFIGURATION')),
 cancel_requested boolean NOT NULL DEFAULT false,lease_owner text,lease_expires_at timestamptz,last_error text,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(incident_id,step_number));
CREATE INDEX idx_incident_escalation_runtime_10d_claim ON operations.incident_escalation_runtime_10d(state,next_due_at,lease_expires_at);
CREATE TRIGGER trg_incident_escalation_runtime_10d_updated BEFORE UPDATE ON operations.incident_escalation_runtime_10d FOR EACH ROW EXECUTE FUNCTION operations.set_updated_at();

CREATE TABLE operations.incident_commands_10d(
 command_id text PRIMARY KEY,incident_id uuid NOT NULL REFERENCES operations.incidents(incident_id),recipient_id uuid NOT NULL REFERENCES operations.recipient_directory(recipient_id),
 source text NOT NULL CHECK(source IN('SMS','APPLICATION')),command text NOT NULL CHECK(command IN('ACK','OWN','DECLINE')),
 occurred_at timestamptz NOT NULL,evidence_hash text NOT NULL,correlation_id uuid NOT NULL,
 outcome text NOT NULL DEFAULT 'RECEIVED' CHECK(outcome IN('RECEIVED','APPLIED','NOOP','REJECTED')),reason text,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),completed_at timestamptz);
CREATE INDEX idx_incident_commands_10d_incident ON operations.incident_commands_10d(incident_id,occurred_at);

CREATE OR REPLACE FUNCTION operations.guard_incident_command_evidence_10d() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'incident_commands_10d cannot be deleted'; END IF;
 IF OLD.outcome<>'RECEIVED' THEN RAISE EXCEPTION 'completed incident command evidence is immutable'; END IF;
 IF NEW.command_id<>OLD.command_id OR NEW.incident_id<>OLD.incident_id OR NEW.recipient_id<>OLD.recipient_id OR NEW.source<>OLD.source OR NEW.command<>OLD.command OR NEW.occurred_at<>OLD.occurred_at OR NEW.evidence_hash<>OLD.evidence_hash THEN
   RAISE EXCEPTION 'incident command identity is immutable';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER trg_incident_commands_10d_guard BEFORE UPDATE OR DELETE ON operations.incident_commands_10d FOR EACH ROW EXECUTE FUNCTION operations.guard_incident_command_evidence_10d();

CREATE TABLE operations.incident_escalation_emissions_10d(
 emission_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),runtime_id uuid NOT NULL REFERENCES operations.incident_escalation_runtime_10d(runtime_id),
 escalation_id uuid NOT NULL REFERENCES operations.incident_escalations(escalation_id),repeat_number integer NOT NULL CHECK(repeat_number>0),
 source_event_id text NOT NULL,event_type text NOT NULL,event_schema_version integer NOT NULL,
 bound_notification_policy_id uuid NOT NULL,bound_notification_policy_version integer NOT NULL,
 operational_event_id uuid REFERENCES operations.operational_events(event_id),notification_id uuid REFERENCES operations.notification_requests(notification_id),
 state text NOT NULL DEFAULT 'PREPARED' CHECK(state IN('PREPARED','EMITTED','WAITING_DELIVERY','SETTLED','FAILED')),
 outcome text CHECK(outcome IN('SENT','SUPPRESSED','CANCELLED','FAILED')),reason text,
 available_at timestamptz NOT NULL DEFAULT clock_timestamp(),lease_owner text,lease_expires_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),settled_at timestamptz,
 UNIQUE(escalation_id,repeat_number),UNIQUE(source_event_id));
CREATE INDEX idx_incident_escalation_emission_10d_settle ON operations.incident_escalation_emissions_10d(state,available_at,lease_expires_at);
CREATE TRIGGER trg_incident_escalation_emission_10d_updated BEFORE UPDATE ON operations.incident_escalation_emissions_10d FOR EACH ROW EXECUTE FUNCTION operations.set_updated_at();

-- Queue every 10B-created incident-required notification without changing 10B planning.
CREATE OR REPLACE FUNCTION operations.enqueue_incident_activation_10d() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.incident_required THEN
   INSERT INTO operations.incident_activation_queue_10d(notification_id) VALUES(NEW.notification_id) ON CONFLICT(notification_id) DO NOTHING;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER trg_notification_request_incident_activation_10d AFTER INSERT ON operations.notification_requests
FOR EACH ROW EXECUTE FUNCTION operations.enqueue_incident_activation_10d();

INSERT INTO operations.incident_activation_queue_10d(notification_id)
SELECT n.notification_id FROM operations.notification_requests n
WHERE n.incident_required AND NOT EXISTS(SELECT 1 FROM operations.incidents i WHERE i.notification_id=n.notification_id)
ON CONFLICT(notification_id) DO NOTHING;

-- Validate that 10D escalation uses an exact 10B policy matching the 10A step.
CREATE OR REPLACE FUNCTION operations.validate_incident_escalation_binding_10d(p_binding_id uuid)
RETURNS text LANGUAGE plpgsql STABLE AS $$
DECLARE b operations.incident_escalation_bindings_10d%ROWTYPE; s operations.escalation_steps%ROWTYPE; v operations.notification_policy_versions%ROWTYPE; c int;
BEGIN
 SELECT * INTO b FROM operations.incident_escalation_bindings_10d WHERE binding_id=p_binding_id AND enabled;
 IF NOT FOUND THEN RETURN 'BINDING_DISABLED_OR_MISSING'; END IF;
 SELECT * INTO s FROM operations.escalation_steps WHERE escalation_policy_id=b.escalation_policy_id AND step_number=b.step_number;
 IF NOT FOUND THEN RETURN 'ESCALATION_STEP_MISSING'; END IF;
 SELECT * INTO v FROM operations.notification_policy_versions WHERE policy_id=b.notification_policy_id AND version=b.notification_policy_version;
 IF NOT FOUND OR v.lifecycle_state<>'FROZEN' THEN RETURN 'BOUND_10B_POLICY_NOT_FROZEN'; END IF;
 IF v.event_type_pattern<>b.event_type THEN RETURN 'BOUND_10B_POLICY_EVENT_TYPE_MISMATCH'; END IF;
 IF v.audience_id<>s.audience_id THEN RETURN 'BOUND_10B_POLICY_AUDIENCE_MISMATCH'; END IF;
 IF v.email_enabled<>s.use_email OR v.sms_enabled<>s.use_sms THEN RETURN 'BOUND_10B_POLICY_CHANNEL_MISMATCH'; END IF;
 IF v.acknowledgement_required<>s.require_ack THEN RETURN 'BOUND_10B_POLICY_ACK_MISMATCH'; END IF;
 IF v.incident_required THEN RETURN 'BOUND_10B_POLICY_RECURSIVE_INCIDENT'; END IF;
 IF NOT EXISTS(SELECT 1 FROM operations.event_contract_versions ec WHERE ec.event_type=b.event_type AND ec.schema_version=b.event_schema_version AND ec.lifecycle_state='FROZEN') THEN RETURN 'BOUND_10B_EVENT_CONTRACT_NOT_FROZEN'; END IF;
 SELECT count(*) INTO c FROM operations.notification_policy_versions x
 WHERE x.lifecycle_state='FROZEN' AND operations.event_type_pattern_matches(x.event_type_pattern,b.event_type)
   AND x.decision_priority=v.decision_priority
   AND length(replace(x.event_type_pattern,'*',''))=length(replace(v.event_type_pattern,'*',''));
 IF c<>1 THEN RETURN 'BOUND_10B_POLICY_PRECEDENCE_NOT_UNIQUE'; END IF;
 RETURN 'OK';
END $$;

CREATE OR REPLACE FUNCTION operations.claim_incident_activation_10d(p_worker_id text,p_batch_size int DEFAULT 20,p_lease_seconds int DEFAULT 120)
RETURNS TABLE(activation_id uuid,notification_id uuid,attempt_count int) LANGUAGE plpgsql AS $$
BEGIN
 IF p_batch_size<1 OR p_batch_size>100 OR p_lease_seconds<30 OR p_lease_seconds>600 THEN RAISE EXCEPTION 'Invalid incident activation claim'; END IF;
 UPDATE operations.incident_activation_queue_10d SET state='PENDING',lease_owner=NULL,lease_expires_at=NULL
 WHERE state='CLAIMED' AND lease_expires_at<clock_timestamp();
 RETURN QUERY WITH picked AS(
  SELECT q.activation_id FROM operations.incident_activation_queue_10d q WHERE q.state='PENDING' AND q.available_at<=clock_timestamp()
  ORDER BY q.available_at,q.created_at FOR UPDATE OF q SKIP LOCKED LIMIT p_batch_size)
 UPDATE operations.incident_activation_queue_10d q SET state='CLAIMED',attempt_count=q.attempt_count+1,lease_owner=p_worker_id,
 lease_expires_at=clock_timestamp()+make_interval(secs=>p_lease_seconds)
 FROM picked p WHERE q.activation_id=p.activation_id RETURNING q.activation_id,q.notification_id,q.attempt_count;
END $$;

CREATE OR REPLACE FUNCTION operations.activate_incident_from_notification_10d(p_notification_id uuid,p_worker_id text)
RETURNS TABLE(incident_id uuid,incident_key text,created boolean,escalation_state text)
LANGUAGE plpgsql AS $$
DECLARE n operations.notification_requests%ROWTYPE; e operations.operational_events%ROWTYPE; pv operations.notification_policy_versions%ROWTYPE;
 v_incident_id uuid;v_key text;v_created boolean:=false;v_policy_key text;v_bad int:=0;v_plan_material text:='';
BEGIN
 PERFORM pg_advisory_xact_lock(hashtext(p_notification_id::text));
 IF NOT EXISTS(SELECT 1 FROM operations.incident_activation_queue_10d WHERE notification_id=p_notification_id AND state='CLAIMED' AND lease_owner=p_worker_id AND lease_expires_at>clock_timestamp()) THEN
   RAISE EXCEPTION 'Incident activation lease lost';
 END IF;
 SELECT * INTO n FROM operations.notification_requests WHERE notification_id=p_notification_id;
 IF NOT FOUND OR NOT n.incident_required THEN RAISE EXCEPTION 'Notification is not incident-required'; END IF;
 SELECT * INTO e FROM operations.operational_events WHERE event_id=n.event_id;
 SELECT * INTO pv FROM operations.notification_policy_versions WHERE policy_id=n.policy_id AND version=n.policy_version;

 SELECT i.incident_id,i.incident_key INTO v_incident_id,v_key FROM operations.incidents i WHERE i.notification_id=p_notification_id ORDER BY i.opened_at LIMIT 1;
 IF v_incident_id IS NULL THEN
   v_incident_id:=gen_random_uuid();v_key:='INC-'||to_char(clock_timestamp(),'YYYYMMDD')||'-'||upper(substr(replace(v_incident_id::text,'-',''),1,10));
   INSERT INTO operations.incidents(incident_id,incident_key,root_event_id,notification_id,status,severity,title,summary,owner_audience_id,correlation_id)
   VALUES(v_incident_id,v_key,e.event_id,p_notification_id,'OPEN',n.severity,'['||n.severity||'] '||e.event_type,
          'Incident created from authoritative operational event '||e.event_id::text||' and notification '||p_notification_id::text||'.',pv.audience_id,n.correlation_id);
   INSERT INTO operations.incident_events(incident_id,event_type,to_status,actor_type,actor_id,details,correlation_id)
   VALUES(v_incident_id,'INCIDENT_OPENED','OPEN','SYSTEM','DOMAIN10_10D',jsonb_build_object('notification_id',p_notification_id,'event_id',e.event_id),n.correlation_id);
   INSERT INTO operations.incident_assignments(incident_id,audience_id,assignment_role,assigned_by)
   VALUES(v_incident_id,pv.audience_id,'OWNER_AUDIENCE','DOMAIN10_10D');
   v_created:=true;
 END IF;

 INSERT INTO operations.incident_runtime_10d(incident_id,source_notification_id,escalation_state)
 VALUES(v_incident_id,p_notification_id,CASE WHEN pv.escalation_policy_id IS NULL THEN 'NONE' ELSE 'ACTIVE' END)
 ON CONFLICT(incident_id) DO NOTHING;

 IF n.acknowledgement_required THEN
   INSERT INTO operations.incident_ack_deadlines_10d(incident_id,notification_id,due_at)
   VALUES(v_incident_id,p_notification_id,n.acknowledgement_due_at) ON CONFLICT(incident_id) DO NOTHING;
 END IF;

 IF pv.escalation_policy_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM operations.incident_escalation_plan_snapshots_10d WHERE incident_id=v_incident_id) THEN
   SELECT policy_key INTO v_policy_key FROM operations.escalation_policies WHERE escalation_policy_id=pv.escalation_policy_id;
   WITH steps AS(
    SELECT s.*,sum(s.wait_seconds) OVER(ORDER BY s.step_number) AS cumulative_wait,a.audience_key,
           b.binding_id,b.event_type,b.event_schema_version,b.notification_policy_id,b.notification_policy_version,b.binding_hash,
           CASE WHEN b.binding_id IS NULL THEN 'BINDING_MISSING' ELSE operations.validate_incident_escalation_binding_10d(b.binding_id) END AS validation
    FROM operations.escalation_steps s JOIN operations.notification_audiences a ON a.audience_id=s.audience_id
    LEFT JOIN operations.incident_escalation_bindings_10d b ON b.escalation_policy_id=s.escalation_policy_id AND b.step_number=s.step_number AND b.enabled
    WHERE s.escalation_policy_id=pv.escalation_policy_id ORDER BY s.step_number
   ),ins AS(
    INSERT INTO operations.incident_escalation_plan_snapshots_10d(
      incident_id,step_number,escalation_policy_id,escalation_policy_key,wait_seconds,target_audience_id,target_audience_key,
      use_email,use_sms,require_ack,repeat_count,repeat_interval_seconds,event_type,event_schema_version,notification_policy_id,
      notification_policy_version,binding_hash,binding_valid,validation_error,snapshot_hash)
    SELECT v_incident_id,step_number,escalation_policy_id,v_policy_key,wait_seconds,audience_id,audience_key,use_email,use_sms,require_ack,repeat_count,
      greatest(wait_seconds,60),event_type,event_schema_version,notification_policy_id,notification_policy_version,binding_hash,validation='OK',
      CASE WHEN validation='OK' THEN NULL ELSE validation END,
      encode(extensions.digest(step_number::text||'|'||wait_seconds::text||'|'||audience_id::text||'|'||use_email::text||'|'||use_sms::text||'|'||require_ack::text||'|'||repeat_count::text||'|'||coalesce(binding_hash,''),'sha256'),'hex')
    FROM steps RETURNING *
   ) SELECT count(*) FILTER(WHERE NOT binding_valid) INTO v_bad FROM ins;

   INSERT INTO operations.incident_escalations(incident_id,escalation_policy_id,step_number,target_audience_id,scheduled_at,reason,correlation_id)
   SELECT v_incident_id,s.escalation_policy_id,s.step_number,s.target_audience_id,
     (SELECT opened_at FROM operations.incidents WHERE incident_id=v_incident_id)+make_interval(secs=>sum(s.wait_seconds) OVER(ORDER BY s.step_number)),
     'Escalation step '||s.step_number||' from frozen 10D incident plan snapshot',n.correlation_id
   FROM operations.incident_escalation_plan_snapshots_10d s WHERE s.incident_id=v_incident_id
   ON CONFLICT(incident_id,escalation_policy_id,step_number) DO NOTHING;

   INSERT INTO operations.incident_escalation_runtime_10d(incident_id,escalation_id,step_number,require_ack,max_repeats,repeat_interval_seconds,next_due_at,state,last_error)
   SELECT v_incident_id,ie.escalation_id,s.step_number,s.require_ack,s.repeat_count,s.repeat_interval_seconds,ie.scheduled_at,
     CASE WHEN s.binding_valid THEN 'PENDING' ELSE 'BLOCKED_CONFIGURATION' END,s.validation_error
   FROM operations.incident_escalations ie JOIN operations.incident_escalation_plan_snapshots_10d s ON s.incident_id=ie.incident_id AND s.step_number=ie.step_number
   WHERE ie.incident_id=v_incident_id ON CONFLICT(incident_id,step_number) DO NOTHING;

   SELECT string_agg(snapshot_hash,'|' ORDER BY step_number) INTO v_plan_material FROM operations.incident_escalation_plan_snapshots_10d WHERE incident_id=v_incident_id;
   UPDATE operations.incident_runtime_10d SET escalation_state=CASE WHEN v_bad>0 THEN 'BLOCKED_CONFIGURATION' ELSE 'ACTIVE' END,
     escalation_plan_hash=encode(extensions.digest(coalesce(v_plan_material,''),'sha256'),'hex'),configuration_error=CASE WHEN v_bad>0 THEN 'One or more escalation bindings are invalid' ELSE NULL END
   WHERE incident_id=v_incident_id;
   IF v_bad>0 THEN
     INSERT INTO operations.incident_events(incident_id,event_type,actor_type,actor_id,details,correlation_id)
     VALUES(v_incident_id,'ESCALATION_CONFIGURATION_BLOCKED','SYSTEM','DOMAIN10_10D',jsonb_build_object('invalid_steps',v_bad),n.correlation_id);
   END IF;
 END IF;

 UPDATE operations.incident_activation_queue_10d SET state='COMPLETED',lease_owner=NULL,lease_expires_at=NULL,last_error=NULL WHERE notification_id=p_notification_id;
 INSERT INTO operations.audit_ledger(entity_type,entity_id,action,actor_type,actor_id,correlation_id,details,record_hash)
 VALUES('INCIDENT',v_incident_id::text,'INCIDENT_ACTIVATED','SYSTEM','DOMAIN10_10D',n.correlation_id,jsonb_build_object('notification_id',p_notification_id,'created',v_created),'DB_TRIGGER_REPLACES');
 RETURN QUERY SELECT v_incident_id,v_key,v_created,(SELECT escalation_state FROM operations.incident_runtime_10d WHERE incident_id=v_incident_id);
END $$;

CREATE OR REPLACE FUNCTION operations.fail_incident_activation_10d(p_notification_id uuid,p_worker_id text,p_error text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 UPDATE operations.incident_activation_queue_10d SET state=CASE WHEN attempt_count>=5 THEN 'FAILED_FINAL' ELSE 'PENDING' END,
 available_at=CASE WHEN attempt_count>=5 THEN available_at ELSE clock_timestamp()+interval '30 seconds' END,lease_owner=NULL,lease_expires_at=NULL,last_error=left(p_error,1000)
 WHERE notification_id=p_notification_id AND state='CLAIMED' AND lease_owner=p_worker_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Incident activation lease lost'; END IF;
END $$;

-- Current incident actor authorization reuses 10A/10B recipient/audience truth.
CREATE OR REPLACE FUNCTION operations.incident_actor_authorized_10d(p_incident_id uuid,p_recipient_id uuid,p_require_owner boolean DEFAULT false)
RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE i operations.incidents%ROWTYPE;e operations.operational_events%ROWTYPE;
BEGIN
 SELECT * INTO i FROM operations.incidents WHERE incident_id=p_incident_id; IF NOT FOUND THEN RETURN false; END IF;
 IF EXISTS(SELECT 1 FROM operations.incident_assignments a WHERE a.incident_id=p_incident_id AND a.recipient_id=p_recipient_id AND a.released_at IS NULL) THEN RETURN true; END IF;
 SELECT * INTO e FROM operations.operational_events WHERE event_id=i.root_event_id;
 IF i.owner_audience_id IS NOT NULL AND EXISTS(SELECT 1 FROM operations.resolve_authorized_audience(i.owner_audience_id,e.event_type,e.classification,clock_timestamp()) r WHERE r.recipient_id=p_recipient_id) THEN RETURN true; END IF;
 IF NOT p_require_owner AND EXISTS(SELECT 1 FROM operations.notification_recipients nr WHERE nr.notification_id=i.notification_id AND nr.recipient_id=p_recipient_id) THEN RETURN true; END IF;
 RETURN false;
END $$;

CREATE OR REPLACE FUNCTION operations.apply_incident_command_10d(
 p_command_id text,p_source text,p_incident_key text,p_recipient_id uuid,p_command text,p_occurred_at timestamptz,p_correlation_id uuid,p_evidence_hash text)
RETURNS TABLE(command_id text,incident_id uuid,outcome text,reason text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=operations,pg_temp AS $$
DECLARE i operations.incidents%ROWTYPE;v_existing operations.incident_commands_10d%ROWTYPE;v_outcome text:='APPLIED';v_reason text:='COMMAND_APPLIED';
BEGIN
 IF p_source NOT IN('SMS','APPLICATION') OR p_command NOT IN('ACK','OWN','DECLINE') OR btrim(coalesce(p_command_id,''))='' OR btrim(coalesce(p_evidence_hash,''))='' THEN RAISE EXCEPTION 'Invalid incident command contract'; END IF;
 PERFORM pg_advisory_xact_lock(hashtext(p_command_id));
 SELECT * INTO v_existing FROM operations.incident_commands_10d WHERE incident_commands_10d.command_id=p_command_id;
 IF FOUND THEN RETURN QUERY SELECT v_existing.command_id,v_existing.incident_id,v_existing.outcome,coalesce(v_existing.reason,'DUPLICATE'); RETURN; END IF;
 SELECT * INTO i FROM operations.incidents WHERE incidents.incident_key=upper(p_incident_key) FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Incident not found'; END IF;
 INSERT INTO operations.incident_commands_10d(command_id,incident_id,recipient_id,source,command,occurred_at,evidence_hash,correlation_id)
 VALUES(p_command_id,i.incident_id,p_recipient_id,p_source,p_command,p_occurred_at,p_evidence_hash,p_correlation_id);

 IF NOT operations.incident_actor_authorized_10d(i.incident_id,p_recipient_id,false) THEN
   v_outcome:='REJECTED';v_reason:='ACTOR_NOT_AUTHORIZED';
 ELSE
   INSERT INTO operations.incident_acknowledgements(incident_id,notification_id,recipient_id,channel,acknowledgement_type,acknowledged_at,correlation_id)
   VALUES(i.incident_id,i.notification_id,p_recipient_id,p_source,p_command,p_occurred_at,p_correlation_id)
   ON CONFLICT(incident_id,recipient_id,acknowledgement_type) DO NOTHING;

   IF p_command IN('ACK','OWN') THEN
     IF i.status='OPEN' THEN UPDATE operations.incidents SET status='ACKNOWLEDGED',acknowledged_at=coalesce(acknowledged_at,p_occurred_at) WHERE incidents.incident_id=i.incident_id; END IF;
     UPDATE operations.incident_ack_deadlines_10d SET state='SATISFIED',lease_owner=NULL,lease_expires_at=NULL WHERE incident_ack_deadlines_10d.incident_id=i.incident_id AND state IN('PENDING','CLAIMED');
     UPDATE operations.incident_escalation_runtime_10d SET state='CANCELLED',cancel_requested=true,lease_owner=NULL,lease_expires_at=NULL
       WHERE incident_escalation_runtime_10d.incident_id=i.incident_id AND require_ack AND state IN('PENDING','BLOCKED_CONFIGURATION');
     UPDATE operations.incident_escalation_runtime_10d SET cancel_requested=true WHERE incident_escalation_runtime_10d.incident_id=i.incident_id AND require_ack AND state IN('CLAIMED','WAITING_SETTLEMENT');
   END IF;
   IF p_command='OWN' AND NOT EXISTS(SELECT 1 FROM operations.incident_assignments a WHERE a.incident_id=i.incident_id AND a.recipient_id=p_recipient_id AND a.released_at IS NULL) THEN
     INSERT INTO operations.incident_assignments(incident_id,recipient_id,assignment_role,assigned_by) VALUES(i.incident_id,p_recipient_id,'PRIMARY_RESPONDER',p_recipient_id::text);
   ELSIF p_command='DECLINE' THEN
     UPDATE operations.incident_assignments SET released_at=clock_timestamp() WHERE incident_assignments.incident_id=i.incident_id AND recipient_id=p_recipient_id AND released_at IS NULL;
   END IF;

   INSERT INTO operations.incident_events(incident_id,event_type,actor_type,actor_id,details,correlation_id)
   VALUES(i.incident_id,'INCIDENT_'||p_command,'RECIPIENT',p_recipient_id::text,jsonb_build_object('source',p_source,'command_id',p_command_id),p_correlation_id);
 END IF;
 UPDATE operations.incident_commands_10d SET outcome=v_outcome,reason=v_reason,completed_at=clock_timestamp() WHERE incident_commands_10d.command_id=p_command_id;
 INSERT INTO operations.audit_ledger(entity_type,entity_id,action,actor_type,actor_id,correlation_id,details,record_hash)
 VALUES('INCIDENT',i.incident_id::text,'INCIDENT_COMMAND_'||v_outcome,'RECIPIENT',p_recipient_id::text,p_correlation_id,jsonb_build_object('command',p_command,'source',p_source,'reason',v_reason),'DB_TRIGGER_REPLACES');
 RETURN QUERY SELECT p_command_id,i.incident_id,v_outcome,v_reason;
END $$;

CREATE OR REPLACE FUNCTION operations.transition_incident_10d(p_incident_id uuid,p_actor_recipient_id uuid,p_target_status text,p_resolution_code text,p_reason text,p_correlation_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=operations,pg_temp AS $$
DECLARE i operations.incidents%ROWTYPE;v_owner_required boolean;
BEGIN
 SELECT * INTO i FROM operations.incidents WHERE incident_id=p_incident_id FOR UPDATE; IF NOT FOUND THEN RAISE EXCEPTION 'Incident not found'; END IF;
 IF p_target_status NOT IN('INVESTIGATING','MITIGATED','RESOLVED','CLOSED','CANCELLED') THEN RAISE EXCEPTION 'Unsupported 10D transition target'; END IF;
 v_owner_required:=p_target_status IN('CLOSED','CANCELLED');
 IF NOT operations.incident_actor_authorized_10d(p_incident_id,p_actor_recipient_id,v_owner_required) THEN RAISE EXCEPTION 'Incident actor not authorized'; END IF;
 IF p_target_status='RESOLVED' AND btrim(coalesce(p_resolution_code,''))='' THEN RAISE EXCEPTION 'RESOLVED requires resolution_code'; END IF;
 UPDATE operations.incidents SET status=p_target_status,
   resolved_at=CASE WHEN p_target_status='RESOLVED' THEN clock_timestamp() ELSE resolved_at END,
   closed_at=CASE WHEN p_target_status='CLOSED' THEN clock_timestamp() ELSE closed_at END,
   resolution_code=CASE WHEN p_target_status='RESOLVED' THEN p_resolution_code ELSE resolution_code END
 WHERE incident_id=p_incident_id;
 INSERT INTO operations.incident_events(incident_id,event_type,from_status,to_status,actor_type,actor_id,details,correlation_id)
 VALUES(p_incident_id,'INCIDENT_STATUS_CHANGED',i.status,p_target_status,'RECIPIENT',p_actor_recipient_id::text,jsonb_build_object('reason',p_reason,'resolution_code',p_resolution_code),p_correlation_id);
 IF p_target_status IN('RESOLVED','CLOSED','CANCELLED') THEN
   UPDATE operations.incident_ack_deadlines_10d SET state='CANCELLED',lease_owner=NULL,lease_expires_at=NULL WHERE incident_id=p_incident_id AND state IN('PENDING','CLAIMED');
   UPDATE operations.incident_escalation_runtime_10d SET state='CANCELLED',cancel_requested=true,lease_owner=NULL,lease_expires_at=NULL WHERE incident_id=p_incident_id AND state IN('PENDING','BLOCKED_CONFIGURATION');
   UPDATE operations.incident_escalation_runtime_10d SET cancel_requested=true WHERE incident_id=p_incident_id AND state IN('CLAIMED','WAITING_SETTLEMENT');
 END IF;
 INSERT INTO operations.audit_ledger(entity_type,entity_id,action,actor_type,actor_id,correlation_id,details,record_hash)
 VALUES('INCIDENT',p_incident_id::text,'INCIDENT_TRANSITION','RECIPIENT',p_actor_recipient_id::text,p_correlation_id,jsonb_build_object('from',i.status,'to',p_target_status,'reason',p_reason),'DB_TRIGGER_REPLACES');
END $$;

CREATE OR REPLACE FUNCTION operations.claim_ack_deadlines_10d(p_worker_id text,p_batch_size int DEFAULT 25,p_lease_seconds int DEFAULT 120)
RETURNS TABLE(deadline_id uuid,incident_id uuid) LANGUAGE plpgsql AS $$
BEGIN
 UPDATE operations.incident_ack_deadlines_10d SET state='PENDING',lease_owner=NULL,lease_expires_at=NULL WHERE state='CLAIMED' AND lease_expires_at<clock_timestamp();
 RETURN QUERY WITH p AS(SELECT d.deadline_id FROM operations.incident_ack_deadlines_10d d JOIN operations.incidents i USING(incident_id)
  WHERE d.state='PENDING' AND d.due_at<=clock_timestamp() AND i.status NOT IN('ACKNOWLEDGED','RESOLVED','CLOSED','CANCELLED')
  ORDER BY d.due_at FOR UPDATE OF d SKIP LOCKED LIMIT p_batch_size)
 UPDATE operations.incident_ack_deadlines_10d d SET state='CLAIMED',lease_owner=p_worker_id,lease_expires_at=clock_timestamp()+make_interval(secs=>p_lease_seconds)
 FROM p WHERE d.deadline_id=p.deadline_id RETURNING d.deadline_id,d.incident_id;
END $$;

CREATE OR REPLACE FUNCTION operations.record_ack_deadline_breach_10d(p_deadline_id uuid,p_worker_id text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE d operations.incident_ack_deadlines_10d%ROWTYPE;i operations.incidents%ROWTYPE;
BEGIN
 SELECT * INTO d FROM operations.incident_ack_deadlines_10d WHERE deadline_id=p_deadline_id FOR UPDATE;
 IF NOT FOUND OR d.state<>'CLAIMED' OR d.lease_owner IS DISTINCT FROM p_worker_id OR d.lease_expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'Ack deadline lease lost'; END IF;
 SELECT * INTO i FROM operations.incidents WHERE incident_id=d.incident_id;
 IF i.status IN('ACKNOWLEDGED','RESOLVED','CLOSED','CANCELLED') OR EXISTS(SELECT 1 FROM operations.incident_acknowledgements a WHERE a.incident_id=i.incident_id AND a.acknowledgement_type IN('ACK','OWN')) THEN
   UPDATE operations.incident_ack_deadlines_10d SET state='SATISFIED',lease_owner=NULL,lease_expires_at=NULL WHERE deadline_id=p_deadline_id; RETURN;
 END IF;
 UPDATE operations.incident_ack_deadlines_10d SET state='BREACHED',breached_at=clock_timestamp(),lease_owner=NULL,lease_expires_at=NULL WHERE deadline_id=p_deadline_id;
 INSERT INTO operations.incident_events(incident_id,event_type,actor_type,actor_id,details,correlation_id)
 VALUES(i.incident_id,'ACKNOWLEDGEMENT_DEADLINE_BREACHED','SYSTEM','DOMAIN10_10D',jsonb_build_object('deadline_id',p_deadline_id,'due_at',d.due_at),i.correlation_id);
END $$;

CREATE OR REPLACE FUNCTION operations.claim_due_incident_escalations_10d(p_worker_id text,p_batch_size int DEFAULT 20,p_lease_seconds int DEFAULT 120)
RETURNS TABLE(runtime_id uuid,incident_id uuid,escalation_id uuid,step_number int,next_repeat_number int) LANGUAGE plpgsql AS $$
BEGIN
 UPDATE operations.incident_escalation_runtime_10d SET state='PENDING',lease_owner=NULL,lease_expires_at=NULL WHERE state='CLAIMED' AND lease_expires_at<clock_timestamp();
 RETURN QUERY WITH p AS(
  SELECT r.runtime_id FROM operations.incident_escalation_runtime_10d r JOIN operations.incidents i USING(incident_id)
  WHERE r.state='PENDING' AND NOT r.cancel_requested AND r.next_due_at<=clock_timestamp() AND i.status NOT IN('RESOLVED','CLOSED','CANCELLED')
    AND (NOT r.require_ack OR NOT EXISTS(SELECT 1 FROM operations.incident_acknowledgements a WHERE a.incident_id=r.incident_id AND a.acknowledgement_type IN('ACK','OWN')))
  ORDER BY r.next_due_at,r.step_number FOR UPDATE OF r SKIP LOCKED LIMIT p_batch_size)
 UPDATE operations.incident_escalation_runtime_10d r SET state='CLAIMED',lease_owner=p_worker_id,lease_expires_at=clock_timestamp()+make_interval(secs=>p_lease_seconds)
 FROM p WHERE r.runtime_id=p.runtime_id RETURNING r.runtime_id,r.incident_id,r.escalation_id,r.step_number,r.next_repeat_number;
END $$;

CREATE OR REPLACE FUNCTION operations.prepare_escalation_emission_10d(p_runtime_id uuid,p_worker_id text)
RETURNS TABLE(emission_id uuid,runtime_id uuid,incident_id uuid,incident_key text,source_event_id text,event_type text,schema_version int,severity text,classification text,correlation_id uuid,root_event_id uuid,source_notification_id uuid,escalation_policy_key text,step_number int,repeat_number int,target_audience_key text,reason text)
LANGUAGE plpgsql AS $$
DECLARE r operations.incident_escalation_runtime_10d%ROWTYPE;i operations.incidents%ROWTYPE;s operations.incident_escalation_plan_snapshots_10d%ROWTYPE;e operations.operational_events%ROWTYPE;em operations.incident_escalation_emissions_10d%ROWTYPE;v_validation text;
BEGIN
 SELECT * INTO r FROM operations.incident_escalation_runtime_10d WHERE incident_escalation_runtime_10d.runtime_id=p_runtime_id FOR UPDATE;
 IF NOT FOUND OR r.state<>'CLAIMED' OR r.lease_owner IS DISTINCT FROM p_worker_id OR r.lease_expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'Escalation runtime lease lost'; END IF;
 SELECT * INTO i FROM operations.incidents WHERE incidents.incident_id=r.incident_id;
 IF r.cancel_requested OR i.status IN('RESOLVED','CLOSED','CANCELLED') OR (r.require_ack AND EXISTS(SELECT 1 FROM operations.incident_acknowledgements a WHERE a.incident_id=r.incident_id AND a.acknowledgement_type IN('ACK','OWN'))) THEN
   UPDATE operations.incident_escalation_runtime_10d SET state='CANCELLED',lease_owner=NULL,lease_expires_at=NULL WHERE incident_escalation_runtime_10d.runtime_id=p_runtime_id; RETURN;
 END IF;
 SELECT * INTO s FROM operations.incident_escalation_plan_snapshots_10d WHERE incident_escalation_plan_snapshots_10d.incident_id=r.incident_id AND incident_escalation_plan_snapshots_10d.step_number=r.step_number;
 IF NOT s.binding_valid THEN UPDATE operations.incident_escalation_runtime_10d SET state='BLOCKED_CONFIGURATION',lease_owner=NULL,lease_expires_at=NULL,last_error=s.validation_error WHERE incident_escalation_runtime_10d.runtime_id=p_runtime_id; RETURN; END IF;
 SELECT operations.validate_incident_escalation_binding_10d(b.binding_id) INTO v_validation FROM operations.incident_escalation_bindings_10d b
 WHERE b.escalation_policy_id=s.escalation_policy_id AND b.step_number=s.step_number AND b.binding_hash=s.binding_hash;
 IF v_validation IS DISTINCT FROM 'OK' THEN
   UPDATE operations.incident_escalation_runtime_10d SET state='BLOCKED_CONFIGURATION',lease_owner=NULL,lease_expires_at=NULL,last_error='BINDING_DRIFT:'||coalesce(v_validation,'MISSING') WHERE incident_escalation_runtime_10d.runtime_id=p_runtime_id;
   INSERT INTO operations.incident_events(incident_id,event_type,actor_type,actor_id,details,correlation_id) VALUES(i.incident_id,'ESCALATION_BINDING_DRIFT_BLOCKED','SYSTEM','DOMAIN10_10D',jsonb_build_object('step',r.step_number,'validation',v_validation),i.correlation_id); RETURN;
 END IF;
 SELECT * INTO e FROM operations.operational_events WHERE operational_events.event_id=i.root_event_id;
 SELECT * INTO em FROM operations.incident_escalation_emissions_10d WHERE escalation_id=r.escalation_id AND repeat_number=r.next_repeat_number;
 IF NOT FOUND THEN
   INSERT INTO operations.incident_escalation_emissions_10d(runtime_id,escalation_id,repeat_number,source_event_id,event_type,event_schema_version,bound_notification_policy_id,bound_notification_policy_version)
   VALUES(r.runtime_id,r.escalation_id,r.next_repeat_number,'INC_ESC:'||r.escalation_id::text||':'||r.next_repeat_number::text,s.event_type,s.event_schema_version,s.notification_policy_id,s.notification_policy_version)
   RETURNING * INTO em;
 END IF;
 RETURN QUERY SELECT em.emission_id,r.runtime_id,i.incident_id,i.incident_key,em.source_event_id,em.event_type,em.event_schema_version,i.severity,e.classification,i.correlation_id,i.root_event_id,i.notification_id,s.escalation_policy_key,r.step_number,r.next_repeat_number,s.target_audience_key,
   'Incident '||i.incident_key||' escalation step '||r.step_number||' repeat '||r.next_repeat_number;
END $$;

CREATE OR REPLACE FUNCTION operations.mark_escalation_event_emitted_10d(p_emission_id uuid,p_worker_id text,p_event_id uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE em operations.incident_escalation_emissions_10d%ROWTYPE;r operations.incident_escalation_runtime_10d%ROWTYPE;
BEGIN
 SELECT * INTO em FROM operations.incident_escalation_emissions_10d WHERE emission_id=p_emission_id FOR UPDATE; IF NOT FOUND THEN RAISE EXCEPTION 'Emission missing'; END IF;
 SELECT * INTO r FROM operations.incident_escalation_runtime_10d WHERE runtime_id=em.runtime_id FOR UPDATE;
 IF r.state<>'CLAIMED' OR r.lease_owner IS DISTINCT FROM p_worker_id OR r.lease_expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'Escalation emission lease lost'; END IF;
 UPDATE operations.incident_escalation_emissions_10d SET operational_event_id=p_event_id,state='EMITTED',available_at=clock_timestamp()+interval '1 second',lease_owner=NULL,lease_expires_at=NULL WHERE emission_id=p_emission_id;
 UPDATE operations.incident_escalation_runtime_10d SET state='WAITING_SETTLEMENT',lease_owner=NULL,lease_expires_at=NULL WHERE runtime_id=r.runtime_id;
END $$;

CREATE OR REPLACE FUNCTION operations.fail_escalation_emission_10d(p_runtime_id uuid,p_worker_id text,p_error text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 UPDATE operations.incident_escalation_runtime_10d SET state='PENDING',next_due_at=clock_timestamp()+interval '30 seconds',lease_owner=NULL,lease_expires_at=NULL,last_error=left(p_error,1000)
 WHERE runtime_id=p_runtime_id AND state='CLAIMED' AND lease_owner=p_worker_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Escalation runtime lease lost'; END IF;
END $$;

CREATE OR REPLACE FUNCTION operations.claim_escalation_settlements_10d(p_worker_id text,p_batch_size int DEFAULT 25,p_lease_seconds int DEFAULT 120)
RETURNS TABLE(emission_id uuid) LANGUAGE plpgsql AS $$
BEGIN
 UPDATE operations.incident_escalation_emissions_10d SET lease_owner=NULL,lease_expires_at=NULL WHERE state IN('EMITTED','WAITING_DELIVERY') AND lease_expires_at<clock_timestamp();
 RETURN QUERY WITH p AS(SELECT e.emission_id FROM operations.incident_escalation_emissions_10d e WHERE e.state IN('EMITTED','WAITING_DELIVERY') AND e.available_at<=clock_timestamp() AND (e.lease_expires_at IS NULL OR e.lease_expires_at<clock_timestamp()) ORDER BY e.available_at,e.created_at FOR UPDATE OF e SKIP LOCKED LIMIT p_batch_size)
 UPDATE operations.incident_escalation_emissions_10d e SET lease_owner=p_worker_id,lease_expires_at=clock_timestamp()+make_interval(secs=>p_lease_seconds) FROM p WHERE e.emission_id=p.emission_id RETURNING e.emission_id;
END $$;

CREATE OR REPLACE FUNCTION operations.settle_escalation_emission_10d(p_emission_id uuid,p_worker_id text)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE em operations.incident_escalation_emissions_10d%ROWTYPE;r operations.incident_escalation_runtime_10d%ROWTYPE;i operations.incidents%ROWTYPE;d operations.notification_decisions%ROWTYPE;
 v_pending int;v_success int;v_failed int;v_suppressed int;v_cancelled int;v_total int;v_outcome text;v_details jsonb;v_notification uuid;
BEGIN
 SELECT * INTO em FROM operations.incident_escalation_emissions_10d WHERE emission_id=p_emission_id FOR UPDATE;
 IF NOT FOUND OR em.state NOT IN('EMITTED','WAITING_DELIVERY') OR em.lease_owner IS DISTINCT FROM p_worker_id OR em.lease_expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'Escalation settlement lease lost'; END IF;
 SELECT * INTO r FROM operations.incident_escalation_runtime_10d WHERE runtime_id=em.runtime_id FOR UPDATE; SELECT * INTO i FROM operations.incidents WHERE incident_id=r.incident_id;
 SELECT * INTO d FROM operations.notification_decisions WHERE event_id=em.operational_event_id;
 IF NOT FOUND THEN UPDATE operations.incident_escalation_emissions_10d SET state='EMITTED',available_at=clock_timestamp()+interval '2 seconds',lease_owner=NULL,lease_expires_at=NULL WHERE emission_id=p_emission_id; RETURN 'PENDING'; END IF;

 IF d.decision_outcome='NOTIFY' THEN
   IF d.selected_policy_id IS DISTINCT FROM em.bound_notification_policy_id OR d.selected_policy_version IS DISTINCT FROM em.bound_notification_policy_version THEN
     v_outcome:='FAILED';v_details=jsonb_build_object('reason','BOUND_POLICY_MISMATCH','selected_policy_id',d.selected_policy_id,'selected_policy_version',d.selected_policy_version);
   ELSE
     v_notification:=d.notification_id;
     SELECT count(*),count(*) FILTER(WHERE state IN('PENDING','CLAIMED','SENDING','FAILED_RETRYABLE','UNKNOWN_PROVIDER_OUTCOME')),
       count(*) FILTER(WHERE state IN('ACCEPTED_BY_PROVIDER','DELIVERED')),
       count(*) FILTER(WHERE state IN('FAILED_FINAL','DEAD_LETTERED')),
       count(*) FILTER(WHERE state='SUPPRESSED'),count(*) FILTER(WHERE state='CANCELLED')
     INTO v_total,v_pending,v_success,v_failed,v_suppressed,v_cancelled FROM operations.notification_deliveries WHERE notification_id=v_notification;
     IF v_total=0 OR v_pending>0 THEN
       UPDATE operations.incident_escalation_emissions_10d SET state='WAITING_DELIVERY',notification_id=v_notification,available_at=clock_timestamp()+interval '5 seconds',lease_owner=NULL,lease_expires_at=NULL WHERE emission_id=p_emission_id; RETURN 'PENDING';
     END IF;
     IF v_success>0 THEN v_outcome:='SENT';
     ELSIF v_suppressed=v_total THEN v_outcome:='SUPPRESSED';
     ELSIF v_cancelled=v_total THEN v_outcome:='CANCELLED';
     ELSE v_outcome:='FAILED'; END IF;
     v_details=jsonb_build_object('delivery_total',v_total,'success',v_success,'failed',v_failed,'suppressed',v_suppressed,'cancelled',v_cancelled,'partial_failure',(v_success>0 AND v_failed>0));
   END IF;
 ELSIF d.decision_outcome='SUPPRESSED' THEN v_outcome:='SUPPRESSED';v_details=jsonb_build_object('decision','SUPPRESSED');
 ELSIF d.decision_outcome='NO_RECIPIENTS' THEN v_outcome:='SUPPRESSED';v_details=jsonb_build_object('decision','NO_RECIPIENTS');
 ELSE v_outcome:='FAILED';v_details=jsonb_build_object('decision',d.decision_outcome); END IF;

 INSERT INTO operations.incident_escalation_executions(escalation_id,repeat_number,execution_notification_id,outcome,details)
 VALUES(em.escalation_id,em.repeat_number,v_notification,v_outcome,v_details) ON CONFLICT(escalation_id,repeat_number) DO NOTHING;
 UPDATE operations.incident_escalations SET executed_at=coalesce(executed_at,clock_timestamp()),execution_notification_id=coalesce(execution_notification_id,v_notification) WHERE escalation_id=em.escalation_id;
 UPDATE operations.incident_escalation_emissions_10d SET state='SETTLED',notification_id=v_notification,outcome=v_outcome,reason=v_details::text,settled_at=clock_timestamp(),lease_owner=NULL,lease_expires_at=NULL WHERE emission_id=p_emission_id;

 IF r.cancel_requested OR i.status IN('RESOLVED','CLOSED','CANCELLED') OR (r.require_ack AND EXISTS(SELECT 1 FROM operations.incident_acknowledgements a WHERE a.incident_id=r.incident_id AND a.acknowledgement_type IN('ACK','OWN'))) THEN
   UPDATE operations.incident_escalation_runtime_10d SET state='CANCELLED',lease_owner=NULL,lease_expires_at=NULL WHERE runtime_id=r.runtime_id;
 ELSIF r.next_repeat_number<r.max_repeats THEN
   UPDATE operations.incident_escalation_runtime_10d SET state='PENDING',next_repeat_number=next_repeat_number+1,next_due_at=greatest(next_due_at,clock_timestamp())+make_interval(secs=>repeat_interval_seconds),lease_owner=NULL,lease_expires_at=NULL,last_error=NULL WHERE runtime_id=r.runtime_id;
 ELSE UPDATE operations.incident_escalation_runtime_10d SET state='COMPLETE',lease_owner=NULL,lease_expires_at=NULL,last_error=NULL WHERE runtime_id=r.runtime_id; END IF;

 INSERT INTO operations.incident_events(incident_id,event_type,actor_type,actor_id,details,correlation_id)
 VALUES(i.incident_id,'INCIDENT_ESCALATION_SETTLED','SYSTEM','DOMAIN10_10D',jsonb_build_object('step',r.step_number,'repeat',em.repeat_number,'outcome',v_outcome,'notification_id',v_notification,'delivery_summary',v_details),i.correlation_id);
 RETURN 'SETTLED';
END $$;

COMMIT;
