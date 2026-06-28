BEGIN;
CREATE SCHEMA IF NOT EXISTS arb;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS arb.usps_oauth_token_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  environment text NOT NULL DEFAULT 'production' CHECK (environment IN ('sandbox','production')),
  grant_type text NOT NULL CHECK (grant_type IN ('client_credentials','refresh_token','authorization_code')),
  client_id_hash text, token_status text, token_type text, scope text, issuer text,
  api_products text, application_name text, issued_at_ms bigint, expires_in_seconds integer,
  expires_at timestamptz, public_key_present boolean NOT NULL DEFAULT false,
  request_hash text CHECK (request_hash IS NULL OR length(request_hash) >= 32),
  response_hash text CHECK (response_hash IS NULL OR length(response_hash) >= 32),
  success boolean NOT NULL DEFAULT false, error_code text, error_description text,
  response_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(response_json)='object'),
  process_run_id uuid REFERENCES arb.process_runs(run_id), created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS arb.usps_oauth_revoke_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  environment text NOT NULL DEFAULT 'production' CHECK (environment IN ('sandbox','production')),
  token_type_hint text NOT NULL DEFAULT 'refresh_token',
  token_hash text NOT NULL CHECK (length(token_hash) >= 32),
  success boolean NOT NULL DEFAULT false, status_code integer, error_code text, error_description text,
  response_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(response_json)='object'),
  process_run_id uuid REFERENCES arb.process_runs(run_id), created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS arb.address_validation_results (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  provider_code text NOT NULL CHECK (provider_code IN ('USPS','SHIPENGINE','FEDEX','UPS','DHL')),
  shipment_id bigint REFERENCES arb.shipments(id), ebay_order_fk bigint REFERENCES arb.ebay_order(id),
  input_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(input_json)='object'),
  standardized_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(standardized_json)='object'),
  valid boolean NOT NULL DEFAULT false, deliverable boolean NOT NULL DEFAULT false,
  dpv_confirmation text, carrier_route text, business boolean, vacant boolean,
  warnings_json jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(warnings_json)='array'),
  raw_response_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(raw_response_json)='object'),
  process_run_id uuid REFERENCES arb.process_runs(run_id), created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS arb.usps_rate_quote_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  shipment_id bigint REFERENCES arb.shipments(id), shipment_quote_id bigint REFERENCES arb.shipment_quotes(id),
  ebay_order_fk bigint REFERENCES arb.ebay_order(id), source_listing_normalized_id bigint REFERENCES arb.listing_normalized(id),
  quote_type text NOT NULL CHECK (quote_type IN ('BASE_RATE','BASE_RATE_LIST','EXTRA_SERVICE_RATE','TOTAL_RATE','LETTER_RATE')),
  origin_zip_code text NOT NULL, destination_zip_code text, mail_class text, mail_classes text[],
  processing_category text, rate_indicator text, price_type text, weight_lb numeric, weight_oz numeric,
  length_in numeric, width_in numeric, height_in numeric, item_value_usd numeric, extra_services integer[],
  total_base_price_usd numeric, total_price_usd numeric, cheapest_price_usd numeric, selected boolean NOT NULL DEFAULT false,
  request_hash text NOT NULL CHECK (length(request_hash) >= 32), response_hash text NOT NULL CHECK (length(response_hash) >= 32),
  request_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(request_json)='object'),
  response_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(response_json)='object'),
  warnings_json jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(warnings_json)='array'),
  process_run_id uuid REFERENCES arb.process_runs(run_id), created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS arb.usps_shipping_option_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  shipment_id bigint REFERENCES arb.shipments(id), shipment_quote_id bigint REFERENCES arb.shipment_quotes(id),
  ebay_order_fk bigint REFERENCES arb.ebay_order(id), source_listing_normalized_id bigint REFERENCES arb.listing_normalized(id),
  origin_zip_code text NOT NULL, destination_zip_code text NOT NULL,
  destination_entry_facility_type text NOT NULL DEFAULT 'NONE',
  shipping_filter text CHECK (shipping_filter IS NULL OR shipping_filter IN ('PRICE','SERVICE_STANDARDS')),
  mail_classes text[], price_types text[], weight_lb numeric, length_in numeric, width_in numeric, height_in numeric,
  item_value_usd numeric, option_count integer NOT NULL DEFAULT 0, cheapest_price_usd numeric,
  fastest_commitment_days integer, selected_mail_class text, selected_price_usd numeric,
  request_hash text NOT NULL CHECK (length(request_hash) >= 32), response_hash text NOT NULL CHECK (length(response_hash) >= 32),
  request_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(request_json)='object'),
  response_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(response_json)='object'),
  normalized_options_json jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(normalized_options_json)='array'),
  warnings_json jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(warnings_json)='array'),
  selected boolean NOT NULL DEFAULT false, process_run_id uuid REFERENCES arb.process_runs(run_id), created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS arb.usps_tracking_requests (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  shipment_id bigint REFERENCES arb.shipments(id), ebay_order_fk bigint REFERENCES arb.ebay_order(id),
  request_type text NOT NULL CHECK (request_type IN ('TRACKING_LOOKUP','NOTIFICATION_REGISTER','PROOF_OF_DELIVERY')),
  tracking_number text NOT NULL, unique_tracking_id text, mailing_date date, destination_zip_code text, include_veripoint boolean,
  request_hash text NOT NULL CHECK (length(request_hash) >= 32), response_hash text CHECK (response_hash IS NULL OR length(response_hash) >= 32),
  request_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(request_json)='object'),
  response_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(response_json)='object'),
  success boolean NOT NULL DEFAULT false, status_code integer, error_message text,
  process_run_id uuid REFERENCES arb.process_runs(run_id), created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS arb.usps_tracking_snapshots (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  shipment_id bigint REFERENCES arb.shipments(id), ebay_order_fk bigint REFERENCES arb.ebay_order(id),
  tracking_number text NOT NULL, unique_tracking_id text, associated_tracking_number text,
  status text, status_category text, status_summary text, mail_class text, mail_class_code text,
  service_type_code text, mail_type text, origin_city text, origin_state text, origin_zip_code text,
  origin_country text, destination_city text, destination_state text, destination_zip_code text,
  destination_country text, mailing_date date, delivery_expected_at timestamptz, delivered_at timestamptz,
  access_control text, kahala_indicator boolean,
  services_json jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(services_json)='array'),
  delivery_date_expectation_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(delivery_date_expectation_json)='object'),
  services_eligibility_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(services_eligibility_json)='object'),
  raw_response_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(raw_response_json)='object'),
  snapshot_hash text NOT NULL CHECK (length(snapshot_hash) >= 32),
  process_run_id uuid REFERENCES arb.process_runs(run_id), created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS arb.usps_tracking_event_details (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  usps_tracking_snapshot_id bigint REFERENCES arb.usps_tracking_snapshots(id) ON DELETE CASCADE,
  shipment_id bigint REFERENCES arb.shipments(id), tracking_number text NOT NULL,
  event_code text, event_type text, event_description text, event_city text, event_state text,
  event_zip_code text, event_country text, event_time timestamptz, event_timezone text, event_category text,
  raw_event_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(raw_event_json)='object'),
  event_hash text NOT NULL CHECK (length(event_hash) >= 32), created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS arb.usps_tracking_notification_requests (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  shipment_id bigint REFERENCES arb.shipments(id), ebay_order_fk bigint REFERENCES arb.ebay_order(id),
  tracking_number text NOT NULL, unique_tracking_id text NOT NULL, mailing_date date,
  notify_event_types text[] NOT NULL, recipients_json jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(recipients_json)='array'),
  transaction_message text, request_hash text NOT NULL CHECK (length(request_hash) >= 32),
  response_hash text CHECK (response_hash IS NULL OR length(response_hash) >= 32),
  request_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(request_json)='object'),
  response_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(response_json)='object'),
  success boolean NOT NULL DEFAULT false, process_run_id uuid REFERENCES arb.process_runs(run_id), created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS arb.usps_proof_of_delivery_requests (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  shipment_id bigint REFERENCES arb.shipments(id), ebay_order_fk bigint REFERENCES arb.ebay_order(id),
  tracking_number text NOT NULL, unique_tracking_id text NOT NULL, mailing_date date,
  letter_type text NOT NULL DEFAULT 'PROOF_OF_DELIVERY' CHECK (letter_type IN ('PROOF_OF_DELIVERY','RETURN_RECEIPT_ELECTRONIC')),
  crid text, recipients_json jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(recipients_json)='array'),
  transaction_message text, request_hash text NOT NULL CHECK (length(request_hash) >= 32),
  response_hash text CHECK (response_hash IS NULL OR length(response_hash) >= 32),
  request_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(request_json)='object'),
  response_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(response_json)='object'),
  success boolean NOT NULL DEFAULT false, process_run_id uuid REFERENCES arb.process_runs(run_id), created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS arb.usps_raw_event_ingest (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_source text NOT NULL DEFAULT 'USPS', event_type text, tracking_number text, shipment_id bigint REFERENCES arb.shipments(id),
  headers_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(headers_json)='object'),
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(raw_payload)='object'),
  payload_hash text NOT NULL CHECK (length(payload_hash) >= 32),
  processing_status text NOT NULL DEFAULT 'RECEIVED' CHECK (processing_status IN ('RECEIVED','DUPLICATE','PROCESSED','FAILED','DEAD_LETTER')),
  error_message text, process_run_id uuid REFERENCES arb.process_runs(run_id), received_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_source, payload_hash)
);

CREATE TABLE IF NOT EXISTS arb.usps_lane_learning_metrics (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  metric_date date NOT NULL DEFAULT current_date, origin_zip_code text, destination_zip_code text,
  origin_region text, destination_region text, mail_class text, package_class text, category_key text,
  shipment_count integer NOT NULL DEFAULT 0, avg_quoted_price_usd numeric, avg_actual_price_usd numeric,
  avg_delivery_days numeric, on_time_rate numeric CHECK (on_time_rate IS NULL OR on_time_rate BETWEEN 0 AND 1),
  delay_rate numeric CHECK (delay_rate IS NULL OR delay_rate BETWEEN 0 AND 1),
  loss_rate numeric CHECK (loss_rate IS NULL OR loss_rate BETWEEN 0 AND 1),
  damage_rate numeric CHECK (damage_rate IS NULL OR damage_rate BETWEEN 0 AND 1),
  return_rate numeric CHECK (return_rate IS NULL OR return_rate BETWEEN 0 AND 1),
  claim_rate numeric CHECK (claim_rate IS NULL OR claim_rate BETWEEN 0 AND 1),
  claim_success_rate numeric CHECK (claim_success_rate IS NULL OR claim_success_rate BETWEEN 0 AND 1),
  avg_profit_leakage_usd numeric, risk_score numeric CHECK (risk_score IS NULL OR risk_score BETWEEN 0 AND 100),
  recommendation_score numeric CHECK (recommendation_score IS NULL OR recommendation_score BETWEEN 0 AND 100),
  updated_from_process_run_id uuid REFERENCES arb.process_runs(run_id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(metric_date, origin_zip_code, destination_zip_code, mail_class, package_class, category_key)
);

CREATE TABLE IF NOT EXISTS arb.usps_hub_risk_metrics (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  metric_date date NOT NULL DEFAULT current_date, hub_key text NOT NULL, hub_city text, hub_state text, hub_zip_code text,
  scan_count integer NOT NULL DEFAULT 0, avg_scan_delay_hours numeric, exception_count integer NOT NULL DEFAULT 0,
  lost_count integer NOT NULL DEFAULT 0, return_count integer NOT NULL DEFAULT 0, damage_count integer NOT NULL DEFAULT 0,
  risk_score numeric CHECK (risk_score IS NULL OR risk_score BETWEEN 0 AND 100),
  risk_reasons_json jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(risk_reasons_json)='array'),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(metric_date, hub_key)
);

CREATE TABLE IF NOT EXISTS arb.usps_package_risk_profiles (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  category_key text, brand text, package_class text, weight_band text, dimension_band text, fragile boolean NOT NULL DEFAULT false,
  sample_count integer NOT NULL DEFAULT 0, damage_rate numeric CHECK (damage_rate IS NULL OR damage_rate BETWEEN 0 AND 1),
  dim_adjustment_rate numeric CHECK (dim_adjustment_rate IS NULL OR dim_adjustment_rate BETWEEN 0 AND 1),
  return_rate numeric CHECK (return_rate IS NULL OR return_rate BETWEEN 0 AND 1),
  recommended_packaging_code text, recommended_mail_class text, insurance_recommended boolean NOT NULL DEFAULT false,
  signature_recommended boolean NOT NULL DEFAULT false, risk_score numeric CHECK (risk_score IS NULL OR risk_score BETWEEN 0 AND 100),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(category_key, brand, package_class, weight_band, dimension_band)
);

CREATE TABLE IF NOT EXISTS arb.usps_decision_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  shipment_id bigint REFERENCES arb.shipments(id), ebay_order_fk bigint REFERENCES arb.ebay_order(id),
  source_listing_normalized_id bigint REFERENCES arb.listing_normalized(id),
  decision_type text NOT NULL CHECK (decision_type IN ('RATE_SELECTION','INSURANCE','SIGNATURE','PACKAGING','TRACKING_RISK','CLAIM','DISPUTE','REVIEW_ROUTE')),
  selected_mail_class text, selected_price_usd numeric, cheapest_price_usd numeric, safest_mail_class text, fastest_mail_class text,
  risk_score numeric CHECK (risk_score IS NULL OR risk_score BETWEEN 0 AND 100),
  profit_score numeric CHECK (profit_score IS NULL OR profit_score BETWEEN 0 AND 100),
  confidence_score numeric CHECK (confidence_score IS NULL OR confidence_score BETWEEN 0 AND 100),
  decision_reason text, input_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(input_json)='object'),
  output_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(output_json)='object'),
  ai_used boolean NOT NULL DEFAULT false, human_review_required boolean NOT NULL DEFAULT false,
  process_run_id uuid REFERENCES arb.process_runs(run_id), created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS arb.usps_claim_readiness_scores (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  shipment_id bigint REFERENCES arb.shipments(id), tracking_number text, score numeric NOT NULL CHECK (score BETWEEN 0 AND 100),
  purchase_receipt_present boolean NOT NULL DEFAULT false, listing_snapshot_present boolean NOT NULL DEFAULT false,
  receiving_photos_present boolean NOT NULL DEFAULT false, packaging_photos_present boolean NOT NULL DEFAULT false,
  label_artifact_present boolean NOT NULL DEFAULT false, tracking_history_present boolean NOT NULL DEFAULT false,
  proof_of_delivery_requested boolean NOT NULL DEFAULT false,
  missing_evidence_json jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(missing_evidence_json)='array'),
  claim_recommendation text CHECK (claim_recommendation IS NULL OR claim_recommendation IN ('NO_CLAIM','BUILD_PACKET','READY_TO_SUBMIT','HUMAN_REVIEW','EXECUTIVE_REVIEW')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS arb.usps_api_drift_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  api_area text NOT NULL, endpoint_path text,
  drift_type text NOT NULL CHECK (drift_type IN ('SCHEMA_CHANGE','MISSING_FIELD','NEW_FIELD','TYPE_CHANGE','AUTH_CHANGE','STATUS_CHANGE','RATE_LIMIT_CHANGE','UNKNOWN')),
  severity text NOT NULL DEFAULT 'MEDIUM' CHECK (severity IN ('LOW','MEDIUM','HIGH','CRITICAL')),
  expected_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(expected_json)='object'),
  observed_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(observed_json)='object'),
  action_taken text, resolved boolean NOT NULL DEFAULT false, resolved_at timestamptz,
  process_run_id uuid REFERENCES arb.process_runs(run_id), detected_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS arb.usps_ai_review_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  shipment_id bigint REFERENCES arb.shipments(id),
  review_type text NOT NULL CHECK (review_type IN ('RATE_DECISION','CLAIM_DECISION','DISPUTE_PACKET','DELIVERY_RISK','PACKAGING_RISK','INSURANCE_POLICY')),
  model_name text, input_hash text NOT NULL CHECK (length(input_hash) >= 32), output_hash text NOT NULL CHECK (length(output_hash) >= 32),
  prompt_tokens integer, completion_tokens integer, cost_usd numeric NOT NULL DEFAULT 0 CHECK (cost_usd >= 0),
  recommendation text, confidence_score numeric CHECK (confidence_score IS NULL OR confidence_score BETWEEN 0 AND 100),
  human_override boolean NOT NULL DEFAULT false, output_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(output_json)='object'),
  process_run_id uuid REFERENCES arb.process_runs(run_id), created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_usps_oauth_token_events_created ON arb.usps_oauth_token_events(environment, success, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_address_validation_results_shipment ON arb.address_validation_results(shipment_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_usps_rate_quote_events_shipment ON arb.usps_rate_quote_events(shipment_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_usps_shipping_option_events_lane ON arb.usps_shipping_option_events(origin_zip_code, destination_zip_code, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_usps_tracking_snapshots_tracking_created ON arb.usps_tracking_snapshots(tracking_number, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_usps_tracking_events_tracking_time ON arb.usps_tracking_event_details(tracking_number, event_time DESC);
CREATE INDEX IF NOT EXISTS idx_usps_raw_event_ingest_status ON arb.usps_raw_event_ingest(processing_status, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_usps_lane_learning_lookup ON arb.usps_lane_learning_metrics(origin_zip_code, destination_zip_code, mail_class, metric_date DESC);
CREATE INDEX IF NOT EXISTS idx_usps_hub_risk_lookup ON arb.usps_hub_risk_metrics(hub_key, metric_date DESC);
CREATE INDEX IF NOT EXISTS idx_usps_package_risk_lookup ON arb.usps_package_risk_profiles(category_key, brand, package_class);
CREATE INDEX IF NOT EXISTS idx_usps_decision_events_shipment ON arb.usps_decision_events(shipment_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_usps_claim_readiness_shipment ON arb.usps_claim_readiness_scores(shipment_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_usps_api_drift_open ON arb.usps_api_drift_events(resolved, severity, detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_usps_ai_review_events_shipment ON arb.usps_ai_review_events(shipment_id, created_at DESC);

CREATE OR REPLACE VIEW arb.v_usps_oauth_latest AS SELECT DISTINCT ON (environment) * FROM arb.usps_oauth_token_events ORDER BY environment, created_at DESC, id DESC;
CREATE OR REPLACE VIEW arb.v_address_validation_latest AS SELECT DISTINCT ON (shipment_id, ebay_order_fk, provider_code) * FROM arb.address_validation_results ORDER BY shipment_id, ebay_order_fk, provider_code, created_at DESC, id DESC;
CREATE OR REPLACE VIEW arb.v_usps_rate_quote_latest AS SELECT DISTINCT ON (shipment_id, quote_type, mail_class, price_type) * FROM arb.usps_rate_quote_events ORDER BY shipment_id, quote_type, mail_class, price_type, created_at DESC, id DESC;
CREATE OR REPLACE VIEW arb.v_usps_shipping_options_latest AS SELECT DISTINCT ON (shipment_id, origin_zip_code, destination_zip_code, shipping_filter) * FROM arb.usps_shipping_option_events ORDER BY shipment_id, origin_zip_code, destination_zip_code, shipping_filter, created_at DESC, id DESC;
CREATE OR REPLACE VIEW arb.v_usps_tracking_latest AS SELECT DISTINCT ON (tracking_number) * FROM arb.usps_tracking_snapshots ORDER BY tracking_number, created_at DESC, id DESC;

CREATE OR REPLACE VIEW arb.v_usps_profit_protection_dashboard AS
SELECT d.shipment_id, d.ebay_order_fk, d.decision_type, d.selected_mail_class, d.selected_price_usd, d.cheapest_price_usd,
       d.risk_score, d.profit_score, d.confidence_score, d.human_review_required, crs.score AS claim_readiness_score,
       crs.claim_recommendation, s.shipment_status, s.tracking_number, d.created_at
FROM arb.usps_decision_events d
LEFT JOIN arb.usps_claim_readiness_scores crs ON crs.shipment_id = d.shipment_id
LEFT JOIN arb.shipments s ON s.id = d.shipment_id;

CREATE OR REPLACE VIEW arb.v_usps_learning_dashboard AS
SELECT 'LANE' AS learning_type, origin_zip_code AS key_1, destination_zip_code AS key_2, mail_class AS key_3,
       shipment_count, risk_score, recommendation_score, metric_date, updated_at
FROM arb.usps_lane_learning_metrics
UNION ALL
SELECT 'HUB', hub_key, hub_city, hub_state, scan_count, risk_score, NULL::numeric, metric_date, updated_at
FROM arb.usps_hub_risk_metrics;

CREATE OR REPLACE FUNCTION arb.usps_score_rate_option(p_price numeric, p_cheapest_price numeric, p_risk_score numeric, p_delivery_days numeric)
RETURNS numeric LANGUAGE sql IMMUTABLE AS $$
  SELECT GREATEST(0, LEAST(100, 100 - COALESCE(p_risk_score,50)*0.45
    - CASE WHEN COALESCE(p_cheapest_price,0)>0 THEN ((COALESCE(p_price,p_cheapest_price)-p_cheapest_price)/p_cheapest_price)*35 ELSE 0 END
    - COALESCE(p_delivery_days,3)*2));
$$;

CREATE OR REPLACE FUNCTION arb.usps_claim_readiness_band(p_score numeric)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN p_score >= 90 THEN 'READY_TO_SUBMIT' WHEN p_score >= 75 THEN 'BUILD_PACKET'
              WHEN p_score >= 50 THEN 'HUMAN_REVIEW' ELSE 'EXECUTIVE_REVIEW' END;
$$;

CREATE OR REPLACE FUNCTION arb.usps_delivery_exception_code(p_status text, p_status_category text, p_status_summary text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN upper(coalesce(p_status_category,'') || ' ' || coalesce(p_status_summary,'') || ' ' || coalesce(p_status,'')) LIKE '%DELIVERED%' THEN 'DELIVERED'
    WHEN upper(coalesce(p_status_summary,'')) LIKE '%AVAILABLE FOR PICKUP%' THEN 'PICKUP_REQUIRED'
    WHEN upper(coalesce(p_status_summary,'')) LIKE '%NOTICE LEFT%' THEN 'NOTICE_LEFT'
    WHEN upper(coalesce(p_status_summary,'')) LIKE '%FORWARDED%' THEN 'FORWARDED'
    WHEN upper(coalesce(p_status_summary,'')) LIKE '%RETURN%' THEN 'RETURN'
    WHEN upper(coalesce(p_status_summary,'')) LIKE '%EXCEPTION%' THEN 'EXCEPTION'
    WHEN upper(coalesce(p_status_summary,'')) LIKE '%DELAY%' THEN 'DELAYED'
    ELSE 'NORMAL' END;
$$;

-- Moved below the function definitions above (view depends on usps_delivery_exception_code)
CREATE OR REPLACE VIEW arb.v_usps_tracking_delivery_exceptions AS
SELECT s.*, arb.usps_delivery_exception_code(s.status, s.status_category, s.status_summary) AS tcds_exception_code
FROM arb.usps_tracking_snapshots s;

INSERT INTO arb.shipping_carriers (carrier_code, carrier_name, enabled, sandbox_enabled, domestic_supported, international_supported,
  label_supported, tracking_supported, insurance_supported, signature_supported, api_health_status, priority_rank)
VALUES ('USPS','United States Postal Service',true,true,true,true,true,true,true,true,'UNKNOWN',20)
ON CONFLICT (carrier_code) DO UPDATE SET enabled=true, tracking_supported=true, insurance_supported=true, signature_supported=true, updated_at=now();

INSERT INTO arb.process_registry (process_name, phase_no, process_group, description, owner_team, active_flag)
VALUES
('domain3.shipping.usps.oauth_token',3,'shipping_usps','USPS OAuth v3 token generation.','TCDS',true),
('domain3.shipping.usps.oauth_revoke',3,'shipping_usps','USPS OAuth v3 token revoke.','TCDS',true),
('domain3.shipping.usps.address_standardize',3,'shipping_usps','USPS address standardization.','TCDS',true),
('domain3.shipping.usps.city_state_lookup',3,'shipping_usps','USPS City/State lookup.','TCDS',true),
('domain3.shipping.usps.zipcode_lookup',3,'shipping_usps','USPS ZIP+4 lookup.','TCDS',true),
('domain3.shipping.usps.base_rate_search',3,'shipping_usps','USPS base rates.','TCDS',true),
('domain3.shipping.usps.base_rate_list_search',3,'shipping_usps','USPS base rate list.','TCDS',true),
('domain3.shipping.usps.extra_service_rate_search',3,'shipping_usps','USPS extra services.','TCDS',true),
('domain3.shipping.usps.total_rate_search',3,'shipping_usps','USPS total rates.','TCDS',true),
('domain3.shipping.usps.letter_rate_search',3,'shipping_usps','USPS letter rates.','TCDS',true),
('domain3.shipping.usps.shipping_options_search',3,'shipping_usps','USPS shipping options.','TCDS',true),
('domain3.shipping.usps.tracking_lookup',3,'shipping_usps','USPS tracking lookup.','TCDS',true),
('domain3.shipping.usps.tracking_notification_register',3,'shipping_usps','USPS tracking notifications.','TCDS',true),
('domain3.shipping.usps.proof_of_delivery_request',3,'shipping_usps','USPS proof of delivery.','TCDS',true),
('domain3.shipping.usps.raw_event_ingest',3,'shipping_usps','USPS raw event ingest.','TCDS',true),
('domain3.shipping.usps.lane_learning_update',3,'shipping_usps_intelligence','USPS lane learning.','TCDS',true),
('domain3.shipping.usps.hub_risk_update',3,'shipping_usps_intelligence','USPS hub risk learning.','TCDS',true),
('domain3.shipping.usps.package_risk_update',3,'shipping_usps_intelligence','USPS package risk learning.','TCDS',true),
('domain3.shipping.usps.decision_event',3,'shipping_usps_intelligence','USPS decision event.','TCDS',true),
('domain3.shipping.usps.claim_readiness_score',3,'shipping_usps_intelligence','USPS claim readiness.','TCDS',true),
('domain3.shipping.usps.api_drift_detect',3,'shipping_usps_intelligence','USPS API drift detect.','TCDS',true),
('domain3.shipping.usps.ai_review',3,'shipping_usps_intelligence','USPS AI review memory.','TCDS',true)
ON CONFLICT (process_name) DO UPDATE SET description=EXCLUDED.description, active_flag=EXCLUDED.active_flag, updated_at=now();

COMMIT;
