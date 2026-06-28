BEGIN;

CREATE SCHEMA IF NOT EXISTS arb;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS arb.shipengine_api_key_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  environment text NOT NULL DEFAULT 'production' CHECK (environment IN ('sandbox','test','production')),
  api_key_hash text CHECK (api_key_hash IS NULL OR length(api_key_hash) >= 32),
  success boolean NOT NULL DEFAULT false,
  response_status integer,
  response_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(response_json)='object'),
  process_run_id uuid REFERENCES arb.process_runs(run_id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS arb.shipengine_api_error_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  endpoint_path text,
  http_status integer,
  request_id text,
  error_source text,
  error_type text,
  error_code text,
  error_message text,
  severity text CHECK (severity IS NULL OR severity IN ('TRANSIENT','HARD','UNKNOWN')),
  retryable boolean NOT NULL DEFAULT false,
  request_hash text CHECK (request_hash IS NULL OR length(request_hash) >= 32),
  response_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(response_json)='object'),
  process_run_id uuid REFERENCES arb.process_runs(run_id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS arb.shipengine_carrier_account_snapshots (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  carrier_id text NOT NULL,
  carrier_code text,
  account_number_hash text,
  nickname text,
  friendly_name text,
  primary_account boolean,
  connection_status text,
  balance_amount numeric,
  balance_currency text,
  requires_funded_amount boolean,
  supports_returns boolean,
  supports_label_messages boolean,
  services_json jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(services_json)='array'),
  packages_json jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(packages_json)='array'),
  options_json jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(options_json)='array'),
  raw_response_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(raw_response_json)='object'),
  snapshot_hash text NOT NULL CHECK (length(snapshot_hash) >= 32),
  process_run_id uuid REFERENCES arb.process_runs(run_id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS arb.shipengine_address_validation_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  shipment_id bigint REFERENCES arb.shipments(id),
  ebay_order_fk bigint REFERENCES arb.ebay_order(id),
  validation_status text,
  address_type text,
  address_residential_indicator text,
  original_address_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(original_address_json)='object'),
  matched_address_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(matched_address_json)='object'),
  messages_json jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(messages_json)='array'),
  request_hash text NOT NULL CHECK (length(request_hash) >= 32),
  response_hash text NOT NULL CHECK (length(response_hash) >= 32),
  request_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(request_json)='object'),
  response_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(response_json)='object'),
  process_run_id uuid REFERENCES arb.process_runs(run_id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS arb.shipengine_recognition_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  recognition_type text NOT NULL CHECK (recognition_type IN ('ADDRESS','SHIPMENT')),
  score numeric CHECK (score IS NULL OR score BETWEEN 0 AND 1),
  parsed_address_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(parsed_address_json)='object'),
  parsed_shipment_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(parsed_shipment_json)='object'),
  entities_json jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(entities_json)='array'),
  source_text_hash text NOT NULL CHECK (length(source_text_hash) >= 32),
  request_hash text NOT NULL CHECK (length(request_hash) >= 32),
  response_hash text NOT NULL CHECK (length(response_hash) >= 32),
  request_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(request_json)='object'),
  response_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(response_json)='object'),
  process_run_id uuid REFERENCES arb.process_runs(run_id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS arb.shipengine_shipment_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  shipment_id bigint REFERENCES arb.shipments(id),
  ebay_order_fk bigint REFERENCES arb.ebay_order(id),
  shipengine_shipment_id text,
  external_shipment_id text,
  external_order_id text,
  carrier_id text,
  carrier_code text,
  service_code text,
  shipment_status text,
  ship_date timestamptz,
  ship_to_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(ship_to_json)='object'),
  ship_from_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(ship_from_json)='object'),
  packages_json jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(packages_json)='array'),
  total_weight_value numeric,
  total_weight_unit text,
  response_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(response_json)='object'),
  response_hash text NOT NULL CHECK (length(response_hash) >= 32),
  process_run_id uuid REFERENCES arb.process_runs(run_id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS arb.shipengine_rate_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  shipment_id bigint REFERENCES arb.shipments(id),
  ebay_order_fk bigint REFERENCES arb.ebay_order(id),
  shipengine_shipment_id text,
  rate_request_id text,
  rate_id text,
  carrier_id text,
  carrier_code text,
  carrier_friendly_name text,
  service_code text,
  service_type text,
  rate_type text,
  package_type text,
  delivery_days integer,
  estimated_delivery_date timestamptz,
  guaranteed_service boolean,
  trackable boolean,
  validation_status text,
  shipping_amount numeric,
  shipping_currency text,
  insurance_amount numeric,
  confirmation_amount numeric,
  tax_amount numeric,
  other_amount numeric,
  warning_messages_json jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(warning_messages_json)='array'),
  error_messages_json jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(error_messages_json)='array'),
  raw_rate_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(raw_rate_json)='object'),
  request_hash text NOT NULL CHECK (length(request_hash) >= 32),
  response_hash text NOT NULL CHECK (length(response_hash) >= 32),
  request_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(request_json)='object'),
  response_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(response_json)='object'),
  process_run_id uuid REFERENCES arb.process_runs(run_id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS arb.shipengine_label_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  shipment_id bigint REFERENCES arb.shipments(id),
  ebay_order_fk bigint REFERENCES arb.ebay_order(id),
  label_id text NOT NULL,
  shipengine_shipment_id text,
  external_shipment_id text,
  external_order_id text,
  status text,
  carrier_id text,
  carrier_code text,
  service_code text,
  package_code text,
  tracking_number text,
  tracking_status text,
  tracking_url text,
  label_format text,
  label_layout text,
  label_download_url text,
  form_download_url text,
  qr_code_download_url text,
  insurance_claim_url text,
  is_return_label boolean NOT NULL DEFAULT false,
  rma_number text,
  voided boolean,
  voided_at timestamptz,
  refund_status text,
  shipment_cost_amount numeric,
  shipment_cost_currency text,
  insurance_cost_amount numeric,
  insurance_cost_currency text,
  raw_response_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(raw_response_json)='object'),
  label_hash text NOT NULL CHECK (length(label_hash) >= 32),
  process_run_id uuid REFERENCES arb.process_runs(run_id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS arb.shipengine_tracking_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  shipment_id bigint REFERENCES arb.shipments(id),
  label_id text,
  carrier_code text,
  carrier_id text,
  tracking_number text NOT NULL,
  tracking_url text,
  status_code text,
  status_detail_code text,
  status_description text,
  status_detail_description text,
  carrier_status_code text,
  carrier_detail_code text,
  carrier_status_description text,
  ship_date timestamptz,
  estimated_delivery_date timestamptz,
  actual_delivery_date timestamptz,
  exception_description text,
  events_json jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(events_json)='array'),
  raw_response_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(raw_response_json)='object'),
  tracking_hash text NOT NULL CHECK (length(tracking_hash) >= 32),
  process_run_id uuid REFERENCES arb.process_runs(run_id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS arb.shipengine_webhook_subscriptions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  webhook_id text UNIQUE,
  event text NOT NULL CHECK (event IN ('batch','carrier_connected','order_source_refresh_complete','rate','report_complete','sales_orders_imported','track')),
  url text NOT NULL,
  name text,
  store_id integer,
  headers_hash text CHECK (headers_hash IS NULL OR length(headers_hash) >= 32),
  request_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(request_json)='object'),
  response_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(response_json)='object'),
  request_hash text NOT NULL CHECK (length(request_hash) >= 32),
  response_hash text CHECK (response_hash IS NULL OR length(response_hash) >= 32),
  active boolean NOT NULL DEFAULT true,
  process_run_id uuid REFERENCES arb.process_runs(run_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS arb.shipengine_webhook_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  webhook_id text,
  event text,
  resource_url text,
  label_id text,
  tracking_number text,
  shipment_id bigint REFERENCES arb.shipments(id),
  secret_valid boolean,
  headers_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(headers_json)='object'),
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(raw_payload)='object'),
  payload_hash text NOT NULL CHECK (length(payload_hash) >= 32),
  processing_status text NOT NULL DEFAULT 'RECEIVED' CHECK (processing_status IN ('RECEIVED','DUPLICATE','PROCESSED','FAILED','DEAD_LETTER')),
  process_run_id uuid REFERENCES arb.process_runs(run_id),
  received_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(event, payload_hash)
);

CREATE TABLE IF NOT EXISTS arb.shipengine_pickup_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  pickup_id text,
  carrier_id text,
  warehouse_id text,
  confirmation_number text,
  pickup_status text,
  label_ids_json jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(label_ids_json)='array'),
  pickup_window_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(pickup_window_json)='object'),
  pickup_address_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(pickup_address_json)='object'),
  request_hash text CHECK (request_hash IS NULL OR length(request_hash) >= 32),
  response_hash text NOT NULL CHECK (length(response_hash) >= 32),
  request_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(request_json)='object'),
  response_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(response_json)='object'),
  process_run_id uuid REFERENCES arb.process_runs(run_id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS arb.shipengine_manifest_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  manifest_id text,
  form_id text,
  carrier_id text,
  warehouse_id text,
  submission_id text,
  ship_date timestamptz,
  shipments_count integer,
  manifest_download_url text,
  label_ids_json jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(label_ids_json)='array'),
  request_hash text CHECK (request_hash IS NULL OR length(request_hash) >= 32),
  response_hash text NOT NULL CHECK (length(response_hash) >= 32),
  request_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(request_json)='object'),
  response_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(response_json)='object'),
  process_run_id uuid REFERENCES arb.process_runs(run_id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS arb.shipengine_warehouse_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  warehouse_id text,
  name text,
  is_default boolean,
  origin_address_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(origin_address_json)='object'),
  return_address_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(return_address_json)='object'),
  raw_response_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(raw_response_json)='object'),
  response_hash text NOT NULL CHECK (length(response_hash) >= 32),
  process_run_id uuid REFERENCES arb.process_runs(run_id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS arb.shipengine_service_point_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  carrier_code text,
  country_code text,
  service_point_id text,
  search_lat numeric,
  search_long numeric,
  result_count integer NOT NULL DEFAULT 0,
  request_hash text CHECK (request_hash IS NULL OR length(request_hash) >= 32),
  response_hash text NOT NULL CHECK (length(response_hash) >= 32),
  request_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(request_json)='object'),
  response_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(response_json)='object'),
  process_run_id uuid REFERENCES arb.process_runs(run_id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS arb.shipengine_insurance_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_type text NOT NULL CHECK (event_type IN ('CONNECT','DISCONNECT','ADD_FUNDS','BALANCE','CLAIM_LINK')),
  currency text,
  amount numeric,
  policy_id_hash text CHECK (policy_id_hash IS NULL OR length(policy_id_hash) >= 32),
  response_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(response_json)='object'),
  response_hash text NOT NULL CHECK (length(response_hash) >= 32),
  process_run_id uuid REFERENCES arb.process_runs(run_id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS arb.shipengine_decision_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  shipment_id bigint REFERENCES arb.shipments(id),
  ebay_order_fk bigint REFERENCES arb.ebay_order(id),
  decision_type text NOT NULL CHECK (decision_type IN ('RATE_SELECTION','LABEL_PURCHASE','TRACKING_RISK','RETURN_LABEL','PICKUP','MANIFEST','VOID','CLAIM','DISPUTE','REVIEW_ROUTE')),
  selected_carrier_code text,
  selected_carrier_id text,
  selected_service_code text,
  selected_rate_id text,
  selected_label_id text,
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

CREATE INDEX IF NOT EXISTS idx_shipengine_rate_lookup ON arb.shipengine_rate_events(shipment_id, shipping_amount, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_shipengine_label_lookup ON arb.shipengine_label_events(label_id, tracking_number, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_shipengine_tracking_lookup ON arb.shipengine_tracking_events(tracking_number, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_shipengine_webhook_status ON arb.shipengine_webhook_events(processing_status, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_shipengine_decision_lookup ON arb.shipengine_decision_events(shipment_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_shipengine_address_lookup ON arb.shipengine_address_validation_events(shipment_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_shipengine_carrier_lookup ON arb.shipengine_carrier_account_snapshots(carrier_id, created_at DESC);

CREATE OR REPLACE FUNCTION arb.shipengine_error_severity(p_http_status integer)
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

CREATE OR REPLACE FUNCTION arb.shipengine_tracking_exception_code(p_status_code text, p_detail_code text, p_exception text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN upper(coalesce(p_detail_code,'')) = 'DELIVERED' OR upper(coalesce(p_status_code,'')) = 'DE' THEN 'DELIVERED'
    WHEN coalesce(p_exception,'') <> '' THEN 'EXCEPTION'
    WHEN upper(coalesce(p_status_code,'')) IN ('IT','IN_TRANSIT') THEN 'IN_TRANSIT'
    WHEN upper(coalesce(p_status_code,'')) IN ('AC','ACCEPTED') THEN 'ACCEPTED'
    WHEN upper(coalesce(p_status_code,'')) IN ('NY','UNKNOWN') THEN 'UNKNOWN'
    ELSE 'NORMAL'
  END;
$$;

CREATE OR REPLACE FUNCTION arb.shipengine_score_rate_profit(p_shipping_amount numeric, p_expected_max numeric)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_shipping_amount IS NULL OR p_expected_max IS NULL OR p_expected_max <= 0 THEN 50
    ELSE GREATEST(0, LEAST(100, 100 - ((p_shipping_amount / p_expected_max) * 100)))
  END;
$$;

CREATE OR REPLACE VIEW arb.v_shipengine_latest_labels AS
SELECT DISTINCT ON (label_id)
  *
FROM arb.shipengine_label_events
ORDER BY label_id, created_at DESC, id DESC;

CREATE OR REPLACE VIEW arb.v_shipengine_latest_tracking AS
SELECT DISTINCT ON (tracking_number)
  *,
  arb.shipengine_tracking_exception_code(status_code, status_detail_code, exception_description) AS tcds_exception_code
FROM arb.shipengine_tracking_events
ORDER BY tracking_number, created_at DESC, id DESC;

CREATE OR REPLACE VIEW arb.v_shipengine_best_rates AS
SELECT DISTINCT ON (shipment_id)
  *
FROM arb.shipengine_rate_events
WHERE COALESCE(shipping_amount, 999999999) >= 0
ORDER BY shipment_id, shipping_amount ASC NULLS LAST, delivery_days ASC NULLS LAST, created_at DESC;

CREATE OR REPLACE VIEW arb.v_shipengine_active_webhooks AS
SELECT *
FROM arb.shipengine_webhook_subscriptions
WHERE active = true;

CREATE OR REPLACE VIEW arb.v_shipengine_profit_protection_dashboard AS
SELECT
  d.shipment_id,
  d.ebay_order_fk,
  d.decision_type,
  d.selected_carrier_code,
  d.selected_service_code,
  d.selected_rate_id,
  d.selected_label_id,
  d.selected_price_usd,
  d.risk_score,
  d.profit_score,
  d.confidence_score,
  d.human_review_required,
  d.created_at
FROM arb.shipengine_decision_events d;

INSERT INTO arb.shipping_carriers (
  carrier_code, carrier_name, enabled, sandbox_enabled, domestic_supported, international_supported,
  label_supported, tracking_supported, insurance_supported, signature_supported, api_health_status, priority_rank
)
VALUES
  ('SHIPENGINE','ShipEngine Multi-Carrier Aggregator',true,true,true,true,true,true,true,true,'UNKNOWN',5)
ON CONFLICT (carrier_code) DO UPDATE SET
  enabled = EXCLUDED.enabled,
  sandbox_enabled = EXCLUDED.sandbox_enabled,
  label_supported = true,
  tracking_supported = true,
  updated_at = now();

INSERT INTO arb.process_registry (process_name, phase_no, process_group, description, owner_team, active_flag)
VALUES
  ('domain3.shipping.shipengine.account_settings',3,'shipping_shipengine','ShipEngine account settings.', 'TCDS', true),
  ('domain3.shipping.shipengine.carriers_list',3,'shipping_shipengine','ShipEngine carrier account list.', 'TCDS', true),
  ('domain3.shipping.shipengine.address_recognize',3,'shipping_shipengine','ShipEngine address recognition.', 'TCDS', true),
  ('domain3.shipping.shipengine.address_validate',3,'shipping_shipengine','ShipEngine address validation.', 'TCDS', true),
  ('domain3.shipping.shipengine.shipment_recognize',3,'shipping_shipengine','ShipEngine shipment recognition.', 'TCDS', true),
  ('domain3.shipping.shipengine.shipments_create',3,'shipping_shipengine','ShipEngine shipment creation.', 'TCDS', true),
  ('domain3.shipping.shipengine.rates',3,'shipping_shipengine','ShipEngine rating.', 'TCDS', true),
  ('domain3.shipping.shipengine.rates_estimate',3,'shipping_shipengine','ShipEngine rate estimates.', 'TCDS', true),
  ('domain3.shipping.shipengine.labels_create',3,'shipping_shipengine','ShipEngine label creation.', 'TCDS', true),
  ('domain3.shipping.shipengine.labels_return',3,'shipping_shipengine','ShipEngine return label creation.', 'TCDS', true),
  ('domain3.shipping.shipengine.labels_void',3,'shipping_shipengine','ShipEngine label void/refund.', 'TCDS', true),
  ('domain3.shipping.shipengine.tracking_get',3,'shipping_shipengine','ShipEngine tracking lookup.', 'TCDS', true),
  ('domain3.shipping.shipengine.tracking_start',3,'shipping_shipengine','ShipEngine tracking subscription start.', 'TCDS', true),
  ('domain3.shipping.shipengine.tracking_stop',3,'shipping_shipengine','ShipEngine tracking subscription stop.', 'TCDS', true),
  ('domain3.shipping.shipengine.webhooks',3,'shipping_shipengine','ShipEngine webhook management.', 'TCDS', true),
  ('domain3.shipping.shipengine.webhook_ingest',3,'shipping_shipengine','ShipEngine webhook ingest.', 'TCDS', true),
  ('domain3.shipping.shipengine.pickups',3,'shipping_shipengine','ShipEngine pickup scheduling.', 'TCDS', true),
  ('domain3.shipping.shipengine.manifests',3,'shipping_shipengine','ShipEngine manifest creation.', 'TCDS', true),
  ('domain3.shipping.shipengine.insurance',3,'shipping_shipengine','ShipEngine Shipsurance management.', 'TCDS', true),
  ('domain3.shipping.shipengine.decision_event',3,'shipping_shipengine_intelligence','ShipEngine intelligence decision events.', 'TCDS', true)
ON CONFLICT (process_name) DO UPDATE SET
  description = EXCLUDED.description,
  active_flag = EXCLUDED.active_flag,
  updated_at = now();

COMMIT;
