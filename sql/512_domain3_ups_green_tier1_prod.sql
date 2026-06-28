BEGIN;
CREATE SCHEMA IF NOT EXISTS arb;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS arb.ups_oauth_token_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 environment text NOT NULL DEFAULT 'production' CHECK (environment IN ('cie','production')),
 grant_type text NOT NULL CHECK (grant_type IN ('authorization_code','refresh_token','client_credentials','manual_token')),
 client_id_hash text, token_type text, issued_at_ms bigint, expires_in_seconds integer, expires_at timestamptz,
 refresh_token_status text, refresh_token_issued_at_ms bigint, refresh_token_expires_in_seconds integer,
 refresh_count integer, scope text, status text,
 request_hash text CHECK (request_hash IS NULL OR length(request_hash)>=32),
 response_hash text CHECK (response_hash IS NULL OR length(response_hash)>=32),
 success boolean NOT NULL DEFAULT false, error_code text, error_description text,
 response_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(response_json)='object'),
 process_run_id uuid REFERENCES arb.process_runs(run_id), created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS arb.ups_api_error_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 endpoint_path text, http_status integer, ups_error_code text,
 severity text CHECK (severity IS NULL OR severity IN ('TRANSIENT','HARD','UNKNOWN')),
 error_description text, request_hash text CHECK (request_hash IS NULL OR length(request_hash)>=32),
 response_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(response_json)='object'),
 retryable boolean NOT NULL DEFAULT false, process_run_id uuid REFERENCES arb.process_runs(run_id), created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS arb.ups_address_validation_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 shipment_id bigint REFERENCES arb.shipments(id), ebay_order_fk bigint REFERENCES arb.ebay_order(id),
 request_option integer NOT NULL DEFAULT 3, regional_request_indicator boolean, maximum_candidate_list_size integer,
 valid_address boolean NOT NULL DEFAULT false, ambiguous_address boolean NOT NULL DEFAULT false, no_candidates boolean NOT NULL DEFAULT false,
 address_classification_code text, address_classification_description text, candidate_count integer NOT NULL DEFAULT 0,
 input_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(input_json)='object'),
 normalized_candidates_json jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(normalized_candidates_json)='array'),
 raw_response_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(raw_response_json)='object'),
 request_hash text NOT NULL CHECK (length(request_hash)>=32), response_hash text NOT NULL CHECK (length(response_hash)>=32),
 process_run_id uuid REFERENCES arb.process_runs(run_id), created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS arb.ups_rate_quote_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 shipment_id bigint REFERENCES arb.shipments(id), shipment_quote_id bigint REFERENCES arb.shipment_quotes(id),
 ebay_order_fk bigint REFERENCES arb.ebay_order(id), source_listing_normalized_id bigint REFERENCES arb.listing_normalized(id),
 quote_type text NOT NULL CHECK (quote_type IN ('RATE','TIME_IN_TRANSIT','SERVICE_AVAILABILITY','SHIPPING_OPTIONS')),
 origin_postal_code text, origin_country_code text, destination_postal_code text, destination_country_code text,
 service_code text, service_name text, pickup_type_code text, package_code text, residential_indicator text,
 weight_lb numeric, length_in numeric, width_in numeric, height_in numeric, item_value_usd numeric,
 currency_code text, negotiated_rate_usd numeric, published_rate_usd numeric, total_charge_usd numeric,
 transit_days integer, guaranteed boolean, delivery_date date, selected boolean NOT NULL DEFAULT false,
 request_hash text NOT NULL CHECK (length(request_hash)>=32), response_hash text NOT NULL CHECK (length(response_hash)>=32),
 request_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(request_json)='object'),
 response_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(response_json)='object'),
 normalized_options_json jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(normalized_options_json)='array'),
 warnings_json jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(warnings_json)='array'),
 process_run_id uuid REFERENCES arb.process_runs(run_id), created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS arb.ups_shipment_label_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 shipment_id bigint REFERENCES arb.shipments(id), ebay_order_fk bigint REFERENCES arb.ebay_order(id),
 shipment_identification_number text, tracking_number text, service_code text, service_name text,
 label_format text, label_image_hash text CHECK (label_image_hash IS NULL OR length(label_image_hash)>=32),
 label_artifact_id bigint REFERENCES arb.shipping_label_artifacts(id), total_charge_usd numeric, currency_code text,
 voided boolean NOT NULL DEFAULT false, voided_at timestamptz,
 request_hash text NOT NULL CHECK (length(request_hash)>=32), response_hash text NOT NULL CHECK (length(response_hash)>=32),
 request_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(request_json)='object'),
 response_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(response_json)='object'),
 process_run_id uuid REFERENCES arb.process_runs(run_id), created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS arb.ups_tracking_snapshots (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 shipment_id bigint REFERENCES arb.shipments(id), ebay_order_fk bigint REFERENCES arb.ebay_order(id),
 tracking_number text NOT NULL, inquiry_number text, current_status_code text, current_status_description text, current_status_type text,
 service_code text, service_description text, origin_city text, origin_state text, origin_postal_code text, origin_country_code text,
 destination_city text, destination_state text, destination_postal_code text, destination_country_code text,
 scheduled_delivery_at timestamptz, delivered_at timestamptz,
 return_signature_requested boolean NOT NULL DEFAULT false, return_pod_requested boolean NOT NULL DEFAULT false, return_milestones_requested boolean NOT NULL DEFAULT false,
 package_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(package_json)='object'),
 raw_response_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(raw_response_json)='object'),
 snapshot_hash text NOT NULL CHECK (length(snapshot_hash)>=32), process_run_id uuid REFERENCES arb.process_runs(run_id), created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS arb.ups_tracking_event_details (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 ups_tracking_snapshot_id bigint REFERENCES arb.ups_tracking_snapshots(id) ON DELETE CASCADE,
 shipment_id bigint REFERENCES arb.shipments(id), tracking_number text NOT NULL,
 activity_code text, activity_type text, activity_description text, activity_city text, activity_state text,
 activity_postal_code text, activity_country_code text, activity_time timestamptz, gmt_activity_time timestamptz,
 gmt_offset text, raw_activity_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(raw_activity_json)='object'),
 activity_hash text NOT NULL CHECK (length(activity_hash)>=32), created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS arb.ups_tracking_subscription_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 shipment_id bigint REFERENCES arb.shipments(id), locale text NOT NULL DEFAULT 'en_US', country_code text,
 tracking_number_count integer NOT NULL DEFAULT 0, valid_tracking_numbers text[], invalid_tracking_numbers text[],
 destination_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(destination_json)='object'),
 credential_hash text CHECK (credential_hash IS NULL OR length(credential_hash)>=32),
 request_hash text NOT NULL CHECK (length(request_hash)>=32), response_hash text NOT NULL CHECK (length(response_hash)>=32),
 request_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(request_json)='object'),
 response_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(response_json)='object'),
 success boolean NOT NULL DEFAULT false, process_run_id uuid REFERENCES arb.process_runs(run_id), created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS arb.ups_tracking_webhook_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 tracking_number text NOT NULL, shipment_id bigint REFERENCES arb.shipments(id),
 credential_hash text CHECK (credential_hash IS NULL OR length(credential_hash)>=32), credential_valid boolean, user_agent text,
 local_activity_at timestamptz, gmt_activity_at timestamptz, gmt_offset text, scheduled_delivery_date date, actual_delivery_at timestamptz,
 delivery_start_time text, delivery_end_time text, delivery_time_description text,
 activity_status_code text, activity_status_description text,
 activity_location_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(activity_location_json)='object'),
 raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(raw_payload)='object'),
 payload_hash text NOT NULL CHECK (length(payload_hash)>=32),
 processing_status text NOT NULL DEFAULT 'RECEIVED' CHECK (processing_status IN ('RECEIVED','DUPLICATE','PROCESSED','FAILED','DEAD_LETTER')),
 process_run_id uuid REFERENCES arb.process_runs(run_id), received_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tracking_number,payload_hash)
);

CREATE TABLE IF NOT EXISTS arb.ups_label_recovery_events (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, shipment_id bigint REFERENCES arb.shipments(id), shipment_identification_number text, tracking_number text NOT NULL, label_format text, label_image_hash text CHECK (label_image_hash IS NULL OR length(label_image_hash)>=32), response_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(response_json)='object'), request_hash text NOT NULL CHECK (length(request_hash)>=32), response_hash text NOT NULL CHECK (length(response_hash)>=32), process_run_id uuid REFERENCES arb.process_runs(run_id), created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS arb.ups_pickup_events (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, shipment_id bigint REFERENCES arb.shipments(id), pickup_request_type text CHECK (pickup_request_type IS NULL OR pickup_request_type IN ('RATE','CREATE','STATUS','CANCEL')), pickup_request_number text, pickup_date date, pickup_status text, total_charge_usd numeric, currency_code text, request_hash text NOT NULL CHECK (length(request_hash)>=32), response_hash text CHECK (response_hash IS NULL OR length(response_hash)>=32), request_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(request_json)='object'), response_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(response_json)='object'), process_run_id uuid REFERENCES arb.process_runs(run_id), created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS arb.ups_claim_events (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, shipment_id bigint REFERENCES arb.shipments(id), tracking_number text, claim_number text, claim_type text CHECK (claim_type IS NULL OR claim_type IN ('LOSS','DAMAGE','LATE','BILLING','OTHER')), claim_status text, claim_amount_usd numeric, recovery_amount_usd numeric, readiness_score numeric CHECK (readiness_score IS NULL OR readiness_score BETWEEN 0 AND 100), evidence_packet_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(evidence_packet_json)='object'), raw_response_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(raw_response_json)='object'), process_run_id uuid REFERENCES arb.process_runs(run_id), created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS arb.ups_billing_adjustment_events (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, shipment_id bigint REFERENCES arb.shipments(id), tracking_number text, invoice_number text, adjustment_type text, adjustment_amount_usd numeric, reason_code text, reason_description text, disputed boolean NOT NULL DEFAULT false, dispute_status text, raw_adjustment_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(raw_adjustment_json)='object'), process_run_id uuid REFERENCES arb.process_runs(run_id), created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS arb.ups_lane_learning_metrics (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, metric_date date NOT NULL DEFAULT current_date, origin_postal_code text, destination_postal_code text, service_code text, package_class text, category_key text, shipment_count integer NOT NULL DEFAULT 0, avg_quoted_price_usd numeric, avg_actual_price_usd numeric, avg_delivery_days numeric, on_time_rate numeric CHECK (on_time_rate IS NULL OR on_time_rate BETWEEN 0 AND 1), delay_rate numeric CHECK (delay_rate IS NULL OR delay_rate BETWEEN 0 AND 1), loss_rate numeric CHECK (loss_rate IS NULL OR loss_rate BETWEEN 0 AND 1), damage_rate numeric CHECK (damage_rate IS NULL OR damage_rate BETWEEN 0 AND 1), claim_rate numeric CHECK (claim_rate IS NULL OR claim_rate BETWEEN 0 AND 1), claim_success_rate numeric CHECK (claim_success_rate IS NULL OR claim_success_rate BETWEEN 0 AND 1), avg_profit_leakage_usd numeric, risk_score numeric CHECK (risk_score IS NULL OR risk_score BETWEEN 0 AND 100), recommendation_score numeric CHECK (recommendation_score IS NULL OR recommendation_score BETWEEN 0 AND 100), process_run_id uuid REFERENCES arb.process_runs(run_id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(metric_date,origin_postal_code,destination_postal_code,service_code,package_class,category_key));
CREATE TABLE IF NOT EXISTS arb.ups_decision_events (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, shipment_id bigint REFERENCES arb.shipments(id), ebay_order_fk bigint REFERENCES arb.ebay_order(id), source_listing_normalized_id bigint REFERENCES arb.listing_normalized(id), decision_type text NOT NULL CHECK (decision_type IN ('RATE_SELECTION','INSURANCE','SIGNATURE','PACKAGING','TRACKING_RISK','CLAIM','DISPUTE','REVIEW_ROUTE','PICKUP')), selected_service_code text, selected_service_name text, selected_price_usd numeric, cheapest_price_usd numeric, risk_score numeric CHECK (risk_score IS NULL OR risk_score BETWEEN 0 AND 100), profit_score numeric CHECK (profit_score IS NULL OR profit_score BETWEEN 0 AND 100), confidence_score numeric CHECK (confidence_score IS NULL OR confidence_score BETWEEN 0 AND 100), decision_reason text, input_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(input_json)='object'), output_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(output_json)='object'), ai_used boolean NOT NULL DEFAULT false, human_review_required boolean NOT NULL DEFAULT false, process_run_id uuid REFERENCES arb.process_runs(run_id), created_at timestamptz NOT NULL DEFAULT now());

CREATE INDEX IF NOT EXISTS idx_ups_address_validation_shipment ON arb.ups_address_validation_events(shipment_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ups_rate_quote_shipment ON arb.ups_rate_quote_events(shipment_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ups_label_tracking ON arb.ups_shipment_label_events(tracking_number,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ups_tracking_snapshots_tracking ON arb.ups_tracking_snapshots(tracking_number,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ups_tracking_events_time ON arb.ups_tracking_event_details(tracking_number,activity_time DESC);
CREATE INDEX IF NOT EXISTS idx_ups_webhook_status ON arb.ups_tracking_webhook_events(processing_status,received_at DESC);
CREATE INDEX IF NOT EXISTS idx_ups_decision_shipment ON arb.ups_decision_events(shipment_id,created_at DESC);

CREATE OR REPLACE FUNCTION arb.ups_error_severity(p_error_code text, p_http_status integer) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT CASE WHEN p_error_code IN ('10004','VSS100') OR p_http_status IN (429,500,503) THEN 'TRANSIENT' WHEN p_error_code IS NULL AND p_http_status IS NULL THEN 'UNKNOWN' ELSE 'HARD' END; $$;
CREATE OR REPLACE FUNCTION arb.ups_delivery_exception_code(p_status_code text,p_status_description text) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT CASE WHEN upper(coalesce(p_status_description,'')) LIKE '%DELIVERED%' THEN 'DELIVERED' WHEN upper(coalesce(p_status_description,'')) LIKE '%EXCEPTION%' THEN 'EXCEPTION' WHEN upper(coalesce(p_status_description,'')) LIKE '%DELAY%' THEN 'DELAYED' WHEN upper(coalesce(p_status_description,'')) LIKE '%RETURN%' THEN 'RETURN' WHEN upper(coalesce(p_status_description,'')) LIKE '%HELD%' THEN 'HELD' WHEN upper(coalesce(p_status_description,'')) LIKE '%OUT FOR DELIVERY%' THEN 'OUT_FOR_DELIVERY' ELSE 'NORMAL' END; $$;
CREATE OR REPLACE FUNCTION arb.ups_score_rate_option(p_price numeric,p_cheapest_price numeric,p_risk_score numeric,p_transit_days numeric) RETURNS numeric LANGUAGE sql IMMUTABLE AS $$ SELECT GREATEST(0,LEAST(100,100-COALESCE(p_risk_score,50)*0.45-CASE WHEN COALESCE(p_cheapest_price,0)>0 THEN ((COALESCE(p_price,p_cheapest_price)-p_cheapest_price)/p_cheapest_price)*35 ELSE 0 END-COALESCE(p_transit_days,3)*2)); $$;

CREATE OR REPLACE VIEW arb.v_ups_oauth_latest AS SELECT DISTINCT ON (environment) * FROM arb.ups_oauth_token_events ORDER BY environment,created_at DESC,id DESC;
CREATE OR REPLACE VIEW arb.v_ups_address_validation_latest AS SELECT DISTINCT ON (shipment_id,ebay_order_fk) * FROM arb.ups_address_validation_events ORDER BY shipment_id,ebay_order_fk,created_at DESC,id DESC;
CREATE OR REPLACE VIEW arb.v_ups_rate_quote_latest AS SELECT DISTINCT ON (shipment_id,quote_type,service_code) * FROM arb.ups_rate_quote_events ORDER BY shipment_id,quote_type,service_code,created_at DESC,id DESC;
CREATE OR REPLACE VIEW arb.v_ups_tracking_latest AS SELECT DISTINCT ON (tracking_number) *, arb.ups_delivery_exception_code(current_status_code,current_status_description) AS tcds_exception_code FROM arb.ups_tracking_snapshots ORDER BY tracking_number,created_at DESC,id DESC;
CREATE OR REPLACE VIEW arb.v_ups_profit_protection_dashboard AS SELECT d.shipment_id,d.ebay_order_fk,d.decision_type,d.selected_service_code,d.selected_service_name,d.selected_price_usd,d.cheapest_price_usd,d.risk_score,d.profit_score,d.confidence_score,d.human_review_required,s.shipment_status,s.tracking_number,d.created_at FROM arb.ups_decision_events d LEFT JOIN arb.shipments s ON s.id=d.shipment_id;
CREATE OR REPLACE VIEW arb.v_ups_learning_dashboard AS SELECT origin_postal_code,destination_postal_code,service_code,shipment_count,on_time_rate,delay_rate,loss_rate,damage_rate,claim_rate,risk_score,recommendation_score,metric_date,updated_at FROM arb.ups_lane_learning_metrics;

INSERT INTO arb.shipping_carriers (carrier_code,carrier_name,enabled,sandbox_enabled,domestic_supported,international_supported,label_supported,tracking_supported,insurance_supported,signature_supported,api_health_status,priority_rank)
VALUES ('UPS','United Parcel Service',false,true,true,true,true,true,true,true,'UNKNOWN',30)
ON CONFLICT (carrier_code) DO UPDATE SET sandbox_enabled=true,tracking_supported=true,insurance_supported=true,signature_supported=true,updated_at=now();

INSERT INTO arb.process_registry (process_name,phase_no,process_group,description,owner_team,active_flag) VALUES
('domain3.shipping.ups.oauth_authorize',3,'shipping_ups','UPS OAuth authorization-code initiation and token exchange.','TCDS',true),
('domain3.shipping.ups.oauth_refresh',3,'shipping_ups','UPS OAuth refresh-token exchange.','TCDS',true),
('domain3.shipping.ups.address_validation',3,'shipping_ups','UPS Address Validation Street Level API.','TCDS',true),
('domain3.shipping.ups.rate_shop',3,'shipping_ups','UPS rate and shipping-option decision input.','TCDS',true),
('domain3.shipping.ups.time_in_transit',3,'shipping_ups','UPS Time in Transit API.','TCDS',true),
('domain3.shipping.ups.service_availability',3,'shipping_ups','UPS service availability capability.','TCDS',true),
('domain3.shipping.ups.shipment_create',3,'shipping_ups','UPS Shipment API label creation.','TCDS',true),
('domain3.shipping.ups.shipment_void',3,'shipping_ups','UPS Void Shipment API.','TCDS',true),
('domain3.shipping.ups.label_recovery',3,'shipping_ups','UPS Label Recovery API.','TCDS',true),
('domain3.shipping.ups.tracking',3,'shipping_ups','UPS Track API.','TCDS',true),
('domain3.shipping.ups.track_by_reference',3,'shipping_ups','UPS Track by Reference API.','TCDS',true),
('domain3.shipping.ups.tracking_subscription',3,'shipping_ups','UPS tracking subscription by tracking numbers.','TCDS',true),
('domain3.shipping.ups.tracking_webhook_ingest',3,'shipping_ups','UPS tracking webhook ingest.','TCDS',true),
('domain3.shipping.ups.proof_of_delivery',3,'shipping_ups','UPS POD through tracking options.','TCDS',true),
('domain3.shipping.ups.returns',3,'shipping_ups','UPS returns workflow scaffold.','TCDS',true),
('domain3.shipping.ups.claims',3,'shipping_ups','UPS claims workflow scaffold.','TCDS',true),
('domain3.shipping.ups.pickup',3,'shipping_ups','UPS pickup workflow scaffold.','TCDS',true),
('domain3.shipping.ups.locator',3,'shipping_ups','UPS Locator API.','TCDS',true),
('domain3.shipping.ups.billing_adjustments',3,'shipping_ups','UPS billing adjustment capture.','TCDS',true),
('domain3.shipping.ups.lane_learning',3,'shipping_ups_intelligence','UPS lane learning metrics.','TCDS',true),
('domain3.shipping.ups.decision_event',3,'shipping_ups_intelligence','UPS carrier decision events.','TCDS',true),
('domain3.shipping.ups.api_error_classification',3,'shipping_ups_intelligence','UPS transient/hard error classification.','TCDS',true)
ON CONFLICT (process_name) DO UPDATE SET description=EXCLUDED.description,active_flag=EXCLUDED.active_flag,updated_at=now();

COMMIT;
