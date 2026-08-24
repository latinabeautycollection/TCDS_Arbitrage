-- ============================================================================
-- TCDS DOMAIN 10 / SLICE 10E
-- Communication Assurance, SLO & Compliance Engine
--
-- Ownership:
-- 10A = operational/notification/incident/delivery truth
-- 10B = notification decision authority
-- 10C = provider execution/reconciliation authority
-- 10D = incident/ack/escalation orchestration authority
-- 10E = READ-ONLY assurance evaluation over 10A-10D truth, plus its own
--       SLO/evaluation/episode/event-emission control records.
-- ============================================================================

BEGIN;

CREATE TABLE operations.communication_assurance_policies_10e(
  policy_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_key text NOT NULL UNIQUE CHECK(policy_key ~ '^[A-Z0-9_]+$'),
  description text NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TRIGGER trg_assurance_policy_10e_updated
BEFORE UPDATE ON operations.communication_assurance_policies_10e
FOR EACH ROW EXECUTE FUNCTION operations.set_updated_at();

CREATE TABLE operations.communication_assurance_policy_versions_10e(
  policy_id uuid NOT NULL REFERENCES operations.communication_assurance_policies_10e(policy_id),
  version integer NOT NULL CHECK(version>0),
  lifecycle_state text NOT NULL DEFAULT 'DRAFT'
    CHECK(lifecycle_state IN('DRAFT','FROZEN','RETIRED')),
  metric_key text NOT NULL CHECK(metric_key IN(
    'PROVIDER_ACCEPTANCE_RATE_PCT',
    'PROVIDER_ACCEPTANCE_LATENCY_P95_MS',
    'UNKNOWN_ATTEMPT_RATE_PCT',
    'DEAD_LETTER_RATE_PCT',
    'PROVIDER_HEALTH_AVAILABILITY_PCT',
    'INCIDENT_ACK_WITHIN_SLA_RATE_PCT',
    'INCIDENT_ACK_LATENCY_P95_MS',
    'ESCALATION_SEND_SUCCESS_RATE_PCT'
  )),
  channel text CHECK(channel IN('EMAIL','SMS')),
  provider text CHECK(provider IN('MICROSOFT_GRAPH','TELNYX')),
  window_seconds integer NOT NULL CHECK(window_seconds BETWEEN 60 AND 604800),
  maturity_seconds integer NOT NULL DEFAULT 0 CHECK(maturity_seconds BETWEEN 0 AND 604800),
  comparison text NOT NULL CHECK(comparison IN('LTE','GTE')),
  threshold_value numeric(18,6) NOT NULL,
  minimum_sample_size integer NOT NULL DEFAULT 1 CHECK(minimum_sample_size BETWEEN 1 AND 10000000),
  consecutive_breach_windows integer NOT NULL DEFAULT 2 CHECK(consecutive_breach_windows BETWEEN 1 AND 100),
  consecutive_recovery_windows integer NOT NULL DEFAULT 2 CHECK(consecutive_recovery_windows BETWEEN 1 AND 100),
  breach_severity text NOT NULL DEFAULT 'HIGH'
    CHECK(breach_severity IN('NOTICE','WARNING','HIGH','CRITICAL','EMERGENCY')),
  effective_from timestamptz,
  effective_until timestamptz,
  definition_hash text NOT NULL,
  frozen_at timestamptz,
  frozen_by text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(policy_id,version),
  CHECK(effective_until IS NULL OR effective_from IS NULL OR effective_until>effective_from),
  CHECK(
    provider IS NULL OR
    (provider='MICROSOFT_GRAPH' AND channel='EMAIL') OR
    (provider='TELNYX' AND channel='SMS')
  ),
  CHECK(lifecycle_state='DRAFT' OR (frozen_at IS NOT NULL AND frozen_by IS NOT NULL))
);

CREATE TABLE operations.communication_assurance_runs_10e(
  run_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_id uuid NOT NULL,
  policy_version integer NOT NULL,
  policy_key text NOT NULL,
  metric_key text NOT NULL,
  window_start timestamptz NOT NULL,
  window_end timestamptz NOT NULL,
  state text NOT NULL DEFAULT 'PENDING'
    CHECK(state IN('PENDING','CLAIMED','COMPLETE','FAILED')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK(attempt_count>=0),
  lease_owner text,
  lease_expires_at timestamptz,
  sample_size bigint,
  numerator numeric,
  denominator numeric,
  metric_value numeric,
  unit text CHECK(unit IN('PERCENT','MILLISECONDS')),
  threshold_value numeric NOT NULL,
  comparison text NOT NULL CHECK(comparison IN('LTE','GTE')),
  outcome text CHECK(outcome IN('PASS','BREACH','INSUFFICIENT_DATA','ERROR')),
  result_hash text,
  evaluated_at timestamptz,
  error_code text,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY(policy_id,policy_version)
    REFERENCES operations.communication_assurance_policy_versions_10e(policy_id,version),
  UNIQUE(policy_id,policy_version,window_start,window_end),
  CHECK(window_end>window_start)
);
CREATE INDEX idx_assurance_runs_10e_claim
ON operations.communication_assurance_runs_10e(state,window_end,lease_expires_at,created_at);

CREATE TABLE operations.communication_assurance_episodes_10e(
  episode_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_id uuid NOT NULL,
  policy_version integer NOT NULL,
  opened_run_id uuid NOT NULL REFERENCES operations.communication_assurance_runs_10e(run_id),
  recovered_run_id uuid REFERENCES operations.communication_assurance_runs_10e(run_id),
  state text NOT NULL DEFAULT 'OPEN' CHECK(state IN('OPEN','RECOVERED')),
  opened_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  recovered_at timestamptz,
  correlation_id uuid NOT NULL DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY(policy_id,policy_version)
    REFERENCES operations.communication_assurance_policy_versions_10e(policy_id,version),
  CHECK((state='OPEN' AND recovered_at IS NULL AND recovered_run_id IS NULL)
     OR (state='RECOVERED' AND recovered_at IS NOT NULL AND recovered_run_id IS NOT NULL))
);
CREATE UNIQUE INDEX uq_assurance_episode_10e_open
ON operations.communication_assurance_episodes_10e(policy_id,policy_version)
WHERE state='OPEN';

CREATE TABLE operations.communication_assurance_events_10e(
  assurance_event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  episode_id uuid NOT NULL REFERENCES operations.communication_assurance_episodes_10e(episode_id),
  run_id uuid NOT NULL REFERENCES operations.communication_assurance_runs_10e(run_id),
  source_event_id text NOT NULL UNIQUE,
  event_type text NOT NULL CHECK(event_type IN(
    'COMMUNICATION_ASSURANCE_BREACH','COMMUNICATION_ASSURANCE_RECOVERY'
  )),
  severity text NOT NULL CHECK(severity IN('NOTICE','WARNING','HIGH','CRITICAL','EMERGENCY')),
  subject_id text NOT NULL,
  correlation_id uuid NOT NULL,
  payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object'),
  state text NOT NULL DEFAULT 'PENDING'
    CHECK(state IN('PENDING','CLAIMED','EMITTED','FAILED')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK(attempt_count>=0),
  max_attempts integer NOT NULL DEFAULT 10 CHECK(max_attempts BETWEEN 1 AND 50),
  available_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  lease_owner text,
  lease_expires_at timestamptz,
  operational_event_id uuid REFERENCES operations.operational_events(event_id),
  emitted_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(episode_id,event_type)
);
CREATE INDEX idx_assurance_events_10e_claim
ON operations.communication_assurance_events_10e(state,available_at,lease_expires_at,created_at);

-- ---------------------------------------------------------------------------
-- Policy hash and freeze immutability.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION operations.verify_assurance_policy_hash_10e()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE expected text;
BEGIN
  expected:=encode(extensions.digest(
    NEW.metric_key||'|'||coalesce(NEW.channel,'')||'|'||coalesce(NEW.provider,'')||'|'||
    NEW.window_seconds::text||'|'||NEW.maturity_seconds::text||'|'||
    NEW.comparison||'|'||NEW.threshold_value::text||'|'||
    NEW.minimum_sample_size::text||'|'||NEW.consecutive_breach_windows::text||'|'||
    NEW.consecutive_recovery_windows::text||'|'||NEW.breach_severity||'|'||
    coalesce(NEW.effective_from::text,'')||'|'||coalesce(NEW.effective_until::text,''),
    'sha256'
  ),'hex');
  IF NEW.definition_hash<>expected THEN
    RAISE EXCEPTION '10E assurance policy definition_hash mismatch';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER trg_verify_assurance_policy_hash_10e
BEFORE INSERT OR UPDATE OF
  metric_key,channel,provider,window_seconds,maturity_seconds,comparison,
  threshold_value,minimum_sample_size,consecutive_breach_windows,
  consecutive_recovery_windows,breach_severity,effective_from,effective_until,
  definition_hash
ON operations.communication_assurance_policy_versions_10e
FOR EACH ROW EXECUTE FUNCTION operations.verify_assurance_policy_hash_10e();

CREATE OR REPLACE FUNCTION operations.guard_assurance_policy_version_10e()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP='DELETE' AND OLD.lifecycle_state IN('FROZEN','RETIRED') THEN
    RAISE EXCEPTION 'Frozen/retired 10E assurance policy versions cannot be deleted';
  END IF;
  IF TG_OP='UPDATE' AND OLD.lifecycle_state='FROZEN' THEN
    IF NEW.lifecycle_state='RETIRED'
       AND ROW(
         NEW.metric_key,NEW.channel,NEW.provider,NEW.window_seconds,NEW.maturity_seconds,
         NEW.comparison,NEW.threshold_value,NEW.minimum_sample_size,
         NEW.consecutive_breach_windows,NEW.consecutive_recovery_windows,
         NEW.breach_severity,NEW.effective_from,NEW.effective_until,NEW.definition_hash,
         NEW.frozen_at,NEW.frozen_by
       ) IS NOT DISTINCT FROM ROW(
         OLD.metric_key,OLD.channel,OLD.provider,OLD.window_seconds,OLD.maturity_seconds,
         OLD.comparison,OLD.threshold_value,OLD.minimum_sample_size,
         OLD.consecutive_breach_windows,OLD.consecutive_recovery_windows,
         OLD.breach_severity,OLD.effective_from,OLD.effective_until,OLD.definition_hash,
         OLD.frozen_at,OLD.frozen_by
       ) THEN RETURN NEW; END IF;
    RAISE EXCEPTION 'Frozen 10E assurance policy is immutable';
  END IF;
  IF TG_OP='UPDATE' AND OLD.lifecycle_state='RETIRED' THEN
    RAISE EXCEPTION 'Retired 10E assurance policy is immutable';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER trg_guard_assurance_policy_version_10e
BEFORE UPDATE OR DELETE ON operations.communication_assurance_policy_versions_10e
FOR EACH ROW EXECUTE FUNCTION operations.guard_assurance_policy_version_10e();

-- ---------------------------------------------------------------------------
-- Schedule/claim evaluation windows.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION operations.schedule_due_assurance_runs_10e(
  p_now timestamptz
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=operations,pg_temp
AS $$
DECLARE p record; v_end timestamptz; v_start timestamptz; v_count integer:=0;
BEGIN
  FOR p IN
    SELECT ap.policy_id,ap.policy_key,v.*
    FROM operations.communication_assurance_policies_10e ap
    JOIN operations.communication_assurance_policy_versions_10e v
      ON v.policy_id=ap.policy_id
    WHERE ap.enabled
      AND v.lifecycle_state='FROZEN'
      AND (v.effective_from IS NULL OR v.effective_from<=p_now)
      AND (v.effective_until IS NULL OR v.effective_until>p_now)
  LOOP
    v_end:=to_timestamp(
      floor(extract(epoch FROM p_now)/p.window_seconds)*p.window_seconds
    );
    v_start:=v_end-make_interval(secs=>p.window_seconds);

    INSERT INTO operations.communication_assurance_runs_10e(
      policy_id,policy_version,policy_key,metric_key,window_start,window_end,
      threshold_value,comparison
    )
    VALUES(
      p.policy_id,p.version,p.policy_key,p.metric_key,v_start,v_end,
      p.threshold_value,p.comparison
    )
    ON CONFLICT(policy_id,policy_version,window_start,window_end) DO NOTHING;

    IF FOUND THEN v_count:=v_count+1; END IF;
  END LOOP;
  RETURN v_count;
END
$$;

CREATE OR REPLACE FUNCTION operations.claim_assurance_runs_10e(
  p_worker_id text,p_batch_size integer DEFAULT 25,p_lease_seconds integer DEFAULT 180
)
RETURNS TABLE(
  run_id uuid,policy_id uuid,policy_version integer,policy_key text,
  metric_key text,window_start timestamptz,window_end timestamptz,attempt_count integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=operations,pg_temp
AS $$
BEGIN
  IF p_batch_size<1 OR p_batch_size>100 OR p_lease_seconds<30 OR p_lease_seconds>900 THEN
    RAISE EXCEPTION 'Invalid 10E assurance claim parameters';
  END IF;

  UPDATE operations.communication_assurance_runs_10e
  SET state='PENDING',lease_owner=NULL,lease_expires_at=NULL
  WHERE state='CLAIMED' AND lease_expires_at<clock_timestamp();

  RETURN QUERY
  WITH picked AS(
    SELECT r.run_id
    FROM operations.communication_assurance_runs_10e r
    WHERE r.state='PENDING'
      AND r.window_end<=clock_timestamp()
      AND (r.lease_expires_at IS NULL OR r.lease_expires_at<clock_timestamp())
    ORDER BY r.window_end,r.created_at
    FOR UPDATE OF r SKIP LOCKED
    LIMIT p_batch_size
  )
  UPDATE operations.communication_assurance_runs_10e r
  SET state='CLAIMED',
      attempt_count=r.attempt_count+1,
      lease_owner=p_worker_id,
      lease_expires_at=clock_timestamp()+make_interval(secs=>p_lease_seconds)
  FROM picked p
  WHERE r.run_id=p.run_id
  RETURNING r.run_id,r.policy_id,r.policy_version,r.policy_key,r.metric_key,
            r.window_start,r.window_end,r.attempt_count;
END
$$;

-- ---------------------------------------------------------------------------
-- Metric calculator. Source tables are read-only 10A-10D truth.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION operations.calculate_assurance_metric_10e(
  p_metric_key text,p_channel text,p_provider text,
  p_window_start timestamptz,p_window_end timestamptz,p_maturity_seconds integer
)
RETURNS TABLE(
  sample_size bigint,numerator numeric,denominator numeric,
  metric_value numeric,unit text
)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE cutoff timestamptz:=p_window_end-make_interval(secs=>p_maturity_seconds);
BEGIN
  IF p_metric_key='PROVIDER_ACCEPTANCE_RATE_PCT' THEN
    RETURN QUERY
    WITH cohort AS(
      SELECT d.*
      FROM operations.notification_deliveries d
      WHERE d.created_at>=p_window_start
        AND d.created_at<p_window_end
        AND d.created_at<=cutoff
        AND (p_channel IS NULL OR d.channel=p_channel)
        AND (p_provider IS NULL OR d.provider=p_provider)
        AND d.state NOT IN('SUPPRESSED','CANCELLED')
    )
    SELECT count(*)::bigint,
           count(*) FILTER(WHERE provider_accepted_at IS NOT NULL)::numeric,
           count(*)::numeric,
           CASE WHEN count(*)=0 THEN NULL
             ELSE 100.0*count(*) FILTER(WHERE provider_accepted_at IS NOT NULL)/count(*) END,
           'PERCENT'::text
    FROM cohort;

  ELSIF p_metric_key='PROVIDER_ACCEPTANCE_LATENCY_P95_MS' THEN
    RETURN QUERY
    SELECT count(*)::bigint,NULL::numeric,NULL::numeric,
           percentile_cont(0.95) WITHIN GROUP(
             ORDER BY extract(epoch FROM (provider_accepted_at-created_at))*1000.0
           )::numeric,
           'MILLISECONDS'::text
    FROM operations.notification_deliveries d
    WHERE d.created_at>=p_window_start
      AND d.created_at<p_window_end
      AND d.created_at<=cutoff
      AND d.provider_accepted_at IS NOT NULL
      AND (p_channel IS NULL OR d.channel=p_channel)
      AND (p_provider IS NULL OR d.provider=p_provider);

  ELSIF p_metric_key='UNKNOWN_ATTEMPT_RATE_PCT' THEN
    RETURN QUERY
    SELECT count(*)::bigint,
           count(*) FILTER(WHERE ambiguous_outcome OR outcome='UNKNOWN')::numeric,
           count(*)::numeric,
           CASE WHEN count(*)=0 THEN NULL
             ELSE 100.0*count(*) FILTER(WHERE ambiguous_outcome OR outcome='UNKNOWN')/count(*) END,
           'PERCENT'::text
    FROM operations.delivery_attempts a
    JOIN operations.notification_deliveries d ON d.delivery_id=a.delivery_id
    WHERE a.started_at>=p_window_start AND a.started_at<p_window_end
      AND (p_channel IS NULL OR d.channel=p_channel)
      AND (p_provider IS NULL OR d.provider=p_provider);

  ELSIF p_metric_key='DEAD_LETTER_RATE_PCT' THEN
    RETURN QUERY
    WITH cohort AS(
      SELECT d.delivery_id
      FROM operations.notification_deliveries d
      WHERE d.created_at>=p_window_start
        AND d.created_at<p_window_end
        AND d.created_at<=cutoff
        AND (p_channel IS NULL OR d.channel=p_channel)
        AND (p_provider IS NULL OR d.provider=p_provider)
        AND d.state NOT IN('SUPPRESSED','CANCELLED')
    )
    SELECT count(*)::bigint,
           count(*) FILTER(WHERE EXISTS(
             SELECT 1 FROM operations.dead_letters dl WHERE dl.delivery_id=cohort.delivery_id
           ))::numeric,
           count(*)::numeric,
           CASE WHEN count(*)=0 THEN NULL ELSE
             100.0*count(*) FILTER(WHERE EXISTS(
               SELECT 1 FROM operations.dead_letters dl WHERE dl.delivery_id=cohort.delivery_id
             ))/count(*) END,
           'PERCENT'::text
    FROM cohort;

  ELSIF p_metric_key='PROVIDER_HEALTH_AVAILABILITY_PCT' THEN
    RETURN QUERY
    SELECT count(*)::bigint,
           count(*) FILTER(WHERE healthy)::numeric,
           count(*)::numeric,
           CASE WHEN count(*)=0 THEN NULL
             ELSE 100.0*count(*) FILTER(WHERE healthy)/count(*) END,
           'PERCENT'::text
    FROM operations.provider_health h
    WHERE h.sampled_at>=p_window_start AND h.sampled_at<p_window_end
      AND (p_channel IS NULL OR h.channel=p_channel)
      AND (p_provider IS NULL OR h.provider=p_provider);

  ELSIF p_metric_key='INCIDENT_ACK_WITHIN_SLA_RATE_PCT' THEN
    RETURN QUERY
    WITH cohort AS(
      SELECT i.incident_id,n.acknowledgement_due_at,
             min(a.acknowledged_at) FILTER(WHERE a.acknowledgement_type IN('ACK','OWN')) AS first_ack
      FROM operations.incidents i
      JOIN operations.notification_requests n ON n.notification_id=i.notification_id
      LEFT JOIN operations.incident_acknowledgements a ON a.incident_id=i.incident_id
      WHERE i.opened_at>=p_window_start AND i.opened_at<p_window_end
        AND n.acknowledgement_required
        AND n.acknowledgement_due_at<=cutoff
      GROUP BY i.incident_id,n.acknowledgement_due_at
    )
    SELECT count(*)::bigint,
           count(*) FILTER(WHERE first_ack IS NOT NULL AND first_ack<=acknowledgement_due_at)::numeric,
           count(*)::numeric,
           CASE WHEN count(*)=0 THEN NULL ELSE
             100.0*count(*) FILTER(
               WHERE first_ack IS NOT NULL AND first_ack<=acknowledgement_due_at
             )/count(*) END,
           'PERCENT'::text
    FROM cohort;

  ELSIF p_metric_key='INCIDENT_ACK_LATENCY_P95_MS' THEN
    RETURN QUERY
    WITH cohort AS(
      SELECT i.opened_at,
             min(a.acknowledged_at) FILTER(WHERE a.acknowledgement_type IN('ACK','OWN')) AS first_ack
      FROM operations.incidents i
      JOIN operations.notification_requests n ON n.notification_id=i.notification_id
      LEFT JOIN operations.incident_acknowledgements a ON a.incident_id=i.incident_id
      WHERE i.opened_at>=p_window_start AND i.opened_at<p_window_end
        AND n.acknowledgement_required
      GROUP BY i.incident_id,i.opened_at
    )
    SELECT count(*) FILTER(WHERE first_ack IS NOT NULL)::bigint,
           NULL::numeric,NULL::numeric,
           percentile_cont(0.95) WITHIN GROUP(
             ORDER BY extract(epoch FROM (first_ack-opened_at))*1000.0
           ) FILTER(WHERE first_ack IS NOT NULL)::numeric,
           'MILLISECONDS'::text
    FROM cohort;

  ELSIF p_metric_key='ESCALATION_SEND_SUCCESS_RATE_PCT' THEN
    RETURN QUERY
    SELECT count(*)::bigint,
           count(*) FILTER(WHERE outcome='SENT')::numeric,
           count(*)::numeric,
           CASE WHEN count(*)=0 THEN NULL
             ELSE 100.0*count(*) FILTER(WHERE outcome='SENT')/count(*) END,
           'PERCENT'::text
    FROM operations.incident_escalation_emissions_10d e
    WHERE e.settled_at>=p_window_start AND e.settled_at<p_window_end
      AND e.state='SETTLED';

  ELSE
    RAISE EXCEPTION 'Unsupported 10E assurance metric %',p_metric_key;
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- Episode/event transition after each authoritative run.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION operations.update_assurance_episode_10e(
  p_run_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=operations,pg_temp
AS $$
DECLARE
  r operations.communication_assurance_runs_10e%ROWTYPE;
  v operations.communication_assurance_policy_versions_10e%ROWTYPE;
  ep operations.communication_assurance_episodes_10e%ROWTYPE;
  breach_count integer:=0; pass_count integer:=0;
  x record; payload jsonb; evt text; sev text;
BEGIN
  SELECT * INTO r FROM operations.communication_assurance_runs_10e WHERE run_id=p_run_id;
  IF NOT FOUND OR r.state<>'COMPLETE' THEN
    RAISE EXCEPTION 'Completed 10E assurance run required';
  END IF;

  SELECT * INTO v
  FROM operations.communication_assurance_policy_versions_10e
  WHERE policy_id=r.policy_id AND version=r.policy_version;

  SELECT * INTO ep
  FROM operations.communication_assurance_episodes_10e
  WHERE policy_id=r.policy_id AND policy_version=r.policy_version AND state='OPEN';

  FOR x IN
    SELECT outcome
    FROM operations.communication_assurance_runs_10e
    WHERE policy_id=r.policy_id AND policy_version=r.policy_version
      AND state='COMPLETE'
    ORDER BY window_end DESC
    LIMIT greatest(v.consecutive_breach_windows,v.consecutive_recovery_windows)
  LOOP
    IF x.outcome='BREACH' AND pass_count=0 THEN breach_count:=breach_count+1;
    ELSIF x.outcome='PASS' AND breach_count=0 THEN pass_count:=pass_count+1;
    ELSE EXIT;
    END IF;
  END LOOP;

  IF ep.episode_id IS NULL
     AND r.outcome='BREACH'
     AND breach_count>=v.consecutive_breach_windows THEN

    INSERT INTO operations.communication_assurance_episodes_10e(
      policy_id,policy_version,opened_run_id
    )
    VALUES(r.policy_id,r.policy_version,r.run_id)
    RETURNING * INTO ep;

    evt:='COMMUNICATION_ASSURANCE_BREACH';
    sev:=v.breach_severity;

  ELSIF ep.episode_id IS NOT NULL
        AND r.outcome='PASS'
        AND pass_count>=v.consecutive_recovery_windows THEN

    UPDATE operations.communication_assurance_episodes_10e
    SET state='RECOVERED',recovered_run_id=r.run_id,recovered_at=clock_timestamp()
    WHERE episode_id=ep.episode_id
    RETURNING * INTO ep;

    evt:='COMMUNICATION_ASSURANCE_RECOVERY';
    sev:='NOTICE';
  END IF;

  IF evt IS NOT NULL THEN
    payload:=jsonb_build_object(
      'assurance_event_id',gen_random_uuid()::text,
      'episode_id',ep.episode_id::text,
      'run_id',r.run_id::text,
      'policy_key',r.policy_key,
      'policy_version',r.policy_version,
      'metric_key',r.metric_key,
      'channel',v.channel,
      'provider',v.provider,
      'window_start',r.window_start,
      'window_end',r.window_end,
      'metric_value',r.metric_value,
      'threshold_value',r.threshold_value,
      'comparison',r.comparison,
      'sample_size',r.sample_size,
      'reason',CASE evt
        WHEN 'COMMUNICATION_ASSURANCE_BREACH' THEN 'CONSECUTIVE_SLO_BREACH'
        ELSE 'CONSECUTIVE_SLO_RECOVERY'
      END
    );

    INSERT INTO operations.communication_assurance_events_10e(
      assurance_event_id,episode_id,run_id,source_event_id,event_type,severity,
      subject_id,correlation_id,payload
    )
    VALUES(
      (payload->>'assurance_event_id')::uuid,
      ep.episode_id,r.run_id,
      'ASSURANCE:'||ep.episode_id::text||':'||evt,
      evt,sev,r.policy_key,ep.correlation_id,payload
    )
    ON CONFLICT(episode_id,event_type) DO NOTHING;
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- Authoritative evaluation: calculates metric, seals evidence, updates episode.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION operations.evaluate_assurance_run_10e(
  p_run_id uuid,p_worker_id text
)
RETURNS TABLE(
  run_id uuid,outcome text,metric_value numeric,threshold_value numeric,
  comparison text,sample_size bigint,unit text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=operations,pg_temp
AS $$
DECLARE
  r operations.communication_assurance_runs_10e%ROWTYPE;
  v operations.communication_assurance_policy_versions_10e%ROWTYPE;
  m record; v_outcome text; v_hash text;
BEGIN
  SELECT * INTO r
  FROM operations.communication_assurance_runs_10e
  WHERE communication_assurance_runs_10e.run_id=p_run_id
  FOR UPDATE;

  IF NOT FOUND OR r.state<>'CLAIMED'
     OR r.lease_owner IS DISTINCT FROM p_worker_id
     OR r.lease_expires_at<=clock_timestamp() THEN
    RAISE EXCEPTION '10E assurance run lease lost';
  END IF;

  SELECT * INTO v
  FROM operations.communication_assurance_policy_versions_10e
  WHERE policy_id=r.policy_id AND version=r.policy_version;

  SELECT * INTO m
  FROM operations.calculate_assurance_metric_10e(
    r.metric_key,v.channel,v.provider,r.window_start,r.window_end,v.maturity_seconds
  );

  IF coalesce(m.sample_size,0)<v.minimum_sample_size OR m.metric_value IS NULL THEN
    v_outcome:='INSUFFICIENT_DATA';
  ELSIF r.comparison='GTE' THEN
    v_outcome:=CASE WHEN m.metric_value>=r.threshold_value THEN 'PASS' ELSE 'BREACH' END;
  ELSE
    v_outcome:=CASE WHEN m.metric_value<=r.threshold_value THEN 'PASS' ELSE 'BREACH' END;
  END IF;

  v_hash:=encode(extensions.digest(
    r.run_id::text||'|'||r.policy_id::text||'|'||r.policy_version::text||'|'||
    r.window_start::text||'|'||r.window_end::text||'|'||
    coalesce(m.sample_size,0)::text||'|'||coalesce(m.numerator::text,'')||'|'||
    coalesce(m.denominator::text,'')||'|'||coalesce(m.metric_value::text,'')||'|'||
    m.unit||'|'||r.threshold_value::text||'|'||r.comparison||'|'||v_outcome,
    'sha256'
  ),'hex');

  UPDATE operations.communication_assurance_runs_10e
  SET state='COMPLETE',
      sample_size=m.sample_size,numerator=m.numerator,denominator=m.denominator,
      metric_value=m.metric_value,unit=m.unit,outcome=v_outcome,
      result_hash=v_hash,evaluated_at=clock_timestamp(),
      lease_owner=NULL,lease_expires_at=NULL,error_code=NULL,error_message=NULL
  WHERE communication_assurance_runs_10e.run_id=p_run_id;

  PERFORM operations.update_assurance_episode_10e(p_run_id);

  RETURN QUERY
  SELECT p_run_id,v_outcome,m.metric_value,r.threshold_value,r.comparison,
         coalesce(m.sample_size,0),m.unit;
END
$$;

CREATE OR REPLACE FUNCTION operations.fail_assurance_run_10e(
  p_run_id uuid,p_worker_id text,p_error_code text,p_error_message text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=operations,pg_temp
AS $$
BEGIN
  UPDATE operations.communication_assurance_runs_10e
  SET state='FAILED',outcome='ERROR',
      error_code=left(p_error_code,100),
      error_message=left(p_error_message,1000),
      evaluated_at=clock_timestamp(),
      lease_owner=NULL,lease_expires_at=NULL
  WHERE run_id=p_run_id
    AND state='CLAIMED'
    AND lease_owner=p_worker_id;

  IF NOT FOUND THEN RAISE EXCEPTION '10E assurance run lease lost'; END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- Breach/recovery event outbox. 10E emits only facts to 10B.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION operations.claim_assurance_events_10e(
  p_worker_id text,p_batch_size integer DEFAULT 25,p_lease_seconds integer DEFAULT 180
)
RETURNS TABLE(
  assurance_event_id uuid,source_event_id text,event_type text,occurred_at timestamptz,
  severity text,correlation_id uuid,subject_id text,payload jsonb,
  attempt_count integer,max_attempts integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=operations,pg_temp
AS $$
BEGIN
  IF p_batch_size<1 OR p_batch_size>100 OR p_lease_seconds<30 OR p_lease_seconds>900 THEN
    RAISE EXCEPTION 'Invalid 10E assurance event claim parameters';
  END IF;

  UPDATE operations.communication_assurance_events_10e
  SET state='PENDING',lease_owner=NULL,lease_expires_at=NULL
  WHERE state='CLAIMED' AND lease_expires_at<clock_timestamp();

  RETURN QUERY
  WITH picked AS(
    SELECT e.assurance_event_id
    FROM operations.communication_assurance_events_10e e
    WHERE e.state='PENDING'
      AND e.available_at<=clock_timestamp()
      AND e.attempt_count<e.max_attempts
    ORDER BY e.available_at,e.created_at
    FOR UPDATE OF e SKIP LOCKED
    LIMIT p_batch_size
  )
  UPDATE operations.communication_assurance_events_10e e
  SET state='CLAIMED',
      attempt_count=e.attempt_count+1,
      lease_owner=p_worker_id,
      lease_expires_at=clock_timestamp()+make_interval(secs=>p_lease_seconds)
  FROM picked p
  WHERE e.assurance_event_id=p.assurance_event_id
  RETURNING e.assurance_event_id,e.source_event_id,e.event_type,e.created_at,
            e.severity,e.correlation_id,e.subject_id,e.payload,
            e.attempt_count,e.max_attempts;
END
$$;

CREATE OR REPLACE FUNCTION operations.mark_assurance_event_emitted_10e(
  p_assurance_event_id uuid,p_worker_id text,p_operational_event_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=operations,pg_temp
AS $$
BEGIN
  UPDATE operations.communication_assurance_events_10e
  SET state='EMITTED',operational_event_id=p_operational_event_id,
      emitted_at=clock_timestamp(),lease_owner=NULL,lease_expires_at=NULL,
      last_error=NULL
  WHERE assurance_event_id=p_assurance_event_id
    AND state='CLAIMED'
    AND lease_owner=p_worker_id
    AND lease_expires_at>clock_timestamp();

  IF NOT FOUND THEN RAISE EXCEPTION '10E assurance event lease lost'; END IF;
END
$$;

CREATE OR REPLACE FUNCTION operations.fail_assurance_event_emission_10e(
  p_assurance_event_id uuid,p_worker_id text,p_error text,p_retry_ms integer
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=operations,pg_temp
AS $$
DECLARE e operations.communication_assurance_events_10e%ROWTYPE;
BEGIN
  IF p_retry_ms<1000 OR p_retry_ms>3600000 THEN
    RAISE EXCEPTION 'Invalid 10E assurance event retry interval';
  END IF;

  SELECT * INTO e
  FROM operations.communication_assurance_events_10e
  WHERE assurance_event_id=p_assurance_event_id
  FOR UPDATE;

  IF NOT FOUND OR e.state<>'CLAIMED'
     OR e.lease_owner IS DISTINCT FROM p_worker_id THEN
    RAISE EXCEPTION '10E assurance event lease lost';
  END IF;

  IF e.attempt_count>=e.max_attempts THEN
    UPDATE operations.communication_assurance_events_10e
    SET state='FAILED',last_error=left(p_error,1000),
        lease_owner=NULL,lease_expires_at=NULL
    WHERE assurance_event_id=p_assurance_event_id;
    RETURN 'FAILED';
  END IF;

  UPDATE operations.communication_assurance_events_10e
  SET state='PENDING',
      available_at=clock_timestamp()+make_interval(secs=>p_retry_ms::numeric/1000.0),
      last_error=left(p_error,1000),
      lease_owner=NULL,lease_expires_at=NULL
  WHERE assurance_event_id=p_assurance_event_id;
  RETURN 'RETRY';
END
$$;

-- Read-only views for EOC/Domain 11 consumption; 10E does not own monitoring transport.
CREATE VIEW operations.communication_assurance_current_10e AS
SELECT DISTINCT ON(r.policy_id,r.policy_version)
  r.policy_id,r.policy_version,r.policy_key,r.metric_key,r.window_start,r.window_end,
  r.metric_value,r.unit,r.threshold_value,r.comparison,r.sample_size,r.outcome,r.evaluated_at
FROM operations.communication_assurance_runs_10e r
WHERE r.state='COMPLETE'
ORDER BY r.policy_id,r.policy_version,r.window_end DESC;

CREATE VIEW operations.communication_assurance_active_breaches_10e AS
SELECT e.episode_id,p.policy_key,v.version,v.metric_key,v.channel,v.provider,
       e.opened_at,e.correlation_id,r.metric_value,r.threshold_value,r.comparison,
       r.sample_size,r.window_start,r.window_end
FROM operations.communication_assurance_episodes_10e e
JOIN operations.communication_assurance_policies_10e p ON p.policy_id=e.policy_id
JOIN operations.communication_assurance_policy_versions_10e v
  ON v.policy_id=e.policy_id AND v.version=e.policy_version
JOIN operations.communication_assurance_runs_10e r ON r.run_id=e.opened_run_id
WHERE e.state='OPEN';

COMMIT;
