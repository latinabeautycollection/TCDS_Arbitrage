BEGIN;

INSERT INTO arb.shipping_warehouse_profiles (
  warehouse_key, warehouse_name, attention_to, address_line1, city, state_code, postal_code, country_code,
  timezone, is_default, is_active, validation_status, notes
)
VALUES (
  'tcds_stafford_va_001',
  'Total Coverage Database Solutions LLC - Stafford Warehouse',
  'Total Coverage Database Solutions LLC',
  '184 Boxelder Drive',
  'Stafford',
  'VA',
  '22026',
  'US',
  'America/New_York',
  true,
  true,
  'NEEDS_VERIFICATION',
  'User-provided warehouse origin. Verify city/ZIP before live carrier rating; all values remain environment-configurable.'
)
ON CONFLICT (warehouse_key) DO UPDATE SET
  warehouse_name = EXCLUDED.warehouse_name,
  attention_to = EXCLUDED.attention_to,
  address_line1 = EXCLUDED.address_line1,
  city = EXCLUDED.city,
  state_code = EXCLUDED.state_code,
  postal_code = EXCLUDED.postal_code,
  country_code = EXCLUDED.country_code,
  is_default = EXCLUDED.is_default,
  is_active = EXCLUDED.is_active,
  validation_status = EXCLUDED.validation_status,
  notes = EXCLUDED.notes,
  updated_at = now();

INSERT INTO arb.shipping_destination_zone_models (
  model_key, model_name, model_version, model_description, intended_use, is_default, is_active,
  total_weight, learning_mode, confidence_floor
)
VALUES (
  'tcds_default_propertyroom_retail_us_v2',
  'TCDS PropertyRoom + 20 Retail Store National Buyer ZIP Model',
  'v2',
  'Weighted representative destination model for pre-purchase rate estimation with category-aware, seasonal, learning, and digital twin support.',
  'PRE_PURCHASE_RATE_ESTIMATION',
  true,
  true,
  1,
  'LEARN_FROM_EBAY_ORDERS',
  0.70
)
ON CONFLICT (model_key) DO UPDATE SET
  model_name = EXCLUDED.model_name,
  model_version = EXCLUDED.model_version,
  model_description = EXCLUDED.model_description,
  is_default = EXCLUDED.is_default,
  is_active = EXCLUDED.is_active,
  total_weight = EXCLUDED.total_weight,
  learning_mode = EXCLUDED.learning_mode,
  confidence_floor = EXCLUDED.confidence_floor,
  updated_at = now();

WITH model AS (
  SELECT id FROM arb.shipping_destination_zone_models WHERE model_key='tcds_default_propertyroom_retail_us_v2'
), data(region_group, market_name, city, state_code, zip, weight, priority, reason) AS (
  VALUES
    ('SOUTH', 'Miami FL', 'Miami', 'FL', '33101', 0.0600, 10, 'Large South Florida buyer market and long-zone test from Virginia.'),
    ('SOUTH', 'Atlanta GA', 'Atlanta', 'GA', '30303', 0.0600, 20, 'Major Southeast metro and common e-commerce destination.'),
    ('SOUTH', 'Columbia SC', 'Columbia', 'SC', '29201', 0.0400, 30, 'Representative South Carolina destination; user specified South Carolina without city.'),
    ('SOUTHWEST', 'Memphis TN', 'Memphis', 'TN', '38103', 0.0500, 40, 'Regional logistics hub and mid-South buyer destination.'),
    ('SOUTHWEST', 'Shreveport LA', 'Shreveport', 'LA', '71101', 0.0400, 50, 'Lower-density Southwest/South Central destination.'),
    ('SOUTHWEST', 'Austin TX', 'Austin', 'TX', '78701', 0.0600, 60, 'High-growth Texas e-commerce buyer market.'),
    ('NORTH', 'Baltimore MD', 'Baltimore', 'MD', '21201', 0.0550, 70, 'Nearby Mid-Atlantic short-zone destination.'),
    ('NORTH', 'New York City NY', 'New York', 'NY', '10001', 0.0800, 80, 'Dense Northeast buyer market; Manhattan representative ZIP.'),
    ('NORTH', 'Augusta ME', 'Augusta', 'ME', '04330', 0.0300, 90, 'Far Northeast smaller-market destination.'),
    ('NORTHEAST', 'Detroit MI', 'Detroit', 'MI', '48226', 0.0500, 100, 'Great Lakes metro destination.'),
    ('NORTHEAST', 'Indianapolis IN', 'Indianapolis', 'IN', '46204', 0.0500, 110, 'Midwest/Northeast crossover metro.'),
    ('CENTRAL', 'Saint Paul MN', 'Saint Paul', 'MN', '55101', 0.0450, 120, 'Upper Midwest destination.'),
    ('CENTRAL', 'Cheyenne WY', 'Cheyenne', 'WY', '82001', 0.0250, 130, 'Lower-density central/mountain destination to test remote/long-zone cost.'),
    ('WEST', 'Las Vegas NV', 'Las Vegas', 'NV', '89101', 0.0500, 140, 'Mountain West destination.'),
    ('WEST', 'Phoenix AZ', 'Phoenix', 'AZ', '85004', 0.0600, 150, 'Large Southwest/West destination.'),
    ('WEST', 'Los Angeles CA', 'Los Angeles', 'CA', '90012', 0.0900, 160, 'Large West Coast destination and long-zone cost anchor.'),
    ('NORTHWEST', 'Portland OR', 'Portland', 'OR', '97204', 0.0450, 170, 'Pacific Northwest destination.'),
    ('NORTHWEST', 'Seattle WA', 'Seattle', 'WA', '98101', 0.0500, 180, 'Pacific Northwest long-zone destination.')
)
INSERT INTO arb.shipping_destination_weighted_zips (
  model_id, region_group, market_name, city, state_code, representative_postal_code, weight, priority, reason, is_active
)
SELECT model.id, data.region_group, data.market_name, data.city, data.state_code, data.zip, data.weight, data.priority, data.reason, true
FROM model, data
ON CONFLICT (model_id, representative_postal_code) DO UPDATE SET
  region_group = EXCLUDED.region_group,
  market_name = EXCLUDED.market_name,
  city = EXCLUDED.city,
  state_code = EXCLUDED.state_code,
  weight = EXCLUDED.weight,
  priority = EXCLUDED.priority,
  reason = EXCLUDED.reason,
  is_active = true,
  updated_at = now();

-- Category-aware initial overlays. These are intentionally mild and normalized by fn_get_weighted_destination_zip_model.
WITH model AS (
  SELECT id FROM arb.shipping_destination_zone_models WHERE model_key='tcds_default_propertyroom_retail_us_v2'
),
z AS (
  SELECT z.* FROM arb.shipping_destination_weighted_zips z JOIN model m ON m.id=z.model_id
),
category_data(category_key, market_name, weight, source) AS (
  VALUES
    ('electronics', 'New York City NY', 0.0900, 'BASELINE_CATEGORY_PRIOR'),
    ('electronics', 'Los Angeles CA', 0.1050, 'BASELINE_CATEGORY_PRIOR'),
    ('electronics', 'Seattle WA', 0.0600, 'BASELINE_CATEGORY_PRIOR'),
    ('electronics', 'Austin TX', 0.0700, 'BASELINE_CATEGORY_PRIOR'),
    ('power_tools', 'Austin TX', 0.0800, 'BASELINE_CATEGORY_PRIOR'),
    ('power_tools', 'Atlanta GA', 0.0700, 'BASELINE_CATEGORY_PRIOR'),
    ('power_tools', 'Phoenix AZ', 0.0700, 'BASELINE_CATEGORY_PRIOR'),
    ('automotive_tools', 'Detroit MI', 0.0750, 'BASELINE_CATEGORY_PRIOR'),
    ('automotive_tools', 'Indianapolis IN', 0.0650, 'BASELINE_CATEGORY_PRIOR'),
    ('automotive_tools', 'Memphis TN', 0.0600, 'BASELINE_CATEGORY_PRIOR'),
    ('collectibles', 'New York City NY', 0.0950, 'BASELINE_CATEGORY_PRIOR'),
    ('collectibles', 'Los Angeles CA', 0.0950, 'BASELINE_CATEGORY_PRIOR'),
    ('collectibles', 'Portland OR', 0.0550, 'BASELINE_CATEGORY_PRIOR')
)
INSERT INTO arb.shipping_destination_category_weights (
  model_id, category_key, destination_zip_id, weight, confidence_score, sample_size, source, is_active
)
SELECT model.id, cd.category_key, z.id, cd.weight, 0.70, 0, cd.source, true
FROM model, category_data cd
JOIN z ON z.market_name = cd.market_name
ON CONFLICT (model_id, category_key, destination_zip_id) DO UPDATE SET
  weight = EXCLUDED.weight,
  confidence_score = EXCLUDED.confidence_score,
  source = EXCLUDED.source,
  is_active = true,
  updated_at = now();

-- Seasonal risk/cost multipliers, conservative defaults for holiday peak.
WITH model AS (
  SELECT id FROM arb.shipping_destination_zone_models WHERE model_key='tcds_default_propertyroom_retail_us_v2'
),
season(region_group, month_no, cost_multiplier, delay_risk_multiplier, reason) AS (
  VALUES
    ('WEST', 11, 1.04, 1.08, 'Holiday peak westbound pressure.'),
    ('WEST', 12, 1.08, 1.15, 'Holiday peak westbound pressure.'),
    ('NORTHWEST', 11, 1.04, 1.08, 'Holiday peak northwest pressure.'),
    ('NORTHWEST', 12, 1.08, 1.16, 'Holiday peak northwest pressure.'),
    ('NORTH', 12, 1.04, 1.12, 'Winter/holiday Northeast delivery risk.'),
    ('NORTHEAST', 12, 1.04, 1.12, 'Winter/holiday Great Lakes delivery risk.'),
    ('CENTRAL', 12, 1.03, 1.10, 'Winter central delivery risk.')
)
INSERT INTO arb.shipping_destination_seasonal_adjustments (
  model_id, region_group, month_no, cost_multiplier, delay_risk_multiplier, reason, is_active
)
SELECT model.id, season.region_group, season.month_no, season.cost_multiplier, season.delay_risk_multiplier, season.reason, true
FROM model, season
ON CONFLICT DO NOTHING;

COMMIT;
