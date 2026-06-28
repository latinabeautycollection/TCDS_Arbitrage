BEGIN;

CREATE SCHEMA IF NOT EXISTS arb;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS arb.dhl_api_key_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  api_area text NOT NULL CHECK (api_area IN ('TRACKING','LOCATION','ECOMMERCE','FREIGHT')),
  environment text NOT NULL DEFAULT 'production' CHECK (environment IN ('sandbox','test','production')),
  api_key_hash text CHECK (api_key_hash IS NULL OR length(api_key_hash) >= 32),
  success boolean NOT NULL DEFAULT false,
  response_status integer,
  response_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(response_json)='object'),
  process_run_id uuid REFERENCES arb.process_runs(run_id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS arb.dhl_api_error_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  api_area text,
  endpoint_path text,
  http_status integer,
  dhl_error_type text,
  dhl_error_title text,
  dhl_error_detail text,
  severity text CHECK (severity IS NULL OR severity IN ('TRANSIENT','HARD','UNKNOWN')),
  retryable boolean NOT NULL DEFAULT false,
  request_hash text CHECK (request_hash IS NULL OR length(request_hash) >= 32),
  response_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(response_json)='object'),
  process_run_id uuid REFERENCES arb.process_runs(run_id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS arb.dhl_tracking_snapshots (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  shipment_id bigint REFERENCES arb.shipments(id),
  ebay_order_fk bigint REFERENCES arb.ebay_order(id),
  tracking_number text NOT NULL,
  dhl_shipment_id text,
  service text,
  provider text,
  product_name text,
  status_code text,
  status_text text,
  status_description text,
  status_timestamp timestamptz,
  origin_country_code text,
  origin_postal_code text,
  origin_locality text,
  destination_country_code text,
  destination_postal_code text,
  destination_locality text,
  estimated_delivery_at timestamptz,
  proof_of_delivery_url text,
  signature_url text,
  weight_value numeric,
  weight_unit text,
  raw_response_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(raw_response_json)='object'),
  shipment_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(shipment_json)='object'),
  snapshot_hash text NOT NULL CHECK (length(snapshot_hash) >= 32),
  process_run_id uuid REFERENCES arb.process_runs(run_id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS arb.dhl_tracking_event_details (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  dhl_tracking_snapshot_id bigint REFERENCES arb.dhl_tracking_snapshots(id) ON DELETE CASCADE,
  shipment_id bigint REFERENCES arb.shipments(id),
  tracking_number text NOT NULL,
  event_timestamp timestamptz,
  event_status_code text,
  event_status text,
  event_description text,
  event_country_code text,
  event_postal_code text,
  event_locality text,
  raw_event_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(raw_event_json)='object'),
  event_hash text NOT NULL CHECK (length(event_hash) >= 32),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS arb.dhl_tracking_webhook_subscriptions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  hook_id text UNIQUE,
  pickup_account text,
  tracking_id text,
  hook_type text NOT NULL DEFAULT 'TRACK_EVENTS',
  url text NOT NULL,
  username_hash text CHECK (username_hash IS NULL OR length(username_hash) >= 32),
  active boolean NOT NULL DEFAULT true,
  subscription_type text NOT NULL CHECK (subscription_type IN ('PICKUP_ACCOUNT','TRACKING_ID')),
  request_hash text NOT NULL CHECK (length(request_hash) >= 32),
  response_hash text CHECK (response_hash IS NULL OR length(response_hash) >= 32),
  request_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(request_json)='object'),
  response_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(response_json)='object'),
  process_run_id uuid REFERENCES arb.process_runs(run_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS arb.dhl_tracking_webhook_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  hook_id text,
  tracking_number text,
  shipment_id bigint REFERENCES arb.shipments(id),
  basic_auth_valid boolean,
  headers_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(headers_json)='object'),
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(raw_payload)='object'),
  payload_hash text NOT NULL CHECK (length(payload_hash) >= 32),
  event_count integer NOT NULL DEFAULT 0,
  processing_status text NOT NULL DEFAULT 'RECEIVED' CHECK (processing_status IN ('RECEIVED','DUPLICATE','PROCESSED','FAILED','DEAD_LETTER')),
  process_run_id uuid REFERENCES arb.process_runs(run_id),
  received_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tracking_number, payload_hash)
);

CREATE TABLE IF NOT EXISTS arb.dhl_return_label_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  shipment_id bigint REFERENCES arb.shipments(id),
  return_case_id bigint REFERENCES arb.return_cases(id),
  pickup_account text NOT NULL,
  ordered_product_id text,
  merchant_id text,
  order_number text,
  authorization_number text,
  dhl_package_id text,
  tracking_id text,
  label_format text,
  label_encode_type text,
  label_hash text CHECK (label_hash IS NULL OR length(label_hash) >= 32),
  label_artifact_id bigint REFERENCES arb.shipping_label_artifacts(id),
  shipper_address_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(shipper_address_json)='object'),
  return_address_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(return_address_json)='object'),
  package_detail_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(package_detail_json)='object'),
  request_hash text NOT NULL CHECK (length(request_hash) >= 32),
  response_hash text NOT NULL CHECK (length(response_hash) >= 32),
  request_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(request_json)='object'),
  response_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(response_json)='object'),
  process_run_id uuid REFERENCES arb.process_runs(run_id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS arb.dhl_location_search_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  search_type text NOT NULL CHECK (search_type IN ('ADDRESS','GEO','KEYWORD_ID','LOCATION_ID')),
  country_code text,
  postal_code text,
  address_locality text,
  latitude numeric,
  longitude numeric,
  provider_type text,
  service_type text,
  location_type text,
  result_count integer NOT NULL DEFAULT 0,
  selected_location_id text,
  request_hash text NOT NULL CHECK (length(request_hash) >= 32),
  response_hash text NOT NULL CHECK (length(response_hash) >= 32),
  request_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(request_json)='object'),
  response_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(response_json)='object'),
  normalized_locations_json jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(normalized_locations_json)='array'),
  process_run_id uuid REFERENCES arb.process_runs(run_id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS arb.dhl_freight_oauth_token_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  environment text NOT NULL DEFAULT 'production' CHECK (environment IN ('sandbox','production')),
  api_key_hash text CHECK (api_key_hash IS NULL OR length(api_key_hash) >= 32),
  token_type text,
  expires_in_seconds integer,
  expires_at timestamptz,
  success boolean NOT NULL DEFAULT false,
  response_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(response_json)='object'),
  process_run_id uuid REFERENCES arb.process_runs(run_id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS arb.dhl_freight_price_quote_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  shipment_id bigint REFERENCES arb.shipments(id),
  quote_type text NOT NULL DEFAULT 'FREIGHT_PRICE_QUOTE',
  product_code text,
  payer_code text,
  origin_country_code text,
  origin_postal_code text,
  origin_city text,
  destination_country_code text,
  destination_postal_code text,
  destination_city text,
  total_weight_kg numeric,
  total_volume_m3 numeric,
  total_pieces integer,
  currency_code text,
  freight_cost numeric,
  fuel_surcharge numeric,
  insurance_cost numeric,
  total_price numeric,
  calculation_basis_json jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(calculation_basis_json)='array'),
  request_hash text NOT NULL CHECK (length(request_hash) >= 32),
  response_hash text NOT NULL CHECK (length(response_hash) >= 32),
  request_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(request_json)='object'),
  response_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(response_json)='object'),
  process_run_id uuid REFERENCES arb.process_runs(run_id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS arb.dhl_freight_booking_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  shipment_id bigint REFERENCES arb.shipments(id),
  dhl_shipment_id text,
  product_code text,
  payer_code text,
  pickup_date date,
  delivery_date date,
  total_weight_kg numeric,
  total_volume_m3 numeric,
  total_pieces integer,
  license_plates_json jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(license_plates_json)='array'),
  request_hash text NOT NULL CHECK (length(request_hash) >= 32),
  response_hash text NOT NULL CHECK (length(response_hash) >= 32),
  request_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(request_json)='object'),
  response_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(response_json)='object'),
  process_run_id uuid REFERENCES arb.process_runs(run_id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS arb.dhl_lane_learning_metrics (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  metric_date date NOT NULL DEFAULT current_date,
  service text,
  origin_country_code text,
  origin_postal_code text,
  destination_country_code text,
  destination_postal_code text,
  shipment_count integer NOT NULL DEFAULT 0,
  avg_delivery_days numeric,
  on_time_rate numeric CHECK (on_time_rate IS NULL OR on_time_rate BETWEEN 0 AND 1),
  delay_rate numeric CHECK (delay_rate IS NULL OR delay_rate BETWEEN 0 AND 1),
  loss_rate numeric CHECK (loss_rate IS NULL OR loss_rate BETWEEN 0 AND 1),
  return_rate numeric CHECK (return_rate IS NULL OR return_rate BETWEEN 0 AND 1),
  claim_rate numeric CHECK (claim_rate IS NULL OR claim_rate BETWEEN 0 AND 1),
  risk_score numeric CHECK (risk_score IS NULL OR risk_score BETWEEN 0 AND 100),
  recommendation_score numeric CHECK (recommendation_score IS NULL OR recommendation_score BETWEEN 0 AND 100),
  process_run_id uuid REFERENCES arb.process_runs(run_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(metric_date, service, origin_country_code, origin_postal_code, destination_country_code, destination_postal_code)
);

CREATE TABLE IF NOT EXISTS arb.dhl_decision_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  shipment_id bigint REFERENCES arb.shipments(id),
  ebay_order_fk bigint REFERENCES arb.ebay_order(id),
  decision_type text NOT NULL CHECK (decision_type IN ('TRACKING_RISK','RETURN_LABEL','LOCATION','FREIGHT_QUOTE','FREIGHT_BOOKING','CLAIM','DISPUTE','REVIEW_ROUTE')),
  selected_service text,
  selected_price_usd numeric,
  risk_score numeric CHECK (risk_score IS NULL OR risk_score BETWEEN 0 AND 100),
  profit_score numeric CHECK (profit_score IS NULL OR profit_score BETWEEN 0 AND 100),
  confidence_score numeric CHECK (confidence_score IS NULL OR confidence_score BETWEEN 0 AND 100),
  decision_reason text,
  input_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(input_json)='object'),
  output_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(output_json)='object'),
  human_review_required boolean NOT NULL DEFAULT false,
  ai_used boolean NOT NULL DEFAULT false,
  process_run_id uuid REFERENCES arb.process_runs(run_id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dhl_tracking_snapshots_tracking ON arb.dhl_tracking_snapshots(tracking_number, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dhl_tracking_events_time ON arb.dhl_tracking_event_details(tracking_number, event_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_dhl_webhook_status ON arb.dhl_tracking_webhook_events(processing_status, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_dhl_return_label_tracking ON arb.dhl_return_label_events(tracking_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dhl_location_search ON arb.dhl_location_search_events(country_code, postal_code, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dhl_freight_quote_shipment ON arb.dhl_freight_price_quote_events(shipment_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dhl_freight_booking_shipment ON arb.dhl_freight_booking_events(shipment_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dhl_lane_learning_lookup ON arb.dhl_lane_learning_metrics(service, origin_country_code, destination_country_code, metric_date DESC);
CREATE INDEX IF NOT EXISTS idx_dhl_decision_shipment ON arb.dhl_decision_events(shipment_id, created_at DESC);

CREATE OR REPLACE FUNCTION arb.dhl_error_severity(p_http_status integer)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_http_status IN (429,500,502,503,504) THEN 'TRANSIENT'
    WHEN p_http_status IS NULL THEN 'UNKNOWN'
    ELSE 'HARD'
  END;
$$;

CREATE OR REPLACE FUNCTION arb.dhl_delivery_exception_code(p_status_code text, p_status text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN lower(coalesce(p_status_code,'')) IN ('delivered','delivered-final') OR upper(coalesce(p_status,'')) LIKE '%DELIVERED%' THEN 'DELIVERED'
    WHEN lower(coalesce(p_status_code,'')) LIKE '%failure%' OR upper(coalesce(p_status,'')) LIKE '%FAILED%' THEN 'FAILED'
    WHEN lower(coalesce(p_status_code,'')) LIKE '%transit%' THEN 'IN_TRANSIT'
    WHEN lower(coalesce(p_status_code,'')) LIKE '%pre-transit%' THEN 'PRE_TRANSIT'
    WHEN upper(coalesce(p_status,'')) LIKE '%CUSTOMS%' THEN 'CUSTOMS'
    WHEN upper(coalesce(p_status,'')) LIKE '%RETURN%' THEN 'RETURN'
    WHEN upper(coalesce(p_status,'')) LIKE '%DELAY%' THEN 'DELAYED'
    ELSE 'NORMAL'
  END;
$$;

CREATE OR REPLACE FUNCTION arb.dhl_score_tracking_risk(p_status_code text, p_status text, p_days_since_update numeric)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT GREATEST(0, LEAST(100,
    CASE arb.dhl_delivery_exception_code(p_status_code, p_status)
      WHEN 'DELIVERED' THEN 5
      WHEN 'FAILED' THEN 90
      WHEN 'RETURN' THEN 80
      WHEN 'CUSTOMS' THEN 55
      WHEN 'DELAYED' THEN 70
      WHEN 'PRE_TRANSIT' THEN 35
      ELSE 25
    END + COALESCE(p_days_since_update,0) * 5
  ));
$$;

CREATE OR REPLACE VIEW arb.v_dhl_tracking_latest AS
SELECT DISTINCT ON (tracking_number)
  *,
  arb.dhl_delivery_exception_code(status_code, status_text) AS tcds_exception_code
FROM arb.dhl_tracking_snapshots
ORDER BY tracking_number, created_at DESC, id DESC;

CREATE OR REPLACE VIEW arb.v_dhl_return_label_latest AS
SELECT DISTINCT ON (tracking_id)
  *
FROM arb.dhl_return_label_events
ORDER BY tracking_id, created_at DESC, id DESC;

CREATE OR REPLACE VIEW arb.v_dhl_webhook_subscriptions_active AS
SELECT *
FROM arb.dhl_tracking_webhook_subscriptions
WHERE active = true;

CREATE OR REPLACE VIEW arb.v_dhl_freight_quote_latest AS
SELECT DISTINCT ON (shipment_id)
  *
FROM arb.dhl_freight_price_quote_events
ORDER BY shipment_id, created_at DESC, id DESC;

CREATE OR REPLACE VIEW arb.v_dhl_profit_protection_dashboard AS
SELECT
  d.shipment_id,
  d.ebay_order_fk,
  d.decision_type,
  d.selected_service,
  d.selected_price_usd,
  d.risk_score,
  d.profit_score,
  d.confidence_score,
  d.human_review_required,
  s.shipment_status,
  s.tracking_number,
  d.created_at
FROM arb.dhl_decision_events d
LEFT JOIN arb.shipments s ON s.id = d.shipment_id;

CREATE OR REPLACE VIEW arb.v_dhl_learning_dashboard AS
SELECT
  service,
  origin_country_code,
  origin_postal_code,
  destination_country_code,
  destination_postal_code,
  shipment_count,
  on_time_rate,
  delay_rate,
  loss_rate,
  return_rate,
  claim_rate,
  risk_score,
  recommendation_score,
  metric_date,
  updated_at
FROM arb.dhl_lane_learning_metrics;

INSERT INTO arb.shipping_carriers (
  carrier_code, carrier_name, enabled, sandbox_enabled, domestic_supported, international_supported,
  label_supported, tracking_supported, insurance_supported, signature_supported, api_health_status, priority_rank
)
VALUES
  ('DHL','DHL Group / DHL eCommerce / DHL Freight',false,true,true,true,true,true,true,true,'UNKNOWN',40)
ON CONFLICT (carrier_code) DO UPDATE SET
  sandbox_enabled = true,
  tracking_supported = true,
  updated_at = now();

INSERT INTO arb.process_registry (process_name, phase_no, process_group, description, owner_team, active_flag)
VALUES
  ('domain3.shipping.dhl.tracking_unified',3,'shipping_dhl','DHL Unified Shipment Tracking API.', 'TCDS', true),
  ('domain3.shipping.dhl.webhook_create',3,'shipping_dhl','DHL eCommerce Americas create tracking webhook subscription.', 'TCDS', true),
  ('domain3.shipping.dhl.webhook_list',3,'shipping_dhl','DHL eCommerce Americas list tracking webhook subscriptions.', 'TCDS', true),
  ('domain3.shipping.dhl.webhook_get',3,'shipping_dhl','DHL eCommerce Americas get webhook subscription.', 'TCDS', true),
  ('domain3.shipping.dhl.webhook_update',3,'shipping_dhl','DHL eCommerce Americas update webhook subscription.', 'TCDS', true),
  ('domain3.shipping.dhl.webhook_delete',3,'shipping_dhl','DHL eCommerce Americas delete webhook subscription.', 'TCDS', true),
  ('domain3.shipping.dhl.webhook_ingest',3,'shipping_dhl','DHL tracking webhook callback ingest.', 'TCDS', true),
  ('domain3.shipping.dhl.return_label_create',3,'shipping_dhl','DHL eCommerce Americas return label creation.', 'TCDS', true),
  ('domain3.shipping.dhl.return_label_get',3,'shipping_dhl','DHL eCommerce Americas return label retrieval.', 'TCDS', true),
  ('domain3.shipping.dhl.location_find_by_address',3,'shipping_dhl','DHL Location Finder by address.', 'TCDS', true),
  ('domain3.shipping.dhl.location_find_by_geo',3,'shipping_dhl','DHL Location Finder by geo.', 'TCDS', true),
  ('domain3.shipping.dhl.location_get',3,'shipping_dhl','DHL Location Finder get location.', 'TCDS', true),
  ('domain3.shipping.dhl.freight_price_quote',3,'shipping_dhl','DHL Freight Price Quote.', 'TCDS', true),
  ('domain3.shipping.dhl.freight_booking',3,'shipping_dhl','DHL Freight Shipment Booking.', 'TCDS', true),
  ('domain3.shipping.dhl.lane_learning',3,'shipping_dhl_intelligence','DHL lane learning metrics.', 'TCDS', true),
  ('domain3.shipping.dhl.decision_event',3,'shipping_dhl_intelligence','DHL decision event.', 'TCDS', true),
  ('domain3.shipping.dhl.api_error_classification',3,'shipping_dhl_intelligence','DHL error classification.', 'TCDS', true)
ON CONFLICT (process_name) DO UPDATE SET
  description = EXCLUDED.description,
  active_flag = EXCLUDED.active_flag,
  updated_at = now();

COMMIT;
