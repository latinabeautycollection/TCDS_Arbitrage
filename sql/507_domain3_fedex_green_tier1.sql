BEGIN;

CREATE SCHEMA IF NOT EXISTS arb;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================================
-- FedEx core security/auth/cache
-- ============================================================================

CREATE TABLE IF NOT EXISTS arb.fedex_oauth_token_cache (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  environment text NOT NULL DEFAULT 'production' CHECK (environment IN ('sandbox','production')),
  account_number_hash text,
  client_id_hash text,
  token_type text,
  scope text,
  access_token_enc text,
  issued_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  refresh_after timestamptz NOT NULL,
  last_used_at timestamptz,
  success boolean NOT NULL DEFAULT true,
  error_code text,
  error_message text,
  response_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(response_json)='object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(environment, account_number_hash, client_id_hash)
);

CREATE TABLE IF NOT EXISTS arb.fedex_api_ledger (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  environment text NOT NULL DEFAULT 'production' CHECK (environment IN ('sandbox','production')),
  api_area text NOT NULL,
  endpoint_path text NOT NULL,
  http_method text NOT NULL CHECK (http_method IN ('GET','POST','PUT','PATCH','DELETE')),
  carrier_code text NOT NULL DEFAULT 'FEDEX',
  shipment_id bigint REFERENCES arb.shipments(id),
  shipment_quote_id bigint REFERENCES arb.shipment_quotes(id),
  ebay_order_fk bigint REFERENCES arb.ebay_order(id),
  source_listing_normalized_id bigint REFERENCES arb.listing_normalized(id),
  tracking_number text,
  request_hash text NOT NULL CHECK (length(request_hash) >= 32),
  response_hash text CHECK (response_hash IS NULL OR length(response_hash) >= 32),
  request_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(request_json)='object'),
  response_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(response_json)='object'),
  status_code integer,
  success boolean NOT NULL DEFAULT false,
  retry_count integer NOT NULL DEFAULT 0,
  duration_ms integer,
  fedex_transaction_id text,
  error_code text,
  error_message text,
  process_run_id uuid REFERENCES arb.process_runs(run_id),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================================================
-- FedEx API domain snapshots
-- ============================================================================

CREATE TABLE IF NOT EXISTS arb.fedex_address_validation_snapshots (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  shipment_id bigint REFERENCES arb.shipments(id),
  ebay_order_fk bigint REFERENCES arb.ebay_order(id),
  input_address_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(input_address_json)='object'),
  resolved_address_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(resolved_address_json)='object'),
  classification text,
  valid boolean NOT NULL DEFAULT false,
  deliverable boolean NOT NULL DEFAULT false,
  residential boolean,
  business boolean,
  dpv_like_score numeric CHECK (dpv_like_score IS NULL OR dpv_like_score BETWEEN 0 AND 100),
  warnings_json jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(warnings_json)='array'),
  raw_response_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(raw_response_json)='object'),
  process_run_id uuid REFERENCES arb.process_runs(run_id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS arb.fedex_service_availability_snapshots (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  shipment_id bigint REFERENCES arb.shipments(id),
  origin_postal_code text,
  origin_country_code text DEFAULT 'US',
  destination_postal_code text,
  destination_country_code text DEFAULT 'US',
  ship_date date,
  carrier_code text DEFAULT 'FDXE',
  service_types text[],
  packaging_type text,
  one_rate_eligible boolean,
  available_services_json jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(available_services_json)='array'),
  raw_response_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(raw_response_json)='object'),
  request_hash text NOT NULL CHECK (length(request_hash) >= 32),
  response_hash text NOT NULL CHECK (length(response_hash) >= 32),
  process_run_id uuid REFERENCES arb.process_runs(run_id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS arb.fedex_rate_quote_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  shipment_id bigint REFERENCES arb.shipments(id),
  shipment_quote_id bigint REFERENCES arb.shipment_quotes(id),
  ebay_order_fk bigint REFERENCES arb.ebay_order(id),
  source_listing_normalized_id bigint REFERENCES arb.listing_normalized(id),
  origin_postal_code text,
  destination_postal_code text,
  service_type text,
  service_name text,
  packaging_type text,
  pickup_type text,
  rate_request_type text,
  currency text DEFAULT 'USD',
  total_net_charge_usd numeric,
  total_base_charge_usd numeric,
  total_surcharges_usd numeric,
  total_taxes_usd numeric,
  list_charge_usd numeric,
  account_charge_usd numeric,
  transit_days integer,
  delivery_timestamp timestamptz,
  saturday_delivery boolean,
  signature_option text,
  insurance_amount_usd numeric,
  weight_lb numeric,
  length_in numeric,
  width_in numeric,
  height_in numeric,
  dim_weight_lb numeric,
  selected boolean NOT NULL DEFAULT false,
  request_hash text NOT NULL CHECK (length(request_hash) >= 32),
  response_hash text NOT NULL CHECK (length(response_hash) >= 32),
  request_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(request_json)='object'),
  response_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(response_json)='object'),
  normalized_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(normalized_json)='object'),
  process_run_id uuid REFERENCES arb.process_runs(run_id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS arb.fedex_rate_quote_line_items (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  fedex_rate_quote_event_id bigint NOT NULL REFERENCES arb.fedex_rate_quote_events(id) ON DELETE CASCADE,
  line_item_type text NOT NULL CHECK (line_item_type IN ('BASE','SURCHARGE','TAX','DISCOUNT','FUEL','OTHER')),
  charge_code text,
  charge_name text,
  amount_usd numeric NOT NULL DEFAULT 0,
  currency text DEFAULT 'USD',
  raw_line_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(raw_line_json)='object'),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS arb.fedex_label_artifacts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  shipment_id bigint REFERENCES arb.shipments(id),
  ebay_order_fk bigint REFERENCES arb.ebay_order(id),
  transaction_id text,
  master_tracking_number text,
  tracking_number text,
  service_type text,
  packaging_type text,
  label_format text DEFAULT 'PDF',
  image_type text DEFAULT 'PDF',
  label_url text,
  label_storage_key text,
  label_base64_hash text,
  label_size_bytes integer,
  commercial_invoice_storage_key text,
  documents_json jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(documents_json)='array'),
  label_payload_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(label_payload_json)='object'),
  voided boolean NOT NULL DEFAULT false,
  voided_at timestamptz,
  process_run_id uuid REFERENCES arb.process_runs(run_id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS arb.fedex_tracking_snapshots (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  shipment_id bigint REFERENCES arb.shipments(id),
  ebay_order_fk bigint REFERENCES arb.ebay_order(id),
  tracking_number text NOT NULL,
  carrier_code text DEFAULT 'FEDEX',
  status_code text,
  status_description text,
  scan_location text,
  service_type text,
  ship_date date,
  estimated_delivery_at timestamptz,
  actual_delivery_at timestamptz,
  exception_code text,
  exception_description text,
  delivery_signed_by text,
  proof_available boolean NOT NULL DEFAULT false,
  raw_response_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(raw_response_json)='object'),
  snapshot_hash text NOT NULL CHECK (length(snapshot_hash) >= 32),
  process_run_id uuid REFERENCES arb.process_runs(run_id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS arb.fedex_tracking_event_details (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  fedex_tracking_snapshot_id bigint NOT NULL REFERENCES arb.fedex_tracking_snapshots(id) ON DELETE CASCADE,
  shipment_id bigint REFERENCES arb.shipments(id),
  tracking_number text NOT NULL,
  event_type text,
  event_description text,
  event_city text,
  event_state text,
  event_postal_code text,
  event_country text,
  event_time timestamptz,
  raw_event_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(raw_event_json)='object'),
  event_hash text NOT NULL CHECK (length(event_hash) >= 32),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS arb.fedex_notifications (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  shipment_id bigint REFERENCES arb.shipments(id),
  ebay_order_fk bigint REFERENCES arb.ebay_order(id),
  tracking_number text NOT NULL,
  notification_type text NOT NULL CHECK (notification_type IN ('ON_SHIPMENT','ON_EXCEPTION','ON_DELIVERY','ON_ESTIMATED_DELIVERY','ON_TENDER','ALL')),
  recipients_json jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(recipients_json)='array'),
  request_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(request_json)='object'),
  response_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(response_json)='object'),
  success boolean NOT NULL DEFAULT false,
  process_run_id uuid REFERENCES arb.process_runs(run_id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS arb.fedex_proof_of_delivery (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  shipment_id bigint REFERENCES arb.shipments(id),
  ebay_order_fk bigint REFERENCES arb.ebay_order(id),
  tracking_number text NOT NULL,
  document_type text NOT NULL DEFAULT 'SIGNATURE_PROOF_OF_DELIVERY',
  signed_by text,
  delivery_at timestamptz,
  document_url text,
  document_storage_key text,
  document_hash text,
  request_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(request_json)='object'),
  response_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(response_json)='object'),
  success boolean NOT NULL DEFAULT false,
  process_run_id uuid REFERENCES arb.process_runs(run_id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS arb.fedex_returns (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  shipment_id bigint REFERENCES arb.shipments(id),
  ebay_order_fk bigint REFERENCES arb.ebay_order(id),
  original_tracking_number text,
  return_tracking_number text,
  return_type text NOT NULL CHECK (return_type IN ('RETURN_LABEL','RETURN_TAG','EMAIL_RETURN_LABEL','PRINT_RETURN_LABEL')),
  rma_number text,
  label_storage_key text,
  label_url text,
  status text NOT NULL DEFAULT 'CREATED' CHECK (status IN ('CREATED','EMAILED','IN_TRANSIT','DELIVERED','CANCELLED','FAILED')),
  request_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(request_json)='object'),
  response_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(response_json)='object'),
  process_run_id uuid REFERENCES arb.process_runs(run_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS arb.fedex_claims (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  shipment_id bigint REFERENCES arb.shipments(id),
  ebay_order_fk bigint REFERENCES arb.ebay_order(id),
  tracking_number text,
  claim_number text,
  claim_type text NOT NULL CHECK (claim_type IN ('LOSS','DAMAGE','DELAY','BILLING','OTHER')),
  claim_status text NOT NULL DEFAULT 'DRAFT' CHECK (claim_status IN ('DRAFT','READY_TO_SUBMIT','SUBMITTED','IN_REVIEW','APPROVED','DENIED','PAID','CLOSED','FAILED')),
  claim_amount_usd numeric,
  paid_amount_usd numeric,
  claim_readiness_score numeric CHECK (claim_readiness_score IS NULL OR claim_readiness_score BETWEEN 0 AND 100),
  evidence_packet_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(evidence_packet_json)='object'),
  missing_evidence_json jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(missing_evidence_json)='array'),
  submitted_at timestamptz,
  resolved_at timestamptz,
  request_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(request_json)='object'),
  response_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(response_json)='object'),
  process_run_id uuid REFERENCES arb.process_runs(run_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS arb.fedex_pickup_requests (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  pickup_confirmation_number text,
  shipment_id bigint REFERENCES arb.shipments(id),
  account_number_hash text,
  pickup_status text NOT NULL DEFAULT 'REQUESTED' CHECK (pickup_status IN ('REQUESTED','CONFIRMED','CANCELLED','FAILED','COMPLETED')),
  pickup_location_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(pickup_location_json)='object'),
  ready_at timestamptz,
  latest_pickup_at timestamptz,
  package_count integer,
  total_weight_lb numeric,
  request_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(request_json)='object'),
  response_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(response_json)='object'),
  process_run_id uuid REFERENCES arb.process_runs(run_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS arb.fedex_webhook_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_source text NOT NULL DEFAULT 'FEDEX',
  event_type text,
  fedex_event_id text,
  tracking_number text,
  shipment_id bigint REFERENCES arb.shipments(id),
  headers_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(headers_json)='object'),
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(raw_payload)='object'),
  payload_hash text NOT NULL CHECK (length(payload_hash) >= 32),
  signature_present boolean NOT NULL DEFAULT false,
  signature_valid boolean,
  processing_status text NOT NULL DEFAULT 'RECEIVED' CHECK (processing_status IN ('RECEIVED','DUPLICATE','PROCESSED','FAILED','DEAD_LETTER')),
  retry_count integer NOT NULL DEFAULT 0,
  error_message text,
  process_run_id uuid REFERENCES arb.process_runs(run_id),
  received_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(event_source, payload_hash)
);

CREATE TABLE IF NOT EXISTS arb.fedex_billing_adjustments (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  shipment_id bigint REFERENCES arb.shipments(id),
  ebay_order_fk bigint REFERENCES arb.ebay_order(id),
  tracking_number text,
  invoice_number text,
  adjustment_type text NOT NULL CHECK (adjustment_type IN ('DIM_WEIGHT','ADDRESS_CORRECTION','FUEL','RESIDENTIAL','DELIVERY_AREA','REMOTE_AREA','SATURDAY','OTHER')),
  quoted_amount_usd numeric,
  billed_amount_usd numeric,
  adjustment_amount_usd numeric,
  dispute_status text NOT NULL DEFAULT 'NOT_REVIEWED' CHECK (dispute_status IN ('NOT_REVIEWED','REVIEW','DISPUTED','APPROVED','DENIED','CLOSED')),
  raw_invoice_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(raw_invoice_json)='object'),
  process_run_id uuid REFERENCES arb.process_runs(run_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS arb.fedex_preflight_results (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_id uuid DEFAULT gen_random_uuid(),
  test_group text NOT NULL,
  test_name text NOT NULL,
  test_status text NOT NULL CHECK (test_status IN ('PASS','WARN','FAIL')),
  severity text NOT NULL CHECK (severity IN ('LOW','MEDIUM','HIGH','CRITICAL')),
  message text,
  details_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(details_json)='object'),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS arb.fedex_smoke_test_results (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_id uuid DEFAULT gen_random_uuid(),
  test_group text NOT NULL,
  test_name text NOT NULL,
  test_status text NOT NULL CHECK (test_status IN ('PASS','WARN','FAIL')),
  severity text NOT NULL CHECK (severity IN ('LOW','MEDIUM','HIGH','CRITICAL')),
  message text,
  details_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(details_json)='object'),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_fedex_api_ledger_created ON arb.fedex_api_ledger(api_area, success, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_fedex_api_ledger_shipment ON arb.fedex_api_ledger(shipment_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_fedex_address_validation_shipment ON arb.fedex_address_validation_snapshots(shipment_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_fedex_service_availability_lane ON arb.fedex_service_availability_snapshots(origin_postal_code, destination_postal_code, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_fedex_rate_quote_shipment ON arb.fedex_rate_quote_events(shipment_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_fedex_rate_quote_service ON arb.fedex_rate_quote_events(service_type, total_net_charge_usd, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_fedex_label_tracking ON arb.fedex_label_artifacts(tracking_number, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_fedex_tracking_snapshots_tracking ON arb.fedex_tracking_snapshots(tracking_number, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_fedex_tracking_events_tracking_time ON arb.fedex_tracking_event_details(tracking_number, event_time DESC);
CREATE INDEX IF NOT EXISTS idx_fedex_claims_status ON arb.fedex_claims(claim_status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_fedex_pickup_status ON arb.fedex_pickup_requests(pickup_status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_fedex_webhook_status ON arb.fedex_webhook_events(processing_status, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_fedex_billing_adjustment_status ON arb.fedex_billing_adjustments(dispute_status, created_at DESC);

-- Views
CREATE OR REPLACE VIEW arb.v_fedex_oauth_latest AS
SELECT DISTINCT ON (environment, account_number_hash, client_id_hash)
  id, environment, account_number_hash, client_id_hash, token_type, scope, issued_at, expires_at, refresh_after, last_used_at, success, error_code, created_at
FROM arb.fedex_oauth_token_cache
ORDER BY environment, account_number_hash, client_id_hash, created_at DESC, id DESC;

CREATE OR REPLACE VIEW arb.v_fedex_address_validation_latest AS
SELECT DISTINCT ON (shipment_id, ebay_order_fk)
  *
FROM arb.fedex_address_validation_snapshots
ORDER BY shipment_id, ebay_order_fk, created_at DESC, id DESC;

CREATE OR REPLACE VIEW arb.v_fedex_rate_quote_latest AS
SELECT DISTINCT ON (shipment_id, service_type, packaging_type)
  *
FROM arb.fedex_rate_quote_events
ORDER BY shipment_id, service_type, packaging_type, created_at DESC, id DESC;

CREATE OR REPLACE VIEW arb.v_fedex_tracking_latest AS
SELECT DISTINCT ON (tracking_number)
  *
FROM arb.fedex_tracking_snapshots
ORDER BY tracking_number, created_at DESC, id DESC;

CREATE OR REPLACE VIEW arb.v_fedex_claim_dashboard AS
SELECT
  c.id,
  c.shipment_id,
  c.ebay_order_fk,
  c.tracking_number,
  c.claim_number,
  c.claim_type,
  c.claim_status,
  c.claim_amount_usd,
  c.paid_amount_usd,
  c.claim_readiness_score,
  s.shipment_status,
  s.selected_service_code,
  s.label_cost_usd,
  c.created_at,
  c.updated_at
FROM arb.fedex_claims c
LEFT JOIN arb.shipments s ON s.id = c.shipment_id;

CREATE OR REPLACE VIEW arb.v_fedex_profit_protection_dashboard AS
SELECT
  q.shipment_id,
  q.ebay_order_fk,
  q.service_type,
  q.total_net_charge_usd,
  q.total_surcharges_usd,
  q.dim_weight_lb,
  q.selected,
  b.adjustment_amount_usd,
  b.adjustment_type,
  b.dispute_status,
  c.claim_status,
  c.claim_amount_usd,
  c.paid_amount_usd,
  q.created_at
FROM arb.fedex_rate_quote_events q
LEFT JOIN arb.fedex_billing_adjustments b ON b.shipment_id = q.shipment_id
LEFT JOIN arb.fedex_claims c ON c.shipment_id = q.shipment_id;

-- Functions
CREATE OR REPLACE FUNCTION arb.fedex_claim_readiness_band(p_score numeric)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_score >= 90 THEN 'READY_TO_SUBMIT'
    WHEN p_score >= 75 THEN 'BUILD_PACKET'
    WHEN p_score >= 50 THEN 'HUMAN_REVIEW'
    ELSE 'EXECUTIVE_REVIEW'
  END;
$$;

CREATE OR REPLACE FUNCTION arb.fedex_rate_value_score(
  p_total_net_charge numeric,
  p_cheapest_charge numeric,
  p_transit_days numeric,
  p_risk_score numeric
)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT GREATEST(0, LEAST(100,
    100
    - CASE WHEN COALESCE(p_cheapest_charge,0) > 0 THEN ((COALESCE(p_total_net_charge,p_cheapest_charge) - p_cheapest_charge) / p_cheapest_charge) * 35 ELSE 0 END
    - COALESCE(p_transit_days,3) * 2
    - COALESCE(p_risk_score,40) * 0.4
  ));
$$;

-- Carrier seed
INSERT INTO arb.shipping_carriers (
  carrier_code, carrier_name, enabled, sandbox_enabled, domestic_supported, international_supported,
  label_supported, tracking_supported, insurance_supported, signature_supported, api_health_status, priority_rank
)
VALUES
  ('FEDEX','FedEx',true,true,true,true,true,true,true,true,'UNKNOWN',30)
ON CONFLICT (carrier_code) DO UPDATE SET
  enabled = true,
  sandbox_enabled = true,
  domestic_supported = true,
  international_supported = true,
  label_supported = true,
  tracking_supported = true,
  insurance_supported = true,
  signature_supported = true,
  updated_at = now();

-- Process seeds
INSERT INTO arb.process_registry (process_name, phase_no, process_group, description, owner_team, active_flag)
VALUES
  ('domain3.shipping.fedex.oauth',3,'shipping_fedex','FedEx OAuth token retrieval and cache.', 'TCDS', true),
  ('domain3.shipping.fedex.address_validation',3,'shipping_fedex','FedEx address validation.', 'TCDS', true),
  ('domain3.shipping.fedex.rates',3,'shipping_fedex','FedEx rates and transit quotes.', 'TCDS', true),
  ('domain3.shipping.fedex.service_availability',3,'shipping_fedex','FedEx service availability snapshots.', 'TCDS', true),
  ('domain3.shipping.fedex.label_create',3,'shipping_fedex','FedEx shipment and label creation.', 'TCDS', true),
  ('domain3.shipping.fedex.tracking',3,'shipping_fedex','FedEx tracking lookup and event persistence.', 'TCDS', true),
  ('domain3.shipping.fedex.notifications',3,'shipping_fedex','FedEx tracking notifications.', 'TCDS', true),
  ('domain3.shipping.fedex.proof_of_delivery',3,'shipping_fedex','FedEx proof of delivery retrieval.', 'TCDS', true),
  ('domain3.shipping.fedex.returns',3,'shipping_fedex','FedEx returns and return tags.', 'TCDS', true),
  ('domain3.shipping.fedex.claims',3,'shipping_fedex','FedEx claims lifecycle.', 'TCDS', true),
  ('domain3.shipping.fedex.pickup',3,'shipping_fedex','FedEx pickup lifecycle.', 'TCDS', true),
  ('domain3.shipping.fedex.webhook_ingest',3,'shipping_fedex','FedEx webhook event inbox.', 'TCDS', true),
  ('domain3.shipping.fedex.billing_adjustments',3,'shipping_fedex','FedEx billing adjustments and disputes.', 'TCDS', true),
  ('domain3.shipping.fedex.worker_tracking',3,'shipping_fedex_worker','FedEx tracking polling worker.', 'TCDS', true),
  ('domain3.shipping.fedex.worker_claims',3,'shipping_fedex_worker','FedEx claims monitoring worker.', 'TCDS', true),
  ('domain3.shipping.fedex.worker_billing',3,'shipping_fedex_worker','FedEx billing adjustment worker.', 'TCDS', true),
  ('domain3.shipping.fedex.preflight',3,'shipping_fedex_governance','FedEx preflight suite.', 'TCDS', true),
  ('domain3.shipping.fedex.smoke',3,'shipping_fedex_governance','FedEx smoke suite.', 'TCDS', true)
ON CONFLICT (process_name) DO UPDATE SET
  description = EXCLUDED.description,
  active_flag = EXCLUDED.active_flag,
  updated_at = now();

COMMIT;
