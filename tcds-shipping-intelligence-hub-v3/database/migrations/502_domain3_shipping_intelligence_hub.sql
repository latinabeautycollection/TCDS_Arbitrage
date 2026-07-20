BEGIN;

CREATE TABLE IF NOT EXISTS arb.shipping_intelligence_decisions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  decision_uuid uuid NOT NULL UNIQUE,
  correlation_id text NOT NULL,
  process_run_id uuid REFERENCES arb.process_runs(run_id),
  listing_id uuid REFERENCES arb.listings(id),
  candidate_id bigint REFERENCES arb.candidates(id),
  source_listing_normalized_id bigint REFERENCES arb.listing_normalized(id),
  ebay_listing_fk bigint REFERENCES arb.ebay_listing(id),
  ebay_order_fk bigint REFERENCES arb.ebay_order(id),
  shipment_id bigint REFERENCES arb.shipments(id),
  hub_mode text NOT NULL CHECK (hub_mode IN (
    'DISABLED','OBSERVE_ONLY','SHADOW','RECOMMEND','ENFORCE_NON_BLOCKING','ENFORCE_BLOCKING'
  )),
  decision_status text NOT NULL CHECK (decision_status IN (
    'ALLOW','ALLOW_WITH_REQUIREMENTS','HOLD','REPRICE','REQUOTE','MANUAL_REVIEW','REJECT'
  )),
  policy_version text NOT NULL,
  model_version text NOT NULL,
  ruleset_version text NOT NULL,
  risk_score numeric NOT NULL CHECK (risk_score BETWEEN 0 AND 100),
  confidence_score numeric NOT NULL CHECK (confidence_score BETWEEN 0 AND 100),
  protected_shipping_charge_usd numeric NOT NULL CHECK (protected_shipping_charge_usd >= 0),
  expected_net_profit_usd numeric,
  worst_case_net_profit_usd numeric,
  evidence_hash text NOT NULL CHECK (length(evidence_hash) = 64),
  decision_json jsonb NOT NULL CHECK (jsonb_typeof(decision_json) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_shipping_intelligence_decisions_order
  ON arb.shipping_intelligence_decisions (ebay_order_fk, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_shipping_intelligence_decisions_shipment
  ON arb.shipping_intelligence_decisions (shipment_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_shipping_intelligence_decisions_status
  ON arb.shipping_intelligence_decisions (decision_status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_shipping_intelligence_decisions_correlation
  ON arb.shipping_intelligence_decisions (correlation_id);

CREATE TABLE IF NOT EXISTS arb.shipping_zone_snapshots (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  decision_id bigint REFERENCES arb.shipping_intelligence_decisions(id) ON DELETE CASCADE,
  anchor_key text NOT NULL,
  origin_postal_code text,
  destination_postal_code text NOT NULL,
  package_fingerprint text,
  quotes_json jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(quotes_json) = 'array'),
  maximum_eligible_rate_usd numeric,
  captured_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_shipping_zone_snapshots_anchor_time
  ON arb.shipping_zone_snapshots (anchor_key, captured_at DESC);

CREATE TABLE IF NOT EXISTS arb.shipping_lane_intelligence (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  carrier_code text NOT NULL,
  service_code text,
  origin_region text NOT NULL,
  destination_region text NOT NULL,
  package_class text,
  sample_size integer NOT NULL DEFAULT 0,
  on_time_rate numeric NOT NULL DEFAULT 0 CHECK (on_time_rate BETWEEN 0 AND 1),
  exception_rate numeric NOT NULL DEFAULT 0 CHECK (exception_rate BETWEEN 0 AND 1),
  claim_rate numeric NOT NULL DEFAULT 0 CHECK (claim_rate BETWEEN 0 AND 1),
  avg_quote_usd numeric,
  avg_actual_cost_usd numeric,
  p90_actual_cost_usd numeric,
  quote_variance_pct numeric,
  reliability_score numeric CHECK (reliability_score BETWEEN 0 AND 100),
  effective_from timestamptz NOT NULL DEFAULT now(),
  effective_to timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (carrier_code, service_code, origin_region, destination_region, package_class, effective_from)
);

CREATE INDEX IF NOT EXISTS idx_shipping_lane_intelligence_lookup
  ON arb.shipping_lane_intelligence
  (carrier_code, service_code, origin_region, destination_region, effective_to);

CREATE TABLE IF NOT EXISTS arb.shipping_policy_snapshots (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  policy_version text NOT NULL UNIQUE,
  policy_json jsonb NOT NULL CHECK (jsonb_typeof(policy_json) = 'object'),
  approved_by text,
  approved_at timestamptz,
  effective_at timestamptz NOT NULL DEFAULT now(),
  retired_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS arb.shipping_learning_outcomes (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  shipment_id bigint NOT NULL REFERENCES arb.shipments(id),
  decision_id bigint REFERENCES arb.shipping_intelligence_decisions(id),
  quoted_cost_usd numeric,
  label_cost_usd numeric,
  invoiced_cost_usd numeric,
  actual_adjustment_usd numeric,
  promised_delivery_end_at timestamptz,
  actual_delivered_at timestamptz,
  late_delivery boolean,
  claim_filed boolean NOT NULL DEFAULT false,
  claim_paid_usd numeric,
  returned boolean NOT NULL DEFAULT false,
  dispute_opened boolean NOT NULL DEFAULT false,
  outcome_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  reconciled_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (shipment_id, decision_id)
);

CREATE OR REPLACE FUNCTION arb.record_shipping_intelligence_decision(p_payload jsonb)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = arb, public
AS $$
DECLARE
  v_id bigint;
  v_decision_uuid uuid;
BEGIN
  v_decision_uuid := (p_payload->>'decision_id')::uuid;

  INSERT INTO arb.shipping_intelligence_decisions (
    decision_uuid, correlation_id, process_run_id, listing_id, candidate_id,
    source_listing_normalized_id, ebay_listing_fk, ebay_order_fk, shipment_id,
    hub_mode, decision_status, policy_version, model_version, ruleset_version,
    risk_score, confidence_score, protected_shipping_charge_usd,
    expected_net_profit_usd, worst_case_net_profit_usd, evidence_hash, decision_json
  ) VALUES (
    v_decision_uuid,
    p_payload->>'correlation_id',
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
    COALESCE((p_payload->>'risk_score')::numeric, 0),
    COALESCE((p_payload->>'confidence_score')::numeric, 0),
    COALESCE((p_payload->>'protected_shipping_charge_usd')::numeric, 0),
    NULLIF(p_payload->>'expected_net_profit_usd','')::numeric,
    NULLIF(p_payload->>'worst_case_net_profit_usd','')::numeric,
    p_payload->>'evidence_hash',
    p_payload->'decision_json'
  )
  ON CONFLICT (decision_uuid) DO UPDATE SET
    decision_json = EXCLUDED.decision_json,
    evidence_hash = EXCLUDED.evidence_hash
  RETURNING id INTO v_id;

  INSERT INTO arb.events_audit(event_type, entity_type, entity_id, payload, request_id, actor)
  VALUES (
    'SHIPPING_INTELLIGENCE_DECISION',
    'shipping_intelligence_decision',
    v_decision_uuid,
    jsonb_build_object(
      'decision_status', p_payload->>'status',
      'mode', p_payload->>'mode',
      'risk_score', p_payload->>'risk_score',
      'protected_shipping_charge_usd', p_payload->>'protected_shipping_charge_usd',
      'evidence_hash', p_payload->>'evidence_hash'
    ),
    p_payload->>'correlation_id',
    'shipping_intelligence_hub'
  );

  RETURN v_id;
END;
$$;

INSERT INTO arb.process_registry(process_name, phase_no, process_group, description, owner_team)
VALUES
  ('shipping_intelligence_presale', 3, 'shipping_intelligence', 'Worst-case zone protected presale shipping decision', 'shipping'),
  ('shipping_intelligence_order', 3, 'shipping_intelligence', 'Sold-order carrier and protection decision', 'shipping'),
  ('shipping_intelligence_label_auth', 3, 'shipping_intelligence', 'Pre-label policy authorization gate', 'shipping'),
  ('shipping_intelligence_reconcile', 3, 'shipping_intelligence', 'Actual cost and delivery outcome reconciliation', 'shipping')
ON CONFLICT (process_name) DO NOTHING;

INSERT INTO arb.feature_flags(flag_key, is_enabled, description)
VALUES
  ('shipping_intelligence_hub_enabled', false, 'Master switch for TCDS Shipping Intelligence Hub'),
  ('shipping_intelligence_zone_protection', false, 'Enable CA/FL/WI worst-case presale zone protection'),
  ('shipping_intelligence_blocking_mode', false, 'Permit intelligence hub to block label execution'),
  ('shipping_intelligence_mailbox_blocking', false, 'Block PO boxes, CMRAs, private mailboxes, freight forwarders and reshippers'),
  ('shipping_intelligence_learning', false, 'Enable post-shipment learning and reconciliation')
ON CONFLICT (flag_key) DO NOTHING;

COMMIT;
