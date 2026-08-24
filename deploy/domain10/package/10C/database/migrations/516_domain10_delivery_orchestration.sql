-- ============================================================================
-- TCDS DOMAIN 10 / SLICE 10C
-- Enterprise Delivery Orchestration
--
-- Prerequisites:
--   reviewed 10A: 510, 511, 512
--   reviewed 10B: 513, 514, 515
--
-- Ownership boundary:
--   10A owns authoritative notification/delivery/attempt/outbox/receipt/dead-letter
--       tables and delivery truth/state model.
--   10B owns event intake, planning, policy, recipient/channel decision and
--       creation of provider-ready notification_outbox entries.
--   10C owns only execution orchestration, provider submission coordination,
--       explicit retry scheduling, ambiguous-outcome quarantine workflow,
--       Telnyx outbound receipt application and reconciliation queueing.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Reconciliation tasks are 10C-specific execution-control records.
-- ---------------------------------------------------------------------------

CREATE TABLE operations.delivery_reconciliation_tasks_10c(
  task_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id uuid NOT NULL UNIQUE
    REFERENCES operations.notification_deliveries(delivery_id),
  provider text NOT NULL CHECK(provider IN('MICROSOFT_GRAPH','TELNYX')),
  reason text NOT NULL,
  state text NOT NULL DEFAULT 'PENDING'
    CHECK(state IN('PENDING','CLAIMED','MANUAL_REVIEW_REQUIRED','RESOLVED','CANCELLED')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK(attempt_count>=0),
  available_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  lease_owner text,
  lease_expires_at timestamptz,
  resolution jsonb,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK(resolved_at IS NULL OR resolved_at>=created_at)
);

CREATE INDEX idx_delivery_reconciliation_10c_claim
ON operations.delivery_reconciliation_tasks_10c(state,available_at,lease_expires_at,created_at);

CREATE TRIGGER trg_delivery_reconciliation_10c_updated
BEFORE UPDATE ON operations.delivery_reconciliation_tasks_10c
FOR EACH ROW EXECUTE FUNCTION operations.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. Channel/rate permit. 10A tables remain authoritative.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION operations.acquire_channel_rate_permit_10c(
  p_channel text,
  p_recipient_count integer DEFAULT 1
)
RETURNS boolean
LANGUAGE plpgsql
AS $$
DECLARE
  v_limit operations.channel_rate_limits%ROWTYPE;
  v_control operations.channel_controls%ROWTYPE;
  v_bucket timestamptz;
  v_updated integer;
BEGIN
  IF p_channel NOT IN('EMAIL','SMS') THEN
    RAISE EXCEPTION 'Invalid delivery channel';
  END IF;
  IF p_recipient_count<1 THEN
    RAISE EXCEPTION 'recipient_count must be positive';
  END IF;

  SELECT * INTO v_control
  FROM operations.channel_controls
  WHERE channel=p_channel;

  IF NOT FOUND OR NOT v_control.enabled OR v_control.emergency_stop THEN
    RETURN false;
  END IF;

  SELECT * INTO v_limit
  FROM operations.channel_rate_limits
  WHERE channel=p_channel AND enabled;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF p_recipient_count>v_limit.max_recipients_per_message THEN
    RETURN false;
  END IF;

  v_bucket:=date_trunc('minute',clock_timestamp());

  INSERT INTO operations.rate_limit_buckets(
    channel,bucket_minute,submission_count,recipient_count
  )
  VALUES(p_channel,v_bucket,1,p_recipient_count)
  ON CONFLICT(channel,bucket_minute) DO UPDATE
  SET submission_count=operations.rate_limit_buckets.submission_count+1,
      recipient_count=operations.rate_limit_buckets.recipient_count+EXCLUDED.recipient_count,
      updated_at=clock_timestamp()
  WHERE operations.rate_limit_buckets.submission_count < v_limit.max_submissions_per_minute
    AND operations.rate_limit_buckets.recipient_count+EXCLUDED.recipient_count
        <= v_limit.max_recipients_per_notification;

  GET DIAGNOSTICS v_updated=ROW_COUNT;
  RETURN v_updated=1;
END
$$;

-- ---------------------------------------------------------------------------
-- 3. Release a CLAIMED delivery before provider side effect.
--    Safe because SENDING has not begun.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION operations.release_delivery_claim_10c(
  p_delivery_id uuid,
  p_worker_id text,
  p_delay_ms integer,
  p_reason text
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_available timestamptz;
BEGIN
  IF p_delay_ms<0 OR p_delay_ms>3600000 THEN
    RAISE EXCEPTION 'Invalid claim-release delay';
  END IF;

  v_available:=clock_timestamp()+make_interval(secs=>p_delay_ms::numeric/1000.0);

  UPDATE operations.notification_deliveries
  SET state='PENDING',
      lease_owner=NULL,
      lease_expires_at=NULL,
      next_attempt_at=v_available,
      last_error_class='EXECUTOR_NOT_READY',
      last_error_message=left(p_reason,1000)
  WHERE delivery_id=p_delivery_id
    AND state='CLAIMED'
    AND lease_owner=p_worker_id
    AND lease_expires_at>clock_timestamp();

  IF NOT FOUND THEN
    RAISE EXCEPTION '10C cannot release delivery claim: lease lost or state changed';
  END IF;

  UPDATE operations.notification_outbox
  SET available_at=v_available,
      locked_at=NULL,
      lock_owner=NULL,
      lock_expires_at=NULL
  WHERE delivery_id=p_delivery_id
    AND completed_at IS NULL;
END
$$;

-- ---------------------------------------------------------------------------
-- 4. Begin one provider attempt.
--    SMS consent is checked AGAIN at send time.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION operations.begin_delivery_execution_10c(
  p_delivery_id uuid,
  p_worker_id text
)
RETURNS TABLE(
  attempt_id uuid,
  attempt_number integer,
  execution_status text,
  reason text
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_delivery operations.notification_deliveries%ROWTYPE;
  v_attempt_id uuid;
  v_attempt_number integer;
  v_channel_enabled boolean;
BEGIN
  SELECT * INTO v_delivery
  FROM operations.notification_deliveries
  WHERE delivery_id=p_delivery_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'Delivery not found'; END IF;

  IF v_delivery.state<>'CLAIMED'
     OR v_delivery.lease_owner IS DISTINCT FROM p_worker_id
     OR v_delivery.lease_expires_at IS NULL
     OR v_delivery.lease_expires_at<=clock_timestamp() THEN
    RAISE EXCEPTION '10C delivery lease lost';
  END IF;

  SELECT (enabled AND NOT emergency_stop) INTO v_channel_enabled
  FROM operations.channel_controls
  WHERE channel=v_delivery.channel;

  IF NOT coalesce(v_channel_enabled,false) THEN
    PERFORM operations.release_delivery_claim_10c(
      p_delivery_id,p_worker_id,5000,'CHANNEL_DISABLED_OR_EMERGENCY_STOP'
    );
    RETURN QUERY SELECT NULL::uuid,NULL::integer,'RELEASED'::text,'CHANNEL_DISABLED_OR_EMERGENCY_STOP'::text;
    RETURN;
  END IF;

  IF v_delivery.channel='SMS'
     AND NOT operations.sms_delivery_currently_eligible(p_delivery_id) THEN
    -- Exact-row suppression only. Do not invoke the 10A global sweep from an
    -- individual delivery execution path.
    UPDATE operations.notification_deliveries
    SET state='PENDING',
        lease_owner=NULL,
        lease_expires_at=NULL
    WHERE delivery_id=p_delivery_id
      AND state='CLAIMED'
      AND lease_owner=p_worker_id;

    UPDATE operations.notification_deliveries
    SET state='SUPPRESSED',
        suppressed_at=clock_timestamp(),
        suppression_reason='SMS_NOT_CURRENTLY_SUBSCRIBED'
    WHERE delivery_id=p_delivery_id
      AND state='PENDING';

    UPDATE operations.notification_outbox
    SET completed_at=clock_timestamp(),
        locked_at=NULL,
        lock_owner=NULL,
        lock_expires_at=NULL
    WHERE delivery_id=p_delivery_id
      AND completed_at IS NULL;

    RETURN QUERY SELECT NULL::uuid,NULL::integer,'SUPPRESSED'::text,'SMS_NOT_CURRENTLY_SUBSCRIBED'::text;
    RETURN;
  END IF;

  v_attempt_number:=v_delivery.attempt_count+1;
  IF v_attempt_number>v_delivery.max_attempts THEN
    RAISE EXCEPTION 'Delivery attempt ceiling exceeded';
  END IF;

  UPDATE operations.notification_deliveries
  SET state='SENDING',
      attempt_count=v_attempt_number
  WHERE delivery_id=p_delivery_id
    AND state='CLAIMED'
    AND lease_owner=p_worker_id;

  IF NOT FOUND THEN RAISE EXCEPTION 'Unable to transition delivery to SENDING'; END IF;

  INSERT INTO operations.delivery_attempts(
    delivery_id,attempt_number,worker_id,outcome
  )
  VALUES(p_delivery_id,v_attempt_number,p_worker_id,'STARTED')
  RETURNING delivery_attempts.attempt_id INTO v_attempt_id;

  RETURN QUERY SELECT v_attempt_id,v_attempt_number,'STARTED'::text,NULL::text;
END
$$;

-- 4A. Harden the handoff into the reviewed 10A acceptance function by
-- verifying the worker/attempt identity before 10A records authoritative truth.
CREATE OR REPLACE FUNCTION operations.record_provider_acceptance_10c(
  p_delivery_id uuid,
  p_attempt_id uuid,
  p_worker_id text,
  p_provider_request_id text,
  p_provider_message_id text,
  p_http_status integer,
  p_receipt_payload jsonb
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_delivery operations.notification_deliveries%ROWTYPE;
BEGIN
  SELECT * INTO v_delivery
  FROM operations.notification_deliveries
  WHERE delivery_id=p_delivery_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'Delivery not found'; END IF;
  IF v_delivery.state<>'SENDING' THEN RAISE EXCEPTION 'Delivery is not SENDING'; END IF;
  IF v_delivery.lease_owner IS DISTINCT FROM p_worker_id THEN RAISE EXCEPTION 'Delivery worker mismatch'; END IF;
  IF v_delivery.lease_expires_at IS NULL OR v_delivery.lease_expires_at<=clock_timestamp() THEN
    RAISE EXCEPTION 'Delivery lease expired before provider acceptance commit';
  END IF;

  IF NOT EXISTS(
    SELECT 1 FROM operations.delivery_attempts
    WHERE attempt_id=p_attempt_id
      AND delivery_id=p_delivery_id
      AND worker_id=p_worker_id
      AND outcome='STARTED'
  ) THEN
    RAISE EXCEPTION 'Active provider attempt does not belong to delivery worker';
  END IF;

  PERFORM operations.record_provider_acceptance(
    p_delivery_id,p_attempt_id,p_provider_request_id,p_provider_message_id,
    p_http_status,p_receipt_payload
  );
END
$$;

-- ---------------------------------------------------------------------------
-- 5. Explicit provider failure state transition.
--
-- Timeout/network ambiguity is never auto-retried.
-- Retry is allowed only for explicit retryable failures and while the
-- 10A max_attempts ceiling has not been reached.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION operations.fail_delivery_execution_10c(
  p_delivery_id uuid,
  p_attempt_id uuid,
  p_worker_id text,
  p_error_class text,
  p_error_message text,
  p_http_status integer,
  p_provider_code text,
  p_retryable boolean,
  p_ambiguous boolean,
  p_next_attempt_at timestamptz
)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  v_delivery operations.notification_deliveries%ROWTYPE;
  v_disposition text;
BEGIN
  SELECT * INTO v_delivery
  FROM operations.notification_deliveries
  WHERE delivery_id=p_delivery_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'Delivery not found'; END IF;
  IF v_delivery.state<>'SENDING' THEN RAISE EXCEPTION 'Delivery is not SENDING'; END IF;
  IF v_delivery.lease_owner IS DISTINCT FROM p_worker_id THEN RAISE EXCEPTION 'Delivery worker mismatch'; END IF;

  UPDATE operations.delivery_attempts
  SET outcome=CASE
        WHEN p_ambiguous THEN 'UNKNOWN'
        WHEN p_retryable AND v_delivery.attempt_count<v_delivery.max_attempts THEN 'RETRYABLE_FAILURE'
        ELSE 'FINAL_FAILURE'
      END,
      completed_at=clock_timestamp(),
      http_status=p_http_status,
      provider_code=p_provider_code,
      error_class=p_error_class,
      error_message=left(p_error_message,1000),
      ambiguous_outcome=p_ambiguous
  WHERE attempt_id=p_attempt_id
    AND delivery_id=p_delivery_id
    AND worker_id=p_worker_id
    AND outcome='STARTED';

  IF NOT FOUND THEN RAISE EXCEPTION 'Active delivery attempt not found'; END IF;

  IF p_ambiguous THEN
    UPDATE operations.notification_deliveries
    SET state='UNKNOWN_PROVIDER_OUTCOME',
        lease_owner=NULL,
        lease_expires_at=NULL,
        last_error_class=p_error_class,
        last_error_code=p_provider_code,
        last_error_message=left(p_error_message,1000)
    WHERE delivery_id=p_delivery_id;

    UPDATE operations.notification_outbox
    SET completed_at=clock_timestamp(),lock_owner=NULL,lock_expires_at=NULL
    WHERE delivery_id=p_delivery_id AND completed_at IS NULL;

    INSERT INTO operations.delivery_reconciliation_tasks_10c(
      delivery_id,provider,reason
    )
    VALUES(p_delivery_id,v_delivery.provider,'UNKNOWN_PROVIDER_OUTCOME')
    ON CONFLICT(delivery_id) DO NOTHING;

    v_disposition:='UNKNOWN';

  ELSIF p_retryable AND v_delivery.attempt_count<v_delivery.max_attempts THEN
    IF p_next_attempt_at<=clock_timestamp() THEN
      RAISE EXCEPTION 'Retry timestamp must be in the future';
    END IF;

    UPDATE operations.notification_deliveries
    SET state='FAILED_RETRYABLE',
        next_attempt_at=p_next_attempt_at,
        lease_owner=NULL,
        lease_expires_at=NULL,
        last_error_class=p_error_class,
        last_error_code=p_provider_code,
        last_error_message=left(p_error_message,1000)
    WHERE delivery_id=p_delivery_id;

    UPDATE operations.notification_outbox
    SET available_at=p_next_attempt_at,
        locked_at=NULL,
        lock_owner=NULL,
        lock_expires_at=NULL
    WHERE delivery_id=p_delivery_id AND completed_at IS NULL;

    v_disposition:='RETRY';

  ELSE
    UPDATE operations.notification_deliveries
    SET state='FAILED_FINAL',
        lease_owner=NULL,
        lease_expires_at=NULL,
        last_error_class=p_error_class,
        last_error_code=p_provider_code,
        last_error_message=left(p_error_message,1000)
    WHERE delivery_id=p_delivery_id;

    UPDATE operations.notification_deliveries
    SET state='DEAD_LETTERED'
    WHERE delivery_id=p_delivery_id AND state='FAILED_FINAL';

    UPDATE operations.notification_outbox
    SET completed_at=clock_timestamp(),lock_owner=NULL,lock_expires_at=NULL
    WHERE delivery_id=p_delivery_id AND completed_at IS NULL;

    INSERT INTO operations.dead_letters(
      delivery_id,reason_code,last_error
    )
    VALUES(p_delivery_id,p_error_class,left(p_error_message,1000))
    ON CONFLICT(delivery_id) DO UPDATE
    SET reason_code=EXCLUDED.reason_code,
        last_error=EXCLUDED.last_error,
        updated_at=clock_timestamp();

    v_disposition:='DEAD';
  END IF;

  RETURN v_disposition;
END
$$;

-- ---------------------------------------------------------------------------
-- 6. Telnyx delivery receipt application.
--
-- The HTTP/webhook layer MUST verify Ed25519 against the raw body before it
-- calls this function. This function deals only with normalized, verified
-- outbound status evidence.
-- ---------------------------------------------------------------------------

ALTER TABLE operations.provider_receipts
  ADD COLUMN IF NOT EXISTS provider_occurred_at timestamptz,
  ADD COLUMN IF NOT EXISTS provider_status text;

CREATE INDEX IF NOT EXISTS idx_provider_receipts_telnyx_message_time
ON operations.provider_receipts(provider,provider_message_id,provider_occurred_at DESC)
WHERE provider='TELNYX' AND provider_message_id IS NOT NULL;

CREATE OR REPLACE FUNCTION operations.apply_telnyx_delivery_event_10c(
  p_provider_event_id text,
  p_provider_message_id text,
  p_event_type text,
  p_occurred_at timestamptz,
  p_status text,
  p_errors jsonb,
  p_evidence jsonb,
  p_correlation_id uuid DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=operations,pg_temp
AS $$
DECLARE
  v_delivery_id uuid;
  v_state text;
  v_latest_at timestamptz;
  v_latest_status text;
BEGIN
  IF p_event_type NOT IN('message.sent','message.finalized') THEN
    RAISE EXCEPTION '10C accepts only Telnyx outbound delivery status events';
  END IF;
  IF p_status NOT IN(
    'queued','sending','sent','delivered',
    'sending_failed','delivery_failed','delivery_unconfirmed'
  ) THEN
    RAISE EXCEPTION 'Unsupported Telnyx delivery status';
  END IF;
  IF btrim(coalesce(p_provider_event_id,''))='' OR btrim(coalesce(p_provider_message_id,''))='' THEN
    RAISE EXCEPTION 'Telnyx provider event/message IDs are required';
  END IF;
  IF jsonb_typeof(p_errors)<>'array' OR jsonb_typeof(p_evidence)<>'object' THEN
    RAISE EXCEPTION 'Invalid Telnyx evidence payload';
  END IF;

  IF EXISTS(
    SELECT 1 FROM operations.provider_receipts
    WHERE provider='TELNYX' AND provider_event_id=p_provider_event_id
  ) THEN
    RETURN 'DUPLICATE';
  END IF;

  SELECT d.delivery_id,d.state INTO v_delivery_id,v_state
  FROM operations.notification_deliveries d
  JOIN operations.delivery_attempts a ON a.delivery_id=d.delivery_id
  WHERE d.provider='TELNYX'
    AND a.provider_message_id=p_provider_message_id
  ORDER BY a.attempt_number DESC
  LIMIT 1
  FOR UPDATE OF d;

  IF v_delivery_id IS NULL THEN
    INSERT INTO operations.provider_receipts(
      provider,provider_event_id,provider_message_id,receipt_type,payload,
      payload_redacted,correlation_id,evidence_source,evidence_verified,
      provider_occurred_at,provider_status
    )
    VALUES(
      'TELNYX',p_provider_event_id,p_provider_message_id,'UNMATCHED_DELIVERY_EVENT',
      p_evidence,true,p_correlation_id,'TELNYX_DELIVERY_WEBHOOK',true,
      p_occurred_at,p_status
    );
    RETURN 'UNMATCHED';
  END IF;

  SELECT provider_occurred_at,provider_status
  INTO v_latest_at,v_latest_status
  FROM operations.provider_receipts
  WHERE provider='TELNYX'
    AND provider_message_id=p_provider_message_id
    AND evidence_source='TELNYX_DELIVERY_WEBHOOK'
  ORDER BY provider_occurred_at DESC,receipt_id DESC
  LIMIT 1;

  IF v_latest_at IS NOT NULL AND p_occurred_at<v_latest_at THEN
    INSERT INTO operations.provider_receipts(
      provider,provider_event_id,provider_message_id,delivery_id,receipt_type,payload,
      payload_redacted,correlation_id,evidence_source,evidence_verified,
      provider_occurred_at,provider_status
    )
    VALUES(
      'TELNYX',p_provider_event_id,p_provider_message_id,v_delivery_id,'STALE_DELIVERY_EVENT',
      p_evidence,true,p_correlation_id,'TELNYX_DELIVERY_WEBHOOK',true,
      p_occurred_at,p_status
    );
    RETURN 'IGNORED_STALE';
  END IF;

  INSERT INTO operations.provider_receipts(
    provider,provider_event_id,provider_message_id,delivery_id,receipt_type,payload,
    payload_redacted,correlation_id,evidence_source,evidence_verified,
    provider_occurred_at,provider_status
  )
  VALUES(
    'TELNYX',p_provider_event_id,p_provider_message_id,v_delivery_id,
    CASE WHEN p_event_type='message.finalized' THEN 'TELNYX_FINALIZED' ELSE 'TELNYX_SENT' END,
    p_evidence,true,p_correlation_id,'TELNYX_DELIVERY_WEBHOOK',true,
    p_occurred_at,p_status
  );

  -- Contradictory equal/newer terminal evidence is not allowed to silently
  -- rewrite prior truth. Route it to reconciliation.
  IF p_event_type='message.finalized'
     AND v_latest_status IS NOT NULL
     AND v_latest_status IN('delivered','sending_failed','delivery_failed')
     AND p_status IN('delivered','sending_failed','delivery_failed')
     AND p_status<>v_latest_status THEN
    INSERT INTO operations.delivery_reconciliation_tasks_10c(delivery_id,provider,reason)
    VALUES(v_delivery_id,'TELNYX','CONFLICTING_TERMINAL_EVIDENCE')
    ON CONFLICT(delivery_id) DO UPDATE
    SET reason='CONFLICTING_TERMINAL_EVIDENCE',
        state=CASE
          WHEN operations.delivery_reconciliation_tasks_10c.state IN('RESOLVED','CANCELLED')
          THEN operations.delivery_reconciliation_tasks_10c.state
          ELSE 'PENDING'
        END,
        available_at=clock_timestamp();
    RETURN 'APPLIED';
  END IF;

  IF p_event_type='message.finalized' THEN
    IF p_status='delivered' THEN
      IF v_state='ACCEPTED_BY_PROVIDER' THEN
        PERFORM operations.record_final_delivery(
          v_delivery_id,p_provider_event_id,p_provider_message_id,p_evidence,
          'TELNYX_DELIVERY_WEBHOOK',p_correlation_id
        );
      ELSIF v_state<>'DELIVERED' THEN
        INSERT INTO operations.delivery_reconciliation_tasks_10c(delivery_id,provider,reason)
        VALUES(v_delivery_id,'TELNYX','DELIVERED_EVIDENCE_STATE_CONFLICT')
        ON CONFLICT(delivery_id) DO NOTHING;
      END IF;

    ELSIF p_status IN('sending_failed','delivery_failed') THEN
      IF v_state='ACCEPTED_BY_PROVIDER' THEN
        UPDATE operations.notification_deliveries
        SET state='FAILED_FINAL',
            last_error_class='TELNYX_FINAL_DELIVERY_FAILURE',
            last_error_code=coalesce(p_errors->0->>'code',p_status),
            last_error_message=left(coalesce(p_errors->0->>'detail',p_status),1000)
        WHERE delivery_id=v_delivery_id;

        UPDATE operations.notification_deliveries
        SET state='DEAD_LETTERED'
        WHERE delivery_id=v_delivery_id AND state='FAILED_FINAL';

        INSERT INTO operations.dead_letters(delivery_id,reason_code,last_error)
        VALUES(
          v_delivery_id,
          coalesce(p_errors->0->>'code',p_status),
          left(coalesce(p_errors->0->>'detail',p_status),1000)
        )
        ON CONFLICT(delivery_id) DO UPDATE
        SET reason_code=EXCLUDED.reason_code,
            last_error=EXCLUDED.last_error,
            updated_at=clock_timestamp();

      ELSIF v_state NOT IN('FAILED_FINAL','DEAD_LETTERED') THEN
        INSERT INTO operations.delivery_reconciliation_tasks_10c(delivery_id,provider,reason)
        VALUES(v_delivery_id,'TELNYX','FAILURE_EVIDENCE_STATE_CONFLICT')
        ON CONFLICT(delivery_id) DO NOTHING;
      END IF;

    ELSIF p_status='delivery_unconfirmed' THEN
      INSERT INTO operations.delivery_reconciliation_tasks_10c(delivery_id,provider,reason)
      VALUES(v_delivery_id,'TELNYX','DELIVERY_UNCONFIRMED')
      ON CONFLICT(delivery_id) DO NOTHING;
    END IF;
  END IF;

  RETURN 'APPLIED';
END
$$;

-- ---------------------------------------------------------------------------
-- 7. Reconciliation claim/complete.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION operations.claim_delivery_reconciliation_10c(
  p_worker_id text,
  p_batch_size integer DEFAULT 25,
  p_lease_seconds integer DEFAULT 180
)
RETURNS TABLE(
  task_id uuid,
  delivery_id uuid,
  provider text,
  reason text,
  state text,
  attempt_count integer
)
LANGUAGE plpgsql
AS $$
#variable_conflict use_column
BEGIN
  IF p_batch_size<1 OR p_batch_size>100 THEN RAISE EXCEPTION 'Invalid reconciliation batch size'; END IF;
  IF p_lease_seconds<30 OR p_lease_seconds>900 THEN RAISE EXCEPTION 'Invalid reconciliation lease'; END IF;

  UPDATE operations.delivery_reconciliation_tasks_10c
  SET state='PENDING',lease_owner=NULL,lease_expires_at=NULL
  WHERE state='CLAIMED'
    AND lease_expires_at IS NOT NULL
    AND lease_expires_at<clock_timestamp();

  RETURN QUERY
  WITH picked AS(
    SELECT t.task_id
    FROM operations.delivery_reconciliation_tasks_10c t
    WHERE t.state='PENDING'
      AND t.available_at<=clock_timestamp()
      AND (t.lease_expires_at IS NULL OR t.lease_expires_at<clock_timestamp())
    ORDER BY t.available_at,t.created_at
    FOR UPDATE OF t SKIP LOCKED
    LIMIT p_batch_size
  )
  UPDATE operations.delivery_reconciliation_tasks_10c t
  SET state='CLAIMED',
      attempt_count=t.attempt_count+1,
      lease_owner=p_worker_id,
      lease_expires_at=clock_timestamp()+make_interval(secs=>p_lease_seconds)
  FROM picked p
  WHERE t.task_id=p.task_id
  RETURNING t.task_id,t.delivery_id,t.provider,t.reason,t.state,t.attempt_count;
END
$$;

CREATE OR REPLACE FUNCTION operations.mark_delivery_reconciliation_manual_review_10c(
  p_task_id uuid,
  p_worker_id text,
  p_evidence jsonb
)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF jsonb_typeof(p_evidence)<>'object' THEN
    RAISE EXCEPTION 'Reconciliation evidence must be an object';
  END IF;

  UPDATE operations.delivery_reconciliation_tasks_10c
  SET state='MANUAL_REVIEW_REQUIRED',
      resolution=p_evidence,
      lease_owner=NULL,
      lease_expires_at=NULL
  WHERE task_id=p_task_id
    AND state='CLAIMED'
    AND lease_owner=p_worker_id
    AND lease_expires_at>clock_timestamp();

  IF NOT FOUND THEN RAISE EXCEPTION 'Reconciliation task lease lost'; END IF;
END
$$;

CREATE OR REPLACE FUNCTION operations.resolve_delivery_reconciliation_10c(
  p_task_id uuid,
  p_actor text,
  p_state text,
  p_resolution jsonb
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_delivery_id uuid;
BEGIN
  IF p_state NOT IN('RESOLVED','CANCELLED') THEN
    RAISE EXCEPTION 'Invalid reconciliation resolution state';
  END IF;
  IF btrim(coalesce(p_actor,''))='' THEN
    RAISE EXCEPTION 'Reconciliation actor is required';
  END IF;
  IF jsonb_typeof(p_resolution)<>'object' THEN
    RAISE EXCEPTION 'Reconciliation resolution must be an object';
  END IF;

  UPDATE operations.delivery_reconciliation_tasks_10c
  SET state=p_state,
      resolution=p_resolution,
      resolved_at=clock_timestamp(),
      lease_owner=NULL,
      lease_expires_at=NULL
  WHERE task_id=p_task_id
    AND state IN('MANUAL_REVIEW_REQUIRED','CLAIMED')
  RETURNING delivery_id INTO v_delivery_id;

  IF v_delivery_id IS NULL THEN
    RAISE EXCEPTION 'Reconciliation task is not resolvable';
  END IF;

  INSERT INTO operations.audit_ledger(
    entity_type,entity_id,action,actor_type,actor_id,details,record_hash
  )
  VALUES(
    'DELIVERY_RECONCILIATION',
    p_task_id::text,
    'RECONCILIATION_'||p_state,
    'OPERATOR',
    p_actor,
    jsonb_build_object('delivery_id',v_delivery_id,'resolution',p_resolution),
    'DB_TRIGGER_REPLACES'
  );
END
$$;

COMMENT ON TABLE operations.delivery_reconciliation_tasks_10c IS
'10C execution-control queue for ambiguous or unconfirmed provider outcomes. It never authorizes blind resend.';

COMMIT;
