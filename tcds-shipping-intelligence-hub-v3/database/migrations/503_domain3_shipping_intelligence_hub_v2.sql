BEGIN;

ALTER TABLE arb.shipping_intelligence_decisions
  ADD COLUMN IF NOT EXISTS idempotency_key text,
  ADD COLUMN IF NOT EXISTS input_hash text,
  ADD COLUMN IF NOT EXISTS decision_stage text,
  ADD COLUMN IF NOT EXISTS protected_shipping_charge_cents bigint,
  ADD COLUMN IF NOT EXISTS expected_net_profit_cents bigint,
  ADD COLUMN IF NOT EXISTS worst_case_net_profit_cents bigint,
  ADD COLUMN IF NOT EXISTS fail_closed boolean NOT NULL DEFAULT false;

UPDATE arb.shipping_intelligence_decisions
SET idempotency_key = COALESCE(idempotency_key, decision_uuid::text),
    input_hash = COALESCE(input_hash, evidence_hash),
    decision_stage = COALESCE(decision_stage, 'LEGACY'),
    protected_shipping_charge_cents = COALESCE(
      protected_shipping_charge_cents,
      round(protected_shipping_charge_usd * 100)::bigint
    ),
    expected_net_profit_cents = COALESCE(
      expected_net_profit_cents,
      round(expected_net_profit_usd * 100)::bigint
    ),
    worst_case_net_profit_cents = COALESCE(
      worst_case_net_profit_cents,
      round(worst_case_net_profit_usd * 100)::bigint
    )
WHERE idempotency_key IS NULL
   OR input_hash IS NULL
   OR decision_stage IS NULL
   OR protected_shipping_charge_cents IS NULL;

ALTER TABLE arb.shipping_intelligence_decisions
  ALTER COLUMN idempotency_key SET NOT NULL,
  ALTER COLUMN input_hash SET NOT NULL,
  ALTER COLUMN decision_stage SET NOT NULL,
  ALTER COLUMN protected_shipping_charge_cents SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_shipping_intelligence_idempotency
  ON arb.shipping_intelligence_decisions(idempotency_key, decision_stage, policy_version, ruleset_version);

CREATE INDEX IF NOT EXISTS idx_shipping_intelligence_fail_closed
  ON arb.shipping_intelligence_decisions(fail_closed, created_at DESC)
  WHERE fail_closed = true;

CREATE TABLE IF NOT EXISTS arb.shipping_intelligence_quote_batches (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  decision_id bigint NOT NULL REFERENCES arb.shipping_intelligence_decisions(id) ON DELETE CASCADE,
  request_id uuid NOT NULL,
  quote_purpose text NOT NULL CHECK (quote_purpose IN ('ZONE_ANCHOR','ACTUAL_DESTINATION')),
  destination_postal_code text NOT NULL,
  anchor_key text,
  complete boolean NOT NULL,
  quotes_json jsonb NOT NULL CHECK (jsonb_typeof(quotes_json) = 'array'),
  failures_json jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(failures_json) = 'array'),
  captured_at timestamptz NOT NULL,
  UNIQUE(request_id)
);

CREATE TABLE IF NOT EXISTS arb.shipping_intelligence_outbox (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  aggregate_type text NOT NULL,
  aggregate_id text NOT NULL,
  event_type text NOT NULL,
  payload_json jsonb NOT NULL CHECK (jsonb_typeof(payload_json) = 'object'),
  idempotency_key text NOT NULL UNIQUE,
  published_at timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION arb.record_shipping_intelligence_decision_v2(p_payload jsonb)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, arb, public
AS $$
DECLARE
  v_id bigint;
  v_decision_uuid uuid := (p_payload->>'decision_id')::uuid;
  v_existing_hash text;
BEGIN
  IF p_payload->>'idempotency_key' IS NULL OR length(p_payload->>'idempotency_key') < 8 THEN
    RAISE EXCEPTION 'invalid idempotency key';
  END IF;
  IF p_payload->>'input_hash' !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'invalid input hash';
  END IF;
  IF p_payload->>'evidence_hash' !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'invalid evidence hash';
  END IF;

  SELECT evidence_hash, id INTO v_existing_hash, v_id
  FROM arb.shipping_intelligence_decisions
  WHERE idempotency_key = p_payload->>'idempotency_key'
    AND decision_stage = p_payload->>'stage'
    AND policy_version = p_payload->>'policy_version'
    AND ruleset_version = p_payload->>'ruleset_version'
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing_hash <> p_payload->>'evidence_hash' THEN
      RAISE EXCEPTION 'idempotency conflict: existing evidence differs';
    END IF;
    RETURN v_id;
  END IF;

  INSERT INTO arb.shipping_intelligence_decisions (
    decision_uuid, idempotency_key, input_hash, correlation_id, decision_stage,
    process_run_id, listing_id, candidate_id, source_listing_normalized_id,
    ebay_listing_fk, ebay_order_fk, shipment_id, hub_mode, decision_status,
    policy_version, model_version, ruleset_version, risk_score, confidence_score,
    protected_shipping_charge_usd, protected_shipping_charge_cents,
    expected_net_profit_usd, expected_net_profit_cents,
    worst_case_net_profit_usd, worst_case_net_profit_cents,
    fail_closed, evidence_hash, decision_json
  ) VALUES (
    v_decision_uuid,
    p_payload->>'idempotency_key',
    p_payload->>'input_hash',
    p_payload->>'correlation_id',
    p_payload->>'stage',
    NULLIF(p_payload->>'process_run_id','')::uuid,
    NULLIF(p_payload->>'listing_id','')::uuid,
    NULLIF(p_payload->>'candidate_id','')::bigint,
    NULLIF(p_payload->>'source_listing_normalized_id','')::bigint,
    NULLIF(p_payload->>'ebay_listing_fk','')::bigint,
    NULLIF(p_payload->>'ebay_order_fk','')::bigint,
    NULLIF(p_payload->>'shipment_id','')::bigint,
    p_payload->>'mode',
    p_payload->>'status',
    p_payload->>'policy_version',
    p_payload->>'model_version',
    p_payload->>'ruleset_version',
    (p_payload->>'risk_score')::numeric,
    (p_payload->>'confidence_score')::numeric,
    (p_payload->>'protected_shipping_charge_cents')::numeric / 100,
    (p_payload->>'protected_shipping_charge_cents')::bigint,
    NULLIF(p_payload->>'expected_net_profit_cents','')::numeric / 100,
    NULLIF(p_payload->>'expected_net_profit_cents','')::bigint,
    NULLIF(p_payload->>'worst_case_net_profit_cents','')::numeric / 100,
    NULLIF(p_payload->>'worst_case_net_profit_cents','')::bigint,
    COALESCE((p_payload->>'fail_closed')::boolean, false),
    p_payload->>'evidence_hash',
    p_payload->'decision_json'
  )
  RETURNING id INTO v_id;

  INSERT INTO arb.events_audit(event_type, entity_type, entity_id, payload, request_id, actor)
  VALUES (
    'SHIPPING_INTELLIGENCE_DECISION_V2',
    'shipping_intelligence_decision',
    v_decision_uuid,
    jsonb_build_object(
      'decision_status', p_payload->>'status',
      'stage', p_payload->>'stage',
      'mode', p_payload->>'mode',
      'fail_closed', p_payload->>'fail_closed',
      'risk_score', p_payload->>'risk_score',
      'protected_shipping_charge_cents', p_payload->>'protected_shipping_charge_cents',
      'evidence_hash', p_payload->>'evidence_hash'
    ),
    p_payload->>'correlation_id',
    'shipping_intelligence_hub_v2'
  );

  INSERT INTO arb.shipping_intelligence_outbox(
    aggregate_type, aggregate_id, event_type, payload_json, idempotency_key
  ) VALUES (
    'shipping_intelligence_decision',
    v_decision_uuid::text,
    'SHIPPING_INTELLIGENCE_DECISION_RECORDED',
    jsonb_build_object('decision_id', v_decision_uuid, 'database_id', v_id),
    'shipping-decision-outbox:' || v_decision_uuid::text
  );

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION arb.record_shipping_intelligence_decision_v2(jsonb) FROM PUBLIC;
-- Grant only to the production application role after substituting the real role name:
-- GRANT EXECUTE ON FUNCTION arb.record_shipping_intelligence_decision_v2(jsonb) TO tcds_app;

COMMIT;
