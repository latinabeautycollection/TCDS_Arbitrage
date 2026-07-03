BEGIN;

CREATE SCHEMA IF NOT EXISTS arb;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- Warehouse origin profiles
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS arb.shipping_warehouse_profiles (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  warehouse_key text NOT NULL UNIQUE,
  warehouse_name text NOT NULL,
  attention_to text,
  address_line1 text NOT NULL,
  address_line2 text,
  city text NOT NULL,
  state_code text NOT NULL CHECK (state_code ~ '^[A-Z]{2}$'),
  postal_code text NOT NULL CHECK (postal_code ~ '^\d{5}(-\d{4})?$'),
  country_code text NOT NULL DEFAULT 'US' CHECK (country_code='US'),
  timezone text NOT NULL DEFAULT 'America/New_York',
  is_default boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  validation_status text NOT NULL DEFAULT 'NEEDS_VERIFICATION'
    CHECK (validation_status IN ('NEEDS_VERIFICATION','VALIDATED','INVALID','MANUAL_OVERRIDE')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_shipping_warehouse_one_default
ON arb.shipping_warehouse_profiles(is_default)
WHERE is_default = true AND is_active = true;

-- ---------------------------------------------------------------------------
-- Base weighted destination models
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS arb.shipping_destination_zone_models (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  model_key text NOT NULL UNIQUE,
  model_name text NOT NULL,
  model_version text NOT NULL DEFAULT 'v1',
  model_description text,
  intended_use text NOT NULL DEFAULT 'PRE_PURCHASE_RATE_ESTIMATION',
  is_default boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  total_weight numeric NOT NULL DEFAULT 1 CHECK (total_weight > 0),
  learning_mode text NOT NULL DEFAULT 'STATIC_UNTIL_EBAY_ORDER_HISTORY'
    CHECK (learning_mode IN ('STATIC_UNTIL_EBAY_ORDER_HISTORY','LEARN_FROM_EBAY_ORDERS','MANUAL_LOCKED')),
  confidence_floor numeric NOT NULL DEFAULT 0.70 CHECK (confidence_floor BETWEEN 0 AND 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_shipping_destination_model_one_default
ON arb.shipping_destination_zone_models(is_default)
WHERE is_default = true AND is_active = true;

CREATE TABLE IF NOT EXISTS arb.shipping_destination_weighted_zips (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  model_id bigint NOT NULL REFERENCES arb.shipping_destination_zone_models(id) ON DELETE CASCADE,
  region_group text NOT NULL,
  market_name text NOT NULL,
  city text NOT NULL,
  state_code text NOT NULL CHECK (state_code ~ '^[A-Z]{2}$'),
  representative_postal_code text NOT NULL CHECK (representative_postal_code ~ '^\d{5}$'),
  weight numeric NOT NULL CHECK (weight > 0 AND weight <= 1),
  priority integer NOT NULL DEFAULT 100,
  reason text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(model_id, representative_postal_code)
);

CREATE INDEX IF NOT EXISTS idx_shipping_destination_weighted_zips_model
ON arb.shipping_destination_weighted_zips(model_id, is_active, priority);

-- ---------------------------------------------------------------------------
-- Category-aware and seasonal modifiers
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS arb.shipping_destination_category_weights (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  model_id bigint NOT NULL REFERENCES arb.shipping_destination_zone_models(id) ON DELETE CASCADE,
  category_key text NOT NULL,
  destination_zip_id bigint NOT NULL REFERENCES arb.shipping_destination_weighted_zips(id) ON DELETE CASCADE,
  weight numeric NOT NULL CHECK (weight > 0 AND weight <= 1),
  confidence_score numeric NOT NULL DEFAULT 0.75 CHECK (confidence_score BETWEEN 0 AND 1),
  sample_size integer NOT NULL DEFAULT 0,
  source text NOT NULL DEFAULT 'MANUAL_BASELINE',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(model_id, category_key, destination_zip_id)
);

CREATE INDEX IF NOT EXISTS idx_shipping_destination_category_weights_model_category
ON arb.shipping_destination_category_weights(model_id, category_key, is_active);

CREATE TABLE IF NOT EXISTS arb.shipping_destination_seasonal_adjustments (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  model_id bigint NOT NULL REFERENCES arb.shipping_destination_zone_models(id) ON DELETE CASCADE,
  region_group text,
  destination_zip_id bigint REFERENCES arb.shipping_destination_weighted_zips(id) ON DELETE CASCADE,
  month_no integer NOT NULL CHECK (month_no BETWEEN 1 AND 12),
  cost_multiplier numeric NOT NULL DEFAULT 1 CHECK (cost_multiplier > 0),
  delay_risk_multiplier numeric NOT NULL DEFAULT 1 CHECK (delay_risk_multiplier > 0),
  reason text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (region_group IS NOT NULL OR destination_zip_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_shipping_destination_seasonal_model_month
ON arb.shipping_destination_seasonal_adjustments(model_id, month_no, is_active);

-- ---------------------------------------------------------------------------
-- Dynamic learning history
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS arb.shipping_destination_weight_history (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  model_id bigint NOT NULL REFERENCES arb.shipping_destination_zone_models(id) ON DELETE CASCADE,
  category_key text,
  region_group text NOT NULL,
  representative_postal_code text NOT NULL CHECK (representative_postal_code ~ '^\d{5}$'),
  prior_weight numeric NOT NULL CHECK (prior_weight >= 0 AND prior_weight <= 1),
  learned_weight numeric NOT NULL CHECK (learned_weight >= 0 AND learned_weight <= 1),
  blended_weight numeric NOT NULL CHECK (blended_weight >= 0 AND blended_weight <= 1),
  sample_size integer NOT NULL DEFAULT 0,
  learning_window_start date,
  learning_window_end date,
  learning_rate numeric NOT NULL DEFAULT 0.25 CHECK (learning_rate BETWEEN 0 AND 1),
  source text NOT NULL DEFAULT 'EBAY_ORDER_HISTORY',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_shipping_destination_weight_history_model
ON arb.shipping_destination_weight_history(model_id, category_key, created_at DESC);

-- ---------------------------------------------------------------------------
-- Rate batches and weighted rate results
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS arb.shipping_weighted_rate_batches (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  candidate_id bigint,
  source_listing_normalized_id bigint,
  category_key text,
  warehouse_key text NOT NULL,
  destination_model_key text NOT NULL,
  carrier_code text,
  service_code text,
  package_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(package_json)='object'),
  status text NOT NULL DEFAULT 'QUEUED'
    CHECK (status IN ('QUEUED','RUNNING','SUCCEEDED','FAILED','DEAD_LETTER')),
  weighted_average_cost_usd numeric,
  min_cost_usd numeric,
  median_cost_usd numeric,
  max_cost_usd numeric,
  cost_stddev_usd numeric,
  p80_cost_usd numeric,
  p90_cost_usd numeric,
  worst_case_cost_usd numeric,
  conservative_cost_usd numeric,
  destination_count integer,
  confidence_score numeric CHECK (confidence_score IS NULL OR confidence_score BETWEEN 0 AND 1),
  result_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(result_json)='object'),
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_shipping_weighted_rate_batches_candidate
ON arb.shipping_weighted_rate_batches(candidate_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_shipping_weighted_rate_batches_source_listing
ON arb.shipping_weighted_rate_batches(source_listing_normalized_id, created_at DESC);

CREATE TABLE IF NOT EXISTS arb.shipping_weighted_rate_results (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  batch_id bigint NOT NULL REFERENCES arb.shipping_weighted_rate_batches(id) ON DELETE CASCADE,
  region_group text NOT NULL,
  market_name text NOT NULL,
  destination_postal_code text NOT NULL CHECK (destination_postal_code ~ '^\d{5}$'),
  destination_city text NOT NULL,
  destination_state_code text NOT NULL CHECK (destination_state_code ~ '^[A-Z]{2}$'),
  destination_weight numeric NOT NULL CHECK (destination_weight > 0 AND destination_weight <= 1),
  seasonal_cost_multiplier numeric NOT NULL DEFAULT 1 CHECK (seasonal_cost_multiplier > 0),
  carrier_code text NOT NULL,
  service_code text,
  service_name text,
  quoted_cost_usd numeric NOT NULL CHECK (quoted_cost_usd >= 0),
  adjusted_quoted_cost_usd numeric GENERATED ALWAYS AS (quoted_cost_usd * seasonal_cost_multiplier) STORED,
  estimated_delivery_days integer,
  raw_rate_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(raw_rate_json)='object'),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_shipping_weighted_rate_results_batch
ON arb.shipping_weighted_rate_results(batch_id, adjusted_quoted_cost_usd);

-- ---------------------------------------------------------------------------
-- Prediction error tracking: predicted vs quoted vs actual
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS arb.shipping_cost_prediction_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  candidate_id bigint,
  source_listing_normalized_id bigint,
  shipment_id bigint,
  category_key text,
  model_key text NOT NULL,
  batch_id bigint REFERENCES arb.shipping_weighted_rate_batches(id) ON DELETE SET NULL,
  predicted_cost_usd numeric NOT NULL DEFAULT 0,
  quoted_cost_usd numeric,
  actual_cost_usd numeric,
  prediction_error_usd numeric GENERATED ALWAYS AS (
    CASE WHEN actual_cost_usd IS NULL THEN NULL ELSE actual_cost_usd - predicted_cost_usd END
  ) STORED,
  quoted_error_usd numeric GENERATED ALWAYS AS (
    CASE WHEN quoted_cost_usd IS NULL THEN NULL ELSE quoted_cost_usd - predicted_cost_usd END
  ) STORED,
  carrier_code text,
  service_code text,
  region_group text,
  destination_postal_code text,
  package_profile_key text,
  weight_band text,
  payload_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(payload_json)='object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  actual_recorded_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_shipping_cost_prediction_events_candidate
ON arb.shipping_cost_prediction_events(candidate_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_shipping_cost_prediction_events_model_category
ON arb.shipping_cost_prediction_events(model_key, category_key, created_at DESC);

-- ---------------------------------------------------------------------------
-- Digital Twin integration
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS arb.shipping_destination_digital_twin_runs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  candidate_id bigint,
  source_listing_normalized_id bigint,
  category_key text,
  destination_model_key text NOT NULL,
  warehouse_key text NOT NULL,
  expected_gross_profit_usd numeric,
  weighted_average_cost_usd numeric,
  p90_cost_usd numeric,
  worst_case_cost_usd numeric,
  expected_profit_after_weighted_shipping_usd numeric,
  expected_profit_after_p90_shipping_usd numeric,
  expected_profit_after_worst_case_shipping_usd numeric,
  minimum_profit_floor_usd numeric,
  decision text NOT NULL CHECK (decision IN ('BUY_SAFE','BUY_REVIEW','WATCH','REJECT')),
  confidence_score numeric NOT NULL CHECK (confidence_score BETWEEN 0 AND 1),
  simulation_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(simulation_json)='object'),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_shipping_destination_digital_twin_candidate
ON arb.shipping_destination_digital_twin_runs(candidate_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Functions
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION arb.fn_get_default_shipping_warehouse()
RETURNS SETOF arb.shipping_warehouse_profiles
LANGUAGE sql
STABLE
AS $$
  SELECT *
  FROM arb.shipping_warehouse_profiles
  WHERE is_default = true AND is_active = true
  ORDER BY updated_at DESC
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION arb.fn_get_weighted_destination_zip_model(
  p_model_key text DEFAULT NULL,
  p_category_key text DEFAULT NULL,
  p_ship_date date DEFAULT CURRENT_DATE
)
RETURNS TABLE (
  model_key text,
  region_group text,
  market_name text,
  city text,
  state_code text,
  representative_postal_code text,
  base_weight numeric,
  effective_weight numeric,
  seasonal_cost_multiplier numeric,
  seasonal_delay_risk_multiplier numeric,
  priority integer
)
LANGUAGE sql
STABLE
AS $$
  WITH model AS (
    SELECT *
    FROM arb.shipping_destination_zone_models
    WHERE is_active = true
      AND (p_model_key IS NULL OR model_key = p_model_key)
    ORDER BY CASE WHEN p_model_key IS NULL AND is_default THEN 0 ELSE 1 END, updated_at DESC
    LIMIT 1
  ),
  base AS (
    SELECT
      m.model_key,
      z.id AS destination_zip_id,
      z.region_group,
      z.market_name,
      z.city,
      z.state_code,
      z.representative_postal_code,
      z.weight AS base_weight,
      coalesce(cw.weight, z.weight) AS raw_effective_weight,
      coalesce(sa_zip.cost_multiplier, sa_region.cost_multiplier, 1) AS seasonal_cost_multiplier,
      coalesce(sa_zip.delay_risk_multiplier, sa_region.delay_risk_multiplier, 1) AS seasonal_delay_risk_multiplier,
      z.priority
    FROM model m
    JOIN arb.shipping_destination_weighted_zips z ON z.model_id = m.id AND z.is_active = true
    LEFT JOIN arb.shipping_destination_category_weights cw
      ON cw.model_id = m.id
     AND cw.destination_zip_id = z.id
     AND cw.category_key = p_category_key
     AND cw.is_active = true
    LEFT JOIN arb.shipping_destination_seasonal_adjustments sa_zip
      ON sa_zip.model_id = m.id
     AND sa_zip.destination_zip_id = z.id
     AND sa_zip.month_no = extract(month from coalesce(p_ship_date, current_date))::int
     AND sa_zip.is_active = true
    LEFT JOIN arb.shipping_destination_seasonal_adjustments sa_region
      ON sa_region.model_id = m.id
     AND sa_region.destination_zip_id IS NULL
     AND sa_region.region_group = z.region_group
     AND sa_region.month_no = extract(month from coalesce(p_ship_date, current_date))::int
     AND sa_region.is_active = true
  ),
  normalized AS (
    SELECT *, sum(raw_effective_weight) OVER () AS total_raw_weight
    FROM base
  )
  SELECT
    model_key,
    region_group,
    market_name,
    city,
    state_code,
    representative_postal_code,
    base_weight,
    CASE WHEN total_raw_weight > 0 THEN raw_effective_weight / total_raw_weight ELSE base_weight END AS effective_weight,
    seasonal_cost_multiplier,
    seasonal_delay_risk_multiplier,
    priority
  FROM normalized
  ORDER BY priority, representative_postal_code;
$$;

CREATE OR REPLACE FUNCTION arb.fn_percentile_from_values(p_values numeric[], p_percentile numeric)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_sorted numeric[];
  v_count int;
  v_index int;
BEGIN
  SELECT array_agg(v ORDER BY v) INTO v_sorted FROM unnest(p_values) v;
  v_count := coalesce(array_length(v_sorted, 1), 0);
  IF v_count = 0 THEN
    RETURN 0;
  END IF;
  v_index := greatest(1, ceil(v_count * p_percentile)::int);
  RETURN v_sorted[v_index];
END;
$$;

CREATE OR REPLACE FUNCTION arb.fn_calculate_weighted_rate_summary(p_batch_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_summary jsonb;
BEGIN
  WITH r AS (
    SELECT *
    FROM arb.shipping_weighted_rate_results
    WHERE batch_id = p_batch_id
  ),
  agg AS (
    SELECT
      coalesce(round(sum(adjusted_quoted_cost_usd * destination_weight), 2), 0) AS weighted_average_cost_usd,
      coalesce(round(min(adjusted_quoted_cost_usd), 2), 0) AS min_cost_usd,
      coalesce(round(percentile_cont(0.5) WITHIN GROUP (ORDER BY adjusted_quoted_cost_usd)::numeric, 2), 0) AS median_cost_usd,
      coalesce(round(max(adjusted_quoted_cost_usd), 2), 0) AS max_cost_usd,
      coalesce(round(stddev_pop(adjusted_quoted_cost_usd), 2), 0) AS cost_stddev_usd,
      coalesce(round(percentile_cont(0.8) WITHIN GROUP (ORDER BY adjusted_quoted_cost_usd)::numeric, 2), 0) AS p80_cost_usd,
      coalesce(round(percentile_cont(0.9) WITHIN GROUP (ORDER BY adjusted_quoted_cost_usd)::numeric, 2), 0) AS p90_cost_usd,
      count(*)::int AS destination_count
    FROM r
  )
  SELECT jsonb_build_object(
    'weighted_average_cost_usd', weighted_average_cost_usd,
    'min_cost_usd', min_cost_usd,
    'median_cost_usd', median_cost_usd,
    'max_cost_usd', max_cost_usd,
    'cost_stddev_usd', cost_stddev_usd,
    'p80_cost_usd', p80_cost_usd,
    'p90_cost_usd', p90_cost_usd,
    'worst_case_cost_usd', max_cost_usd,
    'conservative_cost_usd', greatest(p90_cost_usd, weighted_average_cost_usd + cost_stddev_usd),
    'destination_count', destination_count,
    'confidence_score', CASE WHEN destination_count >= 15 THEN 0.95 WHEN destination_count >= 8 THEN 0.85 ELSE 0.55 END
  )
  INTO v_summary
  FROM agg;

  UPDATE arb.shipping_weighted_rate_batches b
  SET weighted_average_cost_usd = (v_summary->>'weighted_average_cost_usd')::numeric,
      min_cost_usd = (v_summary->>'min_cost_usd')::numeric,
      median_cost_usd = (v_summary->>'median_cost_usd')::numeric,
      max_cost_usd = (v_summary->>'max_cost_usd')::numeric,
      cost_stddev_usd = (v_summary->>'cost_stddev_usd')::numeric,
      p80_cost_usd = (v_summary->>'p80_cost_usd')::numeric,
      p90_cost_usd = (v_summary->>'p90_cost_usd')::numeric,
      worst_case_cost_usd = (v_summary->>'worst_case_cost_usd')::numeric,
      conservative_cost_usd = (v_summary->>'conservative_cost_usd')::numeric,
      destination_count = (v_summary->>'destination_count')::integer,
      confidence_score = (v_summary->>'confidence_score')::numeric,
      result_json = coalesce(b.result_json, '{}'::jsonb) || v_summary,
      status = CASE WHEN (v_summary->>'destination_count')::int > 0 THEN 'SUCCEEDED' ELSE 'FAILED' END,
      completed_at = now()
  WHERE b.id = p_batch_id;

  RETURN v_summary;
END;
$$;

CREATE OR REPLACE FUNCTION arb.fn_record_shipping_cost_prediction_event(
  p_payload jsonb
)
RETURNS bigint
LANGUAGE plpgsql
AS $$
DECLARE
  v_id bigint;
BEGIN
  INSERT INTO arb.shipping_cost_prediction_events (
    candidate_id,
    source_listing_normalized_id,
    shipment_id,
    category_key,
    model_key,
    batch_id,
    predicted_cost_usd,
    quoted_cost_usd,
    actual_cost_usd,
    carrier_code,
    service_code,
    region_group,
    destination_postal_code,
    package_profile_key,
    weight_band,
    payload_json,
    actual_recorded_at
  )
  VALUES (
    nullif(p_payload->>'candidate_id','')::bigint,
    nullif(coalesce(p_payload->>'source_listing_normalized_id', p_payload->>'sourceListingNormalizedId'),'')::bigint,
    nullif(p_payload->>'shipment_id','')::bigint,
    nullif(p_payload->>'category_key',''),
    coalesce(nullif(p_payload->>'model_key',''), 'tcds_default_propertyroom_retail_us_v1'),
    nullif(p_payload->>'batch_id','')::bigint,
    coalesce(nullif(p_payload->>'predicted_cost_usd','')::numeric, 0),
    nullif(p_payload->>'quoted_cost_usd','')::numeric,
    nullif(p_payload->>'actual_cost_usd','')::numeric,
    nullif(p_payload->>'carrier_code',''),
    nullif(p_payload->>'service_code',''),
    nullif(p_payload->>'region_group',''),
    nullif(p_payload->>'destination_postal_code',''),
    nullif(p_payload->>'package_profile_key',''),
    nullif(p_payload->>'weight_band',''),
    p_payload,
    CASE WHEN p_payload ? 'actual_cost_usd' THEN now() ELSE NULL END
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION arb.fn_learn_shipping_destination_weights_from_orders(
  p_model_key text DEFAULT 'tcds_default_propertyroom_retail_us_v1',
  p_category_key text DEFAULT NULL,
  p_window_days integer DEFAULT 90,
  p_learning_rate numeric DEFAULT 0.25
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_model_id bigint;
  v_total int;
BEGIN
  SELECT id INTO v_model_id
  FROM arb.shipping_destination_zone_models
  WHERE model_key = p_model_key;

  IF v_model_id IS NULL THEN
    RAISE EXCEPTION 'Destination model not found: %', p_model_key;
  END IF;

  /*
    Learning source:
    Uses arb.ebay_order ship_to_state / ship_to_postal_code when available.
    Category-aware learning is supported through joining eBay listing/source listing when available.
    If insufficient live orders exist, this function writes no rows and returns status=NO_DATA.
  */
  WITH orders AS (
    SELECT
      upper(left(o.ship_to_postal_code, 5)) AS buyer_zip,
      upper(o.ship_to_state) AS buyer_state,
      coalesce(ln.category, el.category_id, p_category_key, 'UNKNOWN') AS category_key
    FROM arb.ebay_order o
    LEFT JOIN arb.ebay_listing el ON el.id = o.ebay_listing_fk
    LEFT JOIN arb.listing_normalized ln ON ln.id = el.source_listing_normalized_id
    WHERE o.created_at >= now() - make_interval(days => p_window_days)
      AND o.ship_to_postal_code IS NOT NULL
      AND o.ship_to_state IS NOT NULL
      AND (p_category_key IS NULL OR coalesce(ln.category, el.category_id, p_category_key) = p_category_key)
  ),
  mapped AS (
    SELECT
      z.id AS destination_zip_id,
      z.region_group,
      z.representative_postal_code,
      count(*)::int AS sample_size
    FROM orders o
    JOIN arb.shipping_destination_weighted_zips z
      ON z.model_id = v_model_id
     AND z.is_active = true
     AND z.state_code = o.buyer_state
    GROUP BY z.id, z.region_group, z.representative_postal_code
  ),
  total AS (
    SELECT coalesce(sum(sample_size),0)::int AS sample_count FROM mapped
  ),
  blended AS (
    SELECT
      z.id AS destination_zip_id,
      z.region_group,
      z.representative_postal_code,
      z.weight AS prior_weight,
      coalesce(m.sample_size,0) AS sample_size,
      CASE WHEN (SELECT sample_count FROM total) > 0
           THEN coalesce(m.sample_size,0)::numeric / (SELECT sample_count FROM total)
           ELSE z.weight
      END AS learned_weight,
      (z.weight * (1 - p_learning_rate)) +
      ((CASE WHEN (SELECT sample_count FROM total) > 0
           THEN coalesce(m.sample_size,0)::numeric / (SELECT sample_count FROM total)
           ELSE z.weight END) * p_learning_rate) AS blended_weight
    FROM arb.shipping_destination_weighted_zips z
    LEFT JOIN mapped m ON m.destination_zip_id = z.id
    WHERE z.model_id = v_model_id AND z.is_active = true
  ),
  normalized AS (
    SELECT *, blended_weight / nullif(sum(blended_weight) OVER (),0) AS normalized_blended_weight
    FROM blended
  ),
  inserted AS (
    INSERT INTO arb.shipping_destination_weight_history (
      model_id, category_key, region_group, representative_postal_code,
      prior_weight, learned_weight, blended_weight, sample_size,
      learning_window_start, learning_window_end, learning_rate, source
    )
    SELECT
      v_model_id, p_category_key, region_group, representative_postal_code,
      prior_weight, learned_weight, normalized_blended_weight, sample_size,
      current_date - p_window_days, current_date, p_learning_rate, 'EBAY_ORDER_HISTORY'
    FROM normalized
    WHERE (SELECT sample_count FROM total) > 0
    RETURNING 1
  )
  SELECT count(*) INTO v_total FROM inserted;

  RETURN jsonb_build_object(
    'model_key', p_model_key,
    'category_key', p_category_key,
    'rows_written', v_total,
    'status', CASE WHEN v_total > 0 THEN 'LEARNED' ELSE 'NO_DATA' END
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- Views
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW arb.v_shipping_default_origin_and_destinations AS
SELECT
  w.warehouse_key,
  w.warehouse_name,
  w.address_line1,
  w.address_line2,
  w.city AS origin_city,
  w.state_code AS origin_state_code,
  w.postal_code AS origin_postal_code,
  w.country_code AS origin_country_code,
  d.model_key,
  d.region_group,
  d.market_name,
  d.city AS destination_city,
  d.state_code AS destination_state_code,
  d.representative_postal_code AS destination_postal_code,
  d.base_weight AS destination_base_weight,
  d.effective_weight AS destination_weight,
  d.seasonal_cost_multiplier,
  d.seasonal_delay_risk_multiplier,
  d.priority
FROM arb.fn_get_default_shipping_warehouse() w
CROSS JOIN arb.fn_get_weighted_destination_zip_model(NULL, NULL, CURRENT_DATE) d;

CREATE OR REPLACE VIEW arb.v_shipping_destination_model_health AS
SELECT
  m.model_key,
  m.model_name,
  m.is_default,
  count(z.*) FILTER (WHERE z.is_active) AS active_zip_count,
  round(sum(z.weight) FILTER (WHERE z.is_active), 6) AS active_weight_sum,
  CASE
    WHEN count(z.*) FILTER (WHERE z.is_active) < 8 THEN 'FAIL_TOO_FEW_DESTINATIONS'
    WHEN abs(coalesce(sum(z.weight) FILTER (WHERE z.is_active), 0) - 1) > 0.0001 THEN 'FAIL_WEIGHTS_NOT_ONE'
    ELSE 'PASS'
  END AS health_status
FROM arb.shipping_destination_zone_models m
LEFT JOIN arb.shipping_destination_weighted_zips z ON z.model_id = m.id
WHERE m.is_active = true
GROUP BY m.id, m.model_key, m.model_name, m.is_default;

CREATE OR REPLACE VIEW arb.v_shipping_destination_prediction_accuracy AS
SELECT
  model_key,
  category_key,
  carrier_code,
  service_code,
  count(*) AS event_count,
  round(avg(prediction_error_usd), 2) AS avg_prediction_error_usd,
  round(avg(abs(prediction_error_usd)), 2) AS avg_abs_prediction_error_usd,
  round(percentile_cont(0.9) WITHIN GROUP (ORDER BY abs(prediction_error_usd))::numeric, 2) AS p90_abs_prediction_error_usd
FROM arb.shipping_cost_prediction_events
WHERE actual_cost_usd IS NOT NULL
GROUP BY model_key, category_key, carrier_code, service_code;

CREATE OR REPLACE VIEW arb.v_shipping_destination_digital_twin_latest AS
SELECT DISTINCT ON (coalesce(candidate_id::text, source_listing_normalized_id::text))
  *
FROM arb.shipping_destination_digital_twin_runs
ORDER BY coalesce(candidate_id::text, source_listing_normalized_id::text), created_at DESC, id DESC;

COMMIT;
