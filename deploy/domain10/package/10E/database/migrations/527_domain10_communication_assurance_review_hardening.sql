-- TCDS DOMAIN 10E — IN-DEPTH REVIEW HARDENING (527)
BEGIN;

CREATE OR REPLACE FUNCTION operations.validate_assurance_policy_semantics_10e()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.metric_key LIKE '%_PCT' AND (NEW.threshold_value<0 OR NEW.threshold_value>100) THEN
    RAISE EXCEPTION 'Percentage assurance threshold must be between 0 and 100';
  END IF;
  IF NEW.metric_key LIKE '%_MS' AND NEW.threshold_value<0 THEN
    RAISE EXCEPTION 'Latency assurance threshold cannot be negative';
  END IF;
  IF NEW.metric_key IN('INCIDENT_ACK_WITHIN_SLA_RATE_PCT','INCIDENT_ACK_LATENCY_P95_MS','ESCALATION_SEND_SUCCESS_RATE_PCT')
     AND (NEW.channel IS NOT NULL OR NEW.provider IS NOT NULL) THEN
    RAISE EXCEPTION 'Incident/escalation assurance metrics cannot be scoped by provider/channel';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_validate_assurance_policy_semantics_10e
BEFORE INSERT OR UPDATE OF metric_key,channel,provider,threshold_value
ON operations.communication_assurance_policy_versions_10e
FOR EACH ROW EXECUTE FUNCTION operations.validate_assurance_policy_semantics_10e();

ALTER TABLE operations.communication_assurance_runs_10e
  ADD COLUMN IF NOT EXISTS available_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  ADD COLUMN IF NOT EXISTS max_attempts integer NOT NULL DEFAULT 5;
ALTER TABLE operations.communication_assurance_runs_10e
  ADD CONSTRAINT chk_assurance_run_max_attempts_10e CHECK(max_attempts BETWEEN 1 AND 20);
CREATE INDEX IF NOT EXISTS idx_assurance_runs_10e_retry_claim
ON operations.communication_assurance_runs_10e(state,available_at,window_end,lease_expires_at,created_at);

CREATE OR REPLACE FUNCTION operations.schedule_due_assurance_runs_10e(p_now timestamptz)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=operations,pg_temp AS $$
DECLARE
  p record; v_last_end timestamptz; v_next_end timestamptz; v_latest_mature_end timestamptz;
  v_start timestamptz; v_count integer:=0; v_guard integer;
BEGIN
  FOR p IN
    SELECT ap.policy_id,ap.policy_key,v.*
    FROM operations.communication_assurance_policies_10e ap
    JOIN operations.communication_assurance_policy_versions_10e v ON v.policy_id=ap.policy_id
    WHERE ap.enabled AND v.lifecycle_state='FROZEN'
      AND (v.effective_from IS NULL OR v.effective_from<=p_now)
      AND (v.effective_until IS NULL OR v.effective_until>p_now)
  LOOP
    v_latest_mature_end:=to_timestamp(floor(extract(epoch FROM (p_now-make_interval(secs=>p.maturity_seconds)))/p.window_seconds)*p.window_seconds);
    IF p.effective_from IS NOT NULL AND v_latest_mature_end<=p.effective_from THEN CONTINUE; END IF;
    SELECT max(r.window_end) INTO v_last_end FROM operations.communication_assurance_runs_10e r
      WHERE r.policy_id=p.policy_id AND r.policy_version=p.version;
    IF v_last_end IS NULL THEN v_next_end:=v_latest_mature_end;
    ELSE v_next_end:=v_last_end+make_interval(secs=>p.window_seconds); END IF;
    v_guard:=0;
    WHILE v_next_end<=v_latest_mature_end LOOP
      v_guard:=v_guard+1;
      IF v_guard>500 THEN RAISE EXCEPTION '10E assurance scheduler backfill exceeds 500 windows for % v%',p.policy_key,p.version; END IF;
      v_start:=v_next_end-make_interval(secs=>p.window_seconds);
      IF p.effective_from IS NULL OR v_next_end>p.effective_from THEN
        INSERT INTO operations.communication_assurance_runs_10e(
          policy_id,policy_version,policy_key,metric_key,window_start,window_end,threshold_value,comparison,available_at
        ) VALUES(p.policy_id,p.version,p.policy_key,p.metric_key,v_start,v_next_end,p.threshold_value,p.comparison,clock_timestamp())
        ON CONFLICT(policy_id,policy_version,window_start,window_end) DO NOTHING;
        IF FOUND THEN v_count:=v_count+1; END IF;
      END IF;
      v_next_end:=v_next_end+make_interval(secs=>p.window_seconds);
    END LOOP;
  END LOOP;
  RETURN v_count;
END $$;

CREATE OR REPLACE FUNCTION operations.claim_assurance_runs_10e(p_worker_id text,p_batch_size integer DEFAULT 25,p_lease_seconds integer DEFAULT 180)
RETURNS TABLE(run_id uuid,policy_id uuid,policy_version integer,policy_key text,metric_key text,window_start timestamptz,window_end timestamptz,attempt_count integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=operations,pg_temp AS $$
BEGIN
  IF p_batch_size<1 OR p_batch_size>100 OR p_lease_seconds<30 OR p_lease_seconds>900 THEN RAISE EXCEPTION 'Invalid 10E assurance claim parameters'; END IF;
  UPDATE operations.communication_assurance_runs_10e
  SET state='PENDING',lease_owner=NULL,lease_expires_at=NULL,available_at=clock_timestamp(),
      error_code='ASSURANCE_LEASE_EXPIRED',error_message='Evaluation lease expired before completion'
  WHERE state='CLAIMED' AND lease_expires_at<clock_timestamp() AND attempt_count<max_attempts;
  UPDATE operations.communication_assurance_runs_10e
  SET state='FAILED',outcome='ERROR',evaluated_at=clock_timestamp(),lease_owner=NULL,lease_expires_at=NULL,
      error_code='ASSURANCE_ATTEMPT_EXHAUSTED',error_message='Evaluation retry ceiling exhausted after lease recovery'
  WHERE state='CLAIMED' AND lease_expires_at<clock_timestamp() AND attempt_count>=max_attempts;
  RETURN QUERY
  WITH picked AS(
    SELECT r.run_id FROM operations.communication_assurance_runs_10e r
    WHERE r.state='PENDING' AND r.available_at<=clock_timestamp() AND r.window_end<=clock_timestamp()
      AND r.attempt_count<r.max_attempts AND (r.lease_expires_at IS NULL OR r.lease_expires_at<clock_timestamp())
    ORDER BY r.window_end,r.created_at FOR UPDATE OF r SKIP LOCKED LIMIT p_batch_size
  )
  UPDATE operations.communication_assurance_runs_10e r
  SET state='CLAIMED',attempt_count=r.attempt_count+1,lease_owner=p_worker_id,
      lease_expires_at=clock_timestamp()+make_interval(secs=>p_lease_seconds)
  FROM picked p WHERE r.run_id=p.run_id
  RETURNING r.run_id,r.policy_id,r.policy_version,r.policy_key,r.metric_key,r.window_start,r.window_end,r.attempt_count;
END $$;

CREATE OR REPLACE FUNCTION operations.calculate_assurance_metric_10e(
  p_metric_key text,p_channel text,p_provider text,p_window_start timestamptz,p_window_end timestamptz,p_maturity_seconds integer
)
RETURNS TABLE(sample_size bigint,numerator numeric,denominator numeric,metric_value numeric,unit text)
LANGUAGE plpgsql STABLE AS $$
BEGIN
  IF p_metric_key='PROVIDER_ACCEPTANCE_RATE_PCT' THEN
    RETURN QUERY WITH cohort AS(
      SELECT d.* FROM operations.notification_deliveries d
      WHERE d.created_at>=p_window_start AND d.created_at<p_window_end
        AND (p_channel IS NULL OR d.channel=p_channel) AND (p_provider IS NULL OR d.provider=p_provider)
        AND d.state NOT IN('SUPPRESSED','CANCELLED')
    ) SELECT count(*)::bigint,count(*) FILTER(WHERE provider_accepted_at IS NOT NULL)::numeric,count(*)::numeric,
      CASE WHEN count(*)=0 THEN NULL ELSE 100.0*count(*) FILTER(WHERE provider_accepted_at IS NOT NULL)/count(*) END,'PERCENT'::text FROM cohort;
  ELSIF p_metric_key='PROVIDER_ACCEPTANCE_LATENCY_P95_MS' THEN
    RETURN QUERY SELECT count(*)::bigint,NULL::numeric,NULL::numeric,
      percentile_cont(0.95) WITHIN GROUP(ORDER BY extract(epoch FROM (provider_accepted_at-created_at))*1000.0)::numeric,'MILLISECONDS'::text
      FROM operations.notification_deliveries d WHERE d.created_at>=p_window_start AND d.created_at<p_window_end
      AND d.provider_accepted_at IS NOT NULL AND (p_channel IS NULL OR d.channel=p_channel) AND (p_provider IS NULL OR d.provider=p_provider);
  ELSIF p_metric_key='UNKNOWN_ATTEMPT_RATE_PCT' THEN
    RETURN QUERY SELECT count(*)::bigint,count(*) FILTER(WHERE ambiguous_outcome OR outcome='UNKNOWN')::numeric,count(*)::numeric,
      CASE WHEN count(*)=0 THEN NULL ELSE 100.0*count(*) FILTER(WHERE ambiguous_outcome OR outcome='UNKNOWN')/count(*) END,'PERCENT'::text
      FROM operations.delivery_attempts a JOIN operations.notification_deliveries d ON d.delivery_id=a.delivery_id
      WHERE a.started_at>=p_window_start AND a.started_at<p_window_end
      AND (p_channel IS NULL OR d.channel=p_channel) AND (p_provider IS NULL OR d.provider=p_provider);
  ELSIF p_metric_key='DEAD_LETTER_RATE_PCT' THEN
    RETURN QUERY WITH cohort AS(
      SELECT d.delivery_id FROM operations.notification_deliveries d
      WHERE d.created_at>=p_window_start AND d.created_at<p_window_end
        AND (p_channel IS NULL OR d.channel=p_channel) AND (p_provider IS NULL OR d.provider=p_provider)
        AND d.state NOT IN('SUPPRESSED','CANCELLED')
    ) SELECT count(*)::bigint,count(*) FILTER(WHERE EXISTS(SELECT 1 FROM operations.dead_letters dl WHERE dl.delivery_id=cohort.delivery_id))::numeric,
      count(*)::numeric,CASE WHEN count(*)=0 THEN NULL ELSE 100.0*count(*) FILTER(WHERE EXISTS(SELECT 1 FROM operations.dead_letters dl WHERE dl.delivery_id=cohort.delivery_id))/count(*) END,'PERCENT'::text FROM cohort;
  ELSIF p_metric_key='PROVIDER_HEALTH_AVAILABILITY_PCT' THEN
    RETURN QUERY SELECT count(*)::bigint,count(*) FILTER(WHERE healthy)::numeric,count(*)::numeric,
      CASE WHEN count(*)=0 THEN NULL ELSE 100.0*count(*) FILTER(WHERE healthy)/count(*) END,'PERCENT'::text
      FROM operations.provider_health h WHERE h.sampled_at>=p_window_start AND h.sampled_at<p_window_end
      AND (p_channel IS NULL OR h.channel=p_channel) AND (p_provider IS NULL OR h.provider=p_provider);
  ELSIF p_metric_key='INCIDENT_ACK_WITHIN_SLA_RATE_PCT' THEN
    RETURN QUERY WITH cohort AS(
      SELECT i.incident_id,n.acknowledgement_due_at,
        min(a.acknowledged_at) FILTER(WHERE a.acknowledgement_type IN('ACK','OWN')) AS first_ack
      FROM operations.incidents i JOIN operations.notification_requests n ON n.notification_id=i.notification_id
      LEFT JOIN operations.incident_acknowledgements a ON a.incident_id=i.incident_id
      WHERE n.acknowledgement_required AND n.acknowledgement_due_at>=p_window_start AND n.acknowledgement_due_at<p_window_end
      GROUP BY i.incident_id,n.acknowledgement_due_at
    ) SELECT count(*)::bigint,count(*) FILTER(WHERE first_ack IS NOT NULL AND first_ack<=acknowledgement_due_at)::numeric,count(*)::numeric,
      CASE WHEN count(*)=0 THEN NULL ELSE 100.0*count(*) FILTER(WHERE first_ack IS NOT NULL AND first_ack<=acknowledgement_due_at)/count(*) END,'PERCENT'::text FROM cohort;
  ELSIF p_metric_key='INCIDENT_ACK_LATENCY_P95_MS' THEN
    RETURN QUERY WITH cohort AS(
      SELECT i.opened_at,n.acknowledgement_due_at,
        min(a.acknowledged_at) FILTER(WHERE a.acknowledgement_type IN('ACK','OWN')) AS first_ack
      FROM operations.incidents i JOIN operations.notification_requests n ON n.notification_id=i.notification_id
      LEFT JOIN operations.incident_acknowledgements a ON a.incident_id=i.incident_id
      WHERE n.acknowledgement_required AND n.acknowledgement_due_at>=p_window_start AND n.acknowledgement_due_at<p_window_end
      GROUP BY i.incident_id,i.opened_at,n.acknowledgement_due_at
    ) SELECT count(*) FILTER(WHERE first_ack IS NOT NULL)::bigint,NULL::numeric,NULL::numeric,
      percentile_cont(0.95) WITHIN GROUP(ORDER BY extract(epoch FROM (first_ack-opened_at))*1000.0) FILTER(WHERE first_ack IS NOT NULL)::numeric,'MILLISECONDS'::text FROM cohort;
  ELSIF p_metric_key='ESCALATION_SEND_SUCCESS_RATE_PCT' THEN
    RETURN QUERY SELECT count(*)::bigint,count(*) FILTER(WHERE outcome='SENT')::numeric,count(*)::numeric,
      CASE WHEN count(*)=0 THEN NULL ELSE 100.0*count(*) FILTER(WHERE outcome='SENT')/count(*) END,'PERCENT'::text
      FROM operations.incident_escalation_emissions_10d e
      WHERE e.settled_at>=p_window_start AND e.settled_at<p_window_end AND e.state='SETTLED';
  ELSE
    RAISE EXCEPTION 'Unsupported 10E assurance metric %',p_metric_key;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION operations.update_assurance_episode_10e(p_run_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=operations,pg_temp AS $$
DECLARE
  r operations.communication_assurance_runs_10e%ROWTYPE; v operations.communication_assurance_policy_versions_10e%ROWTYPE;
  ep operations.communication_assurance_episodes_10e%ROWTYPE; x record; v_expected_end timestamptz;
  v_breach_count integer:=0; v_pass_count integer:=0; payload jsonb; evt text; sev text;
BEGIN
  SELECT * INTO r FROM operations.communication_assurance_runs_10e WHERE run_id=p_run_id;
  IF NOT FOUND OR r.state<>'COMPLETE' THEN RAISE EXCEPTION 'Completed 10E assurance run required'; END IF;
  SELECT * INTO v FROM operations.communication_assurance_policy_versions_10e WHERE policy_id=r.policy_id AND version=r.policy_version;
  SELECT * INTO ep FROM operations.communication_assurance_episodes_10e WHERE policy_id=r.policy_id AND policy_version=r.policy_version AND state='OPEN';
  v_expected_end:=r.window_end;
  FOR x IN SELECT outcome,window_start,window_end FROM operations.communication_assurance_runs_10e
    WHERE policy_id=r.policy_id AND policy_version=r.policy_version AND state='COMPLETE' AND window_end<=r.window_end
    ORDER BY window_end DESC LIMIT greatest(v.consecutive_breach_windows,v.consecutive_recovery_windows)
  LOOP
    IF x.window_end IS DISTINCT FROM v_expected_end THEN EXIT; END IF;
    IF x.outcome='BREACH' AND v_pass_count=0 THEN v_breach_count:=v_breach_count+1;
    ELSIF x.outcome='PASS' AND v_breach_count=0 THEN v_pass_count:=v_pass_count+1;
    ELSE EXIT; END IF;
    v_expected_end:=x.window_start;
  END LOOP;
  IF ep.episode_id IS NULL AND r.outcome='BREACH' AND v_breach_count>=v.consecutive_breach_windows THEN
    INSERT INTO operations.communication_assurance_episodes_10e(policy_id,policy_version,opened_run_id)
    VALUES(r.policy_id,r.policy_version,r.run_id) RETURNING * INTO ep;
    evt:='COMMUNICATION_ASSURANCE_BREACH'; sev:=v.breach_severity;
  ELSIF ep.episode_id IS NOT NULL AND r.outcome='PASS' AND v_pass_count>=v.consecutive_recovery_windows THEN
    UPDATE operations.communication_assurance_episodes_10e SET state='RECOVERED',recovered_run_id=r.run_id,recovered_at=clock_timestamp()
    WHERE episode_id=ep.episode_id RETURNING * INTO ep;
    evt:='COMMUNICATION_ASSURANCE_RECOVERY'; sev:='NOTICE';
  END IF;
  IF evt IS NOT NULL THEN
    payload:=jsonb_build_object('assurance_event_id',gen_random_uuid()::text,'episode_id',ep.episode_id::text,'run_id',r.run_id::text,
      'policy_key',r.policy_key,'policy_version',r.policy_version,'metric_key',r.metric_key,'channel',v.channel,'provider',v.provider,
      'window_start',r.window_start,'window_end',r.window_end,'metric_value',r.metric_value,'threshold_value',r.threshold_value,
      'comparison',r.comparison,'sample_size',r.sample_size,'reason',CASE evt WHEN 'COMMUNICATION_ASSURANCE_BREACH' THEN 'CONSECUTIVE_SLO_BREACH' ELSE 'CONSECUTIVE_SLO_RECOVERY' END);
    INSERT INTO operations.communication_assurance_events_10e(
      assurance_event_id,episode_id,run_id,source_event_id,event_type,severity,subject_id,correlation_id,payload
    ) VALUES((payload->>'assurance_event_id')::uuid,ep.episode_id,r.run_id,'ASSURANCE:'||ep.episode_id::text||':'||evt,evt,sev,r.policy_key,ep.correlation_id,payload)
    ON CONFLICT(episode_id,event_type) DO NOTHING;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION operations.fail_assurance_run_10e(p_run_id uuid,p_worker_id text,p_error_code text,p_error_message text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=operations,pg_temp AS $$
DECLARE r operations.communication_assurance_runs_10e%ROWTYPE;
BEGIN
  SELECT * INTO r FROM operations.communication_assurance_runs_10e WHERE run_id=p_run_id FOR UPDATE;
  IF NOT FOUND OR r.state<>'CLAIMED' OR r.lease_owner IS DISTINCT FROM p_worker_id THEN RAISE EXCEPTION '10E assurance run lease lost'; END IF;
  IF r.attempt_count>=r.max_attempts THEN
    UPDATE operations.communication_assurance_runs_10e SET state='FAILED',outcome='ERROR',error_code=left(p_error_code,100),
      error_message=left(p_error_message,1000),evaluated_at=clock_timestamp(),lease_owner=NULL,lease_expires_at=NULL WHERE run_id=p_run_id;
  ELSE
    UPDATE operations.communication_assurance_runs_10e SET state='PENDING',available_at=clock_timestamp()+interval '30 seconds',
      error_code=left(p_error_code,100),error_message=left(p_error_message,1000),lease_owner=NULL,lease_expires_at=NULL WHERE run_id=p_run_id;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_assurance_event_operational_event_10e
ON operations.communication_assurance_events_10e(operational_event_id) WHERE operational_event_id IS NOT NULL;

CREATE OR REPLACE FUNCTION operations.mark_assurance_event_emitted_10e(p_assurance_event_id uuid,p_worker_id text,p_operational_event_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=operations,pg_temp AS $$
DECLARE e operations.communication_assurance_events_10e%ROWTYPE; v_source_key text; v_source_event_id text; v_event_type text;
BEGIN
  SELECT * INTO e FROM operations.communication_assurance_events_10e WHERE assurance_event_id=p_assurance_event_id FOR UPDATE;
  IF NOT FOUND OR e.state<>'CLAIMED' OR e.lease_owner IS DISTINCT FROM p_worker_id OR e.lease_expires_at<=clock_timestamp() THEN
    RAISE EXCEPTION '10E assurance event lease lost';
  END IF;
  SELECT s.source_key,o.source_event_id,o.event_type INTO v_source_key,v_source_event_id,v_event_type
  FROM operations.operational_events o JOIN operations.event_sources s ON s.source_id=o.source_id WHERE o.event_id=p_operational_event_id;
  IF v_source_key IS DISTINCT FROM 'DOMAIN10_ASSURANCE' OR v_source_event_id IS DISTINCT FROM e.source_event_id OR v_event_type IS DISTINCT FROM e.event_type THEN
    RAISE EXCEPTION '10E assurance event linkage does not match reviewed 10B event';
  END IF;
  UPDATE operations.communication_assurance_events_10e SET state='EMITTED',operational_event_id=p_operational_event_id,
    emitted_at=clock_timestamp(),lease_owner=NULL,lease_expires_at=NULL,last_error=NULL WHERE assurance_event_id=p_assurance_event_id;
END $$;

COMMIT;
