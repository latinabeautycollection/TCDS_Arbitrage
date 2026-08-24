-- 10D hardening pass: immutability, safe state transitions, configuration hashes.
BEGIN;

CREATE OR REPLACE FUNCTION operations.verify_incident_escalation_binding_hash_10d() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE expected text;
BEGIN
 expected:=encode(extensions.digest(NEW.escalation_policy_id::text||'|'||NEW.step_number::text||'|'||NEW.event_type||'|'||NEW.event_schema_version::text||'|'||NEW.notification_policy_id::text||'|'||NEW.notification_policy_version::text,'sha256'),'hex');
 IF NEW.binding_hash<>expected THEN RAISE EXCEPTION '10D escalation binding hash mismatch'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER trg_incident_escalation_binding_hash_10d BEFORE INSERT OR UPDATE ON operations.incident_escalation_bindings_10d FOR EACH ROW EXECUTE FUNCTION operations.verify_incident_escalation_binding_hash_10d();

CREATE OR REPLACE FUNCTION operations.guard_incident_escalation_binding_mutation_10d() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' AND EXISTS(SELECT 1 FROM operations.incident_escalation_plan_snapshots_10d s WHERE s.escalation_policy_id=OLD.escalation_policy_id AND s.step_number=OLD.step_number) THEN RAISE EXCEPTION 'Binding referenced by incident snapshot cannot be deleted'; END IF;
 IF TG_OP='UPDATE' AND EXISTS(SELECT 1 FROM operations.incident_escalation_plan_snapshots_10d s WHERE s.escalation_policy_id=OLD.escalation_policy_id AND s.step_number=OLD.step_number AND s.binding_hash=OLD.binding_hash) AND
   ROW(NEW.escalation_policy_id,NEW.step_number,NEW.event_type,NEW.event_schema_version,NEW.notification_policy_id,NEW.notification_policy_version,NEW.binding_hash)
   IS DISTINCT FROM ROW(OLD.escalation_policy_id,OLD.step_number,OLD.event_type,OLD.event_schema_version,OLD.notification_policy_id,OLD.notification_policy_version,OLD.binding_hash)
 THEN RAISE EXCEPTION 'Binding definition referenced by active/history incident snapshots is immutable'; END IF;
 RETURN COALESCE(NEW,OLD);
END $$;
CREATE TRIGGER trg_incident_escalation_binding_guard_10d BEFORE UPDATE OR DELETE ON operations.incident_escalation_bindings_10d FOR EACH ROW EXECUTE FUNCTION operations.guard_incident_escalation_binding_mutation_10d();

CREATE OR REPLACE FUNCTION operations.guard_incident_runtime_transition_10d() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE ok boolean:=false;
BEGIN
 IF NEW.state=OLD.state THEN RETURN NEW; END IF;
 ok:=(OLD.state='PENDING' AND NEW.state IN('CLAIMED','CANCELLED','BLOCKED_CONFIGURATION')) OR
     (OLD.state='CLAIMED' AND NEW.state IN('PENDING','WAITING_SETTLEMENT','CANCELLED','BLOCKED_CONFIGURATION')) OR
     (OLD.state='WAITING_SETTLEMENT' AND NEW.state IN('PENDING','COMPLETE','CANCELLED')) OR
     (OLD.state='BLOCKED_CONFIGURATION' AND NEW.state='CANCELLED');
 IF NOT ok THEN RAISE EXCEPTION 'Invalid 10D escalation runtime transition % -> %',OLD.state,NEW.state; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER trg_incident_escalation_runtime_transition_10d BEFORE UPDATE OF state ON operations.incident_escalation_runtime_10d FOR EACH ROW EXECUTE FUNCTION operations.guard_incident_runtime_transition_10d();

CREATE OR REPLACE FUNCTION operations.guard_incident_emission_transition_10d() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE ok boolean:=false;
BEGIN
 IF NEW.state=OLD.state THEN RETURN NEW; END IF;
 ok:=(OLD.state='PREPARED' AND NEW.state IN('EMITTED','FAILED')) OR
     (OLD.state='EMITTED' AND NEW.state IN('WAITING_DELIVERY','SETTLED','FAILED')) OR
     (OLD.state='WAITING_DELIVERY' AND NEW.state IN('SETTLED','FAILED'));
 IF NOT ok THEN RAISE EXCEPTION 'Invalid 10D escalation emission transition % -> %',OLD.state,NEW.state; END IF;
 IF OLD.state='SETTLED' THEN RAISE EXCEPTION 'Settled escalation emission is immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER trg_incident_escalation_emission_transition_10d BEFORE UPDATE OF state ON operations.incident_escalation_emissions_10d FOR EACH ROW EXECUTE FUNCTION operations.guard_incident_emission_transition_10d();

-- No incident-required notification may silently lack 10D activation work.
CREATE OR REPLACE FUNCTION operations.assert_incident_activation_coverage_10d() RETURNS TABLE(notification_id uuid) LANGUAGE sql STABLE AS $$
 SELECT n.notification_id FROM operations.notification_requests n WHERE n.incident_required
 AND NOT EXISTS(SELECT 1 FROM operations.incidents i WHERE i.notification_id=n.notification_id)
 AND NOT EXISTS(SELECT 1 FROM operations.incident_activation_queue_10d q WHERE q.notification_id=n.notification_id AND q.state IN('PENDING','CLAIMED'));
$$;

COMMIT;
