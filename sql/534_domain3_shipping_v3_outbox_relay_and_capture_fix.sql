BEGIN;

CREATE SCHEMA IF NOT EXISTS arb;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Ensure Domain 1 process registry has the process name used by the relay/capture worker.
INSERT INTO arb.process_registry (
  process_name,
  phase_no,
  process_group,
  description,
  owner_team,
  active_flag
)
VALUES (
  'forensic.capture_shipping',
  3,
  'domain3_shipping',
  'Capture shipping intelligence/rate/label evidence through Domain 1 forensic chain.',
  'TCDS',
  true
)
ON CONFLICT (process_name) DO UPDATE SET
  active_flag = true,
  description = EXCLUDED.description,
  updated_at = now();

-- Domain 3 outbox. Domain 3 owns this. Domain 1 owns shipping_evidence.
CREATE TABLE IF NOT EXISTS arb.shipping_capture_signal_outbox (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  signal_hash text NOT NULL,
  status text NOT NULL DEFAULT 'PENDING',
  priority integer NOT NULL DEFAULT 50,
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 5,
  process_run_id uuid,
  process_step_id bigint,
  candidate_id bigint,
  listing_id uuid,
  source_listing_normalized_id bigint,
  entity_type text NOT NULL DEFAULT 'listing',
  entity_pk text NOT NULL,
  selected_carrier_code text,
  selected_service_code text,
  selected_service_name text,
  quoted_label_cost_usd numeric,
  estimated_delivery_days integer,
  on_time_probability numeric,
  tracking_quality_score numeric,
  claim_risk_score numeric,
  payload_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_error text,
  locked_by text,
  locked_at timestamptz,
  available_at timestamptz NOT NULL DEFAULT now(),
  captured_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE arb.shipping_capture_signal_outbox ADD COLUMN IF NOT EXISTS signal_hash text;
ALTER TABLE arb.shipping_capture_signal_outbox ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'PENDING';
ALTER TABLE arb.shipping_capture_signal_outbox ADD COLUMN IF NOT EXISTS priority integer NOT NULL DEFAULT 50;
ALTER TABLE arb.shipping_capture_signal_outbox ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0;
ALTER TABLE arb.shipping_capture_signal_outbox ADD COLUMN IF NOT EXISTS max_attempts integer NOT NULL DEFAULT 5;
ALTER TABLE arb.shipping_capture_signal_outbox ADD COLUMN IF NOT EXISTS process_run_id uuid;
ALTER TABLE arb.shipping_capture_signal_outbox ADD COLUMN IF NOT EXISTS process_step_id bigint;
ALTER TABLE arb.shipping_capture_signal_outbox ADD COLUMN IF NOT EXISTS candidate_id bigint;
ALTER TABLE arb.shipping_capture_signal_outbox ADD COLUMN IF NOT EXISTS listing_id uuid;
ALTER TABLE arb.shipping_capture_signal_outbox ADD COLUMN IF NOT EXISTS source_listing_normalized_id bigint;
ALTER TABLE arb.shipping_capture_signal_outbox ADD COLUMN IF NOT EXISTS entity_type text NOT NULL DEFAULT 'listing';
ALTER TABLE arb.shipping_capture_signal_outbox ADD COLUMN IF NOT EXISTS entity_pk text;
ALTER TABLE arb.shipping_capture_signal_outbox ADD COLUMN IF NOT EXISTS selected_carrier_code text;
ALTER TABLE arb.shipping_capture_signal_outbox ADD COLUMN IF NOT EXISTS selected_service_code text;
ALTER TABLE arb.shipping_capture_signal_outbox ADD COLUMN IF NOT EXISTS selected_service_name text;
ALTER TABLE arb.shipping_capture_signal_outbox ADD COLUMN IF NOT EXISTS quoted_label_cost_usd numeric;
ALTER TABLE arb.shipping_capture_signal_outbox ADD COLUMN IF NOT EXISTS estimated_delivery_days integer;
ALTER TABLE arb.shipping_capture_signal_outbox ADD COLUMN IF NOT EXISTS on_time_probability numeric;
ALTER TABLE arb.shipping_capture_signal_outbox ADD COLUMN IF NOT EXISTS tracking_quality_score numeric;
ALTER TABLE arb.shipping_capture_signal_outbox ADD COLUMN IF NOT EXISTS claim_risk_score numeric;
ALTER TABLE arb.shipping_capture_signal_outbox ADD COLUMN IF NOT EXISTS payload_json jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE arb.shipping_capture_signal_outbox ADD COLUMN IF NOT EXISTS last_error text;
ALTER TABLE arb.shipping_capture_signal_outbox ADD COLUMN IF NOT EXISTS locked_by text;
ALTER TABLE arb.shipping_capture_signal_outbox ADD COLUMN IF NOT EXISTS locked_at timestamptz;
ALTER TABLE arb.shipping_capture_signal_outbox ADD COLUMN IF NOT EXISTS available_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE arb.shipping_capture_signal_outbox ADD COLUMN IF NOT EXISTS captured_at timestamptz;
ALTER TABLE arb.shipping_capture_signal_outbox ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- Normalize any bad status values from earlier patches before installing the hardened check.
UPDATE arb.shipping_capture_signal_outbox
SET status = 'PENDING'
WHERE status NOT IN ('PENDING','CLAIMED','CAPTURED','FAILED','DEAD_LETTER','CANCELLED');

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'arb.shipping_capture_signal_outbox'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%status%'
  LOOP
    EXECUTE format('ALTER TABLE arb.shipping_capture_signal_outbox DROP CONSTRAINT IF EXISTS %I', r.conname);
  END LOOP;
END $$;

ALTER TABLE arb.shipping_capture_signal_outbox
  ADD CONSTRAINT shipping_capture_signal_outbox_status_check
  CHECK (status IN ('PENDING','CLAIMED','CAPTURED','FAILED','DEAD_LETTER','CANCELLED'));

ALTER TABLE arb.shipping_capture_signal_outbox
  ALTER COLUMN entity_type SET DEFAULT 'listing',
  ALTER COLUMN payload_json SET DEFAULT '{}'::jsonb,
  ALTER COLUMN status SET DEFAULT 'PENDING';

-- De-dupe before unique index.
DELETE FROM arb.shipping_capture_signal_outbox a
USING arb.shipping_capture_signal_outbox b
WHERE a.signal_hash = b.signal_hash
  AND a.id > b.id;

CREATE UNIQUE INDEX IF NOT EXISTS ux_shipping_capture_signal_outbox_hash
  ON arb.shipping_capture_signal_outbox(signal_hash);

CREATE INDEX IF NOT EXISTS idx_shipping_capture_signal_outbox_work
  ON arb.shipping_capture_signal_outbox(status, priority, available_at, created_at);

CREATE INDEX IF NOT EXISTS idx_shipping_capture_signal_outbox_entity
  ON arb.shipping_capture_signal_outbox(entity_type, entity_pk, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_shipping_capture_signal_outbox_candidate
  ON arb.shipping_capture_signal_outbox(candidate_id, created_at DESC);

CREATE OR REPLACE FUNCTION arb.fn_enqueue_shipping_capture_signal(p_payload jsonb)
RETURNS bigint
LANGUAGE plpgsql
AS $$
DECLARE
  v_entity_type text := coalesce(nullif(p_payload->>'entity_type',''), 'listing');
  v_entity_pk text := coalesce(
    nullif(p_payload->>'entity_pk',''),
    nullif(p_payload->>'sourceListingId',''),
    nullif(p_payload->>'source_listing_normalized_id',''),
    nullif(p_payload->>'listing_id',''),
    nullif(p_payload->>'candidate_id','')
  );
  v_signal_hash text;
  v_id bigint;
  v_job_payload jsonb;
  v_process_run_id uuid;
  v_process_step_id bigint;
  v_candidate_id bigint;
  v_listing_id uuid;
  v_source_listing_normalized_id bigint;
  v_quoted_label_cost_usd numeric;
  v_estimated_delivery_days integer;
  v_on_time_probability numeric;
  v_tracking_quality_score numeric;
  v_claim_risk_score numeric;
BEGIN
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'shipping capture signal payload must be a json object';
  END IF;

  IF v_entity_pk IS NULL THEN
    RAISE EXCEPTION 'shipping capture signal requires entity_pk/sourceListingId/source_listing_normalized_id/listing_id/candidate_id in payload';
  END IF;

  v_job_payload :=
    coalesce(p_payload,'{}'::jsonb)
    || jsonb_build_object(
      'source', coalesce(nullif(p_payload->>'source',''), 'shipengine'),
      'source_system', coalesce(nullif(p_payload->>'source_system',''), 'domain3_shipping_intelligence_v3'),
      'entity_type', v_entity_type,
      'entity_pk', v_entity_pk,
      'capture_contract_version', 'domain1.shipping_evidence.v1'
    );

  IF coalesce(v_job_payload->>'processRunId', v_job_payload->>'process_run_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    v_process_run_id := coalesce(v_job_payload->>'processRunId', v_job_payload->>'process_run_id')::uuid;
  END IF;

  IF coalesce(v_job_payload->>'processStepId', v_job_payload->>'process_step_id') ~ '^\d+$' THEN
    v_process_step_id := coalesce(v_job_payload->>'processStepId', v_job_payload->>'process_step_id')::bigint;
  END IF;

  IF coalesce(v_job_payload->>'candidate_id', v_job_payload->>'candidateId') ~ '^\d+$' THEN
    v_candidate_id := coalesce(v_job_payload->>'candidate_id', v_job_payload->>'candidateId')::bigint;
  END IF;

  IF coalesce(v_job_payload->>'listing_id', v_job_payload->>'listingId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    v_listing_id := coalesce(v_job_payload->>'listing_id', v_job_payload->>'listingId')::uuid;
  END IF;

  IF coalesce(v_job_payload->>'source_listing_normalized_id', v_job_payload->>'sourceListingId', v_job_payload->>'entity_pk') ~ '^\d+$' THEN
    v_source_listing_normalized_id := coalesce(v_job_payload->>'source_listing_normalized_id', v_job_payload->>'sourceListingId', v_job_payload->>'entity_pk')::bigint;
  END IF;

  IF coalesce(v_job_payload->>'quoted_label_cost_usd', v_job_payload->>'quotedAmount', v_job_payload->>'quoted_amount') ~ '^-?\d+(\.\d+)?$' THEN
    v_quoted_label_cost_usd := coalesce(v_job_payload->>'quoted_label_cost_usd', v_job_payload->>'quotedAmount', v_job_payload->>'quoted_amount')::numeric;
  END IF;

  IF v_job_payload->>'estimated_delivery_days' ~ '^\d+$' THEN
    v_estimated_delivery_days := (v_job_payload->>'estimated_delivery_days')::integer;
  END IF;

  IF v_job_payload->>'on_time_probability' ~ '^-?\d+(\.\d+)?$' THEN
    v_on_time_probability := (v_job_payload->>'on_time_probability')::numeric;
  END IF;

  IF v_job_payload->>'tracking_quality_score' ~ '^-?\d+(\.\d+)?$' THEN
    v_tracking_quality_score := (v_job_payload->>'tracking_quality_score')::numeric;
  END IF;

  IF coalesce(v_job_payload->>'claim_risk_score', v_job_payload->>'claimProbability') ~ '^-?\d+(\.\d+)?$' THEN
    v_claim_risk_score := coalesce(v_job_payload->>'claim_risk_score', v_job_payload->>'claimProbability')::numeric;
  END IF;

  v_signal_hash := encode(digest(
    v_entity_type || ':' ||
    v_entity_pk || ':' ||
    coalesce(v_job_payload->>'selected_carrier_code', v_job_payload->>'carrier', v_job_payload->>'carrier_code','') || ':' ||
    coalesce(v_job_payload->>'selected_service_code', v_job_payload->>'service', v_job_payload->>'service_code','') || ':' ||
    coalesce(v_job_payload->>'quoted_label_cost_usd', v_job_payload->>'quotedAmount', v_job_payload->>'quoted_amount','') || ':' ||
    coalesce(v_job_payload->>'decision_hash','') || ':' ||
    coalesce(v_job_payload->>'evidence_kind',''),
    'sha256'
  ), 'hex');

  INSERT INTO arb.shipping_capture_signal_outbox (
    signal_hash,
    status,
    process_run_id,
    process_step_id,
    candidate_id,
    listing_id,
    source_listing_normalized_id,
    entity_type,
    entity_pk,
    selected_carrier_code,
    selected_service_code,
    selected_service_name,
    quoted_label_cost_usd,
    estimated_delivery_days,
    on_time_probability,
    tracking_quality_score,
    claim_risk_score,
    payload_json
  )
  VALUES (
    v_signal_hash,
    'PENDING',
    v_process_run_id,
    v_process_step_id,
    v_candidate_id,
    v_listing_id,
    v_source_listing_normalized_id,
    v_entity_type,
    v_entity_pk,
    coalesce(v_job_payload->>'selected_carrier_code', v_job_payload->>'carrier', v_job_payload->>'carrier_code'),
    coalesce(v_job_payload->>'selected_service_code', v_job_payload->>'service', v_job_payload->>'service_code'),
    coalesce(v_job_payload->>'selected_service_name', v_job_payload->>'service_name'),
    v_quoted_label_cost_usd,
    v_estimated_delivery_days,
    v_on_time_probability,
    v_tracking_quality_score,
    v_claim_risk_score,
    v_job_payload
  )
  ON CONFLICT (signal_hash) DO UPDATE SET
    payload_json = arb.shipping_capture_signal_outbox.payload_json || EXCLUDED.payload_json,
    status = CASE
      WHEN arb.shipping_capture_signal_outbox.status IN ('FAILED','DEAD_LETTER','CANCELLED') THEN 'PENDING'
      ELSE arb.shipping_capture_signal_outbox.status
    END,
    available_at = CASE
      WHEN arb.shipping_capture_signal_outbox.status IN ('FAILED','DEAD_LETTER','CANCELLED') THEN now()
      ELSE arb.shipping_capture_signal_outbox.available_at
    END,
    updated_at = now()
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE VIEW arb.v_shipping_intelligence_v3_capture_outbox_health AS
SELECT
  status,
  count(*) AS signal_count,
  min(created_at) AS oldest_signal_at,
  max(updated_at) AS newest_update_at,
  max(attempts) AS max_attempts_seen
FROM arb.shipping_capture_signal_outbox
GROUP BY status;

CREATE OR REPLACE VIEW arb.v_domain3_shipping_evidence_signals AS
SELECT
  id,
  process_run_id,
  process_step_id,
  forensic_event_id,
  entity_type,
  entity_pk,
  source_listing_normalized_id,
  shipment_id,
  carrier_code,
  service_code,
  service_name,
  quoted_label_cost_usd,
  estimated_delivery_days,
  on_time_probability,
  tracking_quality_score,
  claim_risk_score,
  payload_json,
  created_at
FROM arb.shipping_evidence
WHERE entity_type IN ('listing','arb.listings','acquisition_listing','shipment','shipping_evidence')
  AND coalesce(payload_json->>'source','') IN ('shipengine','usps','ups','fedex','dhl','domain3_shipping_intelligence','domain3_shipping_intelligence_v3');

COMMIT;
