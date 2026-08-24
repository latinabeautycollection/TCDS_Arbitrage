-- ============================================================================
-- TCDS DOMAIN 10 / SLICE 10E — HARDENING
-- ============================================================================

BEGIN;

-- Runs are immutable after COMPLETE/FAILED; identity is always immutable.
CREATE OR REPLACE FUNCTION operations.guard_assurance_run_10e()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION '10E assurance runs cannot be deleted';
  END IF;

  IF ROW(
    NEW.policy_id,NEW.policy_version,NEW.policy_key,NEW.metric_key,
    NEW.window_start,NEW.window_end,NEW.threshold_value,NEW.comparison,NEW.created_at
  ) IS DISTINCT FROM ROW(
    OLD.policy_id,OLD.policy_version,OLD.policy_key,OLD.metric_key,
    OLD.window_start,OLD.window_end,OLD.threshold_value,OLD.comparison,OLD.created_at
  ) THEN
    RAISE EXCEPTION '10E assurance run identity is immutable';
  END IF;

  IF OLD.state IN('COMPLETE','FAILED') THEN
    RAISE EXCEPTION 'Completed/failed 10E assurance run is immutable';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER trg_guard_assurance_run_10e
BEFORE UPDATE OR DELETE ON operations.communication_assurance_runs_10e
FOR EACH ROW EXECUTE FUNCTION operations.guard_assurance_run_10e();

CREATE OR REPLACE FUNCTION operations.guard_assurance_episode_10e()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION '10E assurance episodes cannot be deleted';
  END IF;
  IF ROW(
    NEW.policy_id,NEW.policy_version,NEW.opened_run_id,NEW.opened_at,
    NEW.correlation_id,NEW.created_at
  ) IS DISTINCT FROM ROW(
    OLD.policy_id,OLD.policy_version,OLD.opened_run_id,OLD.opened_at,
    OLD.correlation_id,OLD.created_at
  ) THEN
    RAISE EXCEPTION '10E assurance episode identity is immutable';
  END IF;
  IF OLD.state='RECOVERED' THEN
    RAISE EXCEPTION 'Recovered 10E assurance episode is immutable';
  END IF;
  IF OLD.state='OPEN' AND NEW.state NOT IN('OPEN','RECOVERED') THEN
    RAISE EXCEPTION 'Invalid 10E assurance episode transition';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER trg_guard_assurance_episode_10e
BEFORE UPDATE OR DELETE ON operations.communication_assurance_episodes_10e
FOR EACH ROW EXECUTE FUNCTION operations.guard_assurance_episode_10e();

CREATE OR REPLACE FUNCTION operations.guard_assurance_event_10e()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION '10E assurance event evidence cannot be deleted';
  END IF;
  IF ROW(
    NEW.episode_id,NEW.run_id,NEW.source_event_id,NEW.event_type,NEW.severity,
    NEW.subject_id,NEW.correlation_id,NEW.payload,NEW.created_at
  ) IS DISTINCT FROM ROW(
    OLD.episode_id,OLD.run_id,OLD.source_event_id,OLD.event_type,OLD.severity,
    OLD.subject_id,OLD.correlation_id,OLD.payload,OLD.created_at
  ) THEN
    RAISE EXCEPTION '10E assurance event identity/payload is immutable';
  END IF;
  IF OLD.state IN('EMITTED','FAILED') THEN
    RAISE EXCEPTION 'Terminal 10E assurance event is immutable';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER trg_guard_assurance_event_10e
BEFORE UPDATE OR DELETE ON operations.communication_assurance_events_10e
FOR EACH ROW EXECUTE FUNCTION operations.guard_assurance_event_10e();

-- Prevent ERROR/INSUFFICIENT_DATA from opening or recovering an episode.
CREATE OR REPLACE FUNCTION operations.assert_assurance_episode_evidence_10e()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE ro text; rr text;
BEGIN
  SELECT outcome INTO ro FROM operations.communication_assurance_runs_10e WHERE run_id=NEW.opened_run_id;
  IF ro<>'BREACH' THEN RAISE EXCEPTION '10E episode must open from BREACH run'; END IF;

  IF NEW.state='RECOVERED' THEN
    SELECT outcome INTO rr FROM operations.communication_assurance_runs_10e WHERE run_id=NEW.recovered_run_id;
    IF rr<>'PASS' THEN RAISE EXCEPTION '10E episode recovery requires PASS run'; END IF;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER trg_assert_assurance_episode_evidence_10e
BEFORE INSERT OR UPDATE OF state,recovered_run_id
ON operations.communication_assurance_episodes_10e
FOR EACH ROW EXECUTE FUNCTION operations.assert_assurance_episode_evidence_10e();

COMMIT;
