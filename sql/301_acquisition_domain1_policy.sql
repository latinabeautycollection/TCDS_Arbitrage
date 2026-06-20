-- 301_acquisition_domain1_policy.sql
-- Domain 1 Acquisition Decision Engine policy tables for the CURRENT live schema.
create schema if not exists arb;
create extension if not exists pgcrypto;

create table if not exists arb.acquisition_policy_version (
  id bigserial primary key,
  policy_version text not null unique,
  scoring_version text not null,
  status text not null default 'active' check (status in ('draft','active','retired')),
  description text,
  config_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  activated_at timestamptz
);

create table if not exists arb.acquisition_category_policy (
  id bigserial primary key,
  policy_version text not null references arb.acquisition_policy_version(policy_version),
  category_key text not null,
  is_active boolean not null default true,
  min_sold_count integer not null default 5 check (min_sold_count >= 0),
  min_profit_usd numeric(12,2) not null default 30 check (min_profit_usd >= 0),
  min_roi numeric(12,6) not null default 0.28,
  max_active_sold_ratio numeric(12,6) not null default 3.0,
  min_identity_confidence numeric(12,6) not null default 0.62,
  min_comp_quality numeric(12,6) not null default 0.60,
  max_volatility numeric(12,6) not null default 0.58,
  return_risk_rate numeric(12,6) not null default 0.045,
  damage_risk_rate numeric(12,6) not null default 0.020,
  dispute_risk_rate numeric(12,6) not null default 0.015,
  marketplace_fee_rate numeric(12,6) not null default 0.135,
  payment_fee_rate numeric(12,6) not null default 0.030,
  packaging_cost_usd numeric(12,2) not null default 2.75,
  shipping_buffer_usd numeric(12,2) not null default 6.00,
  sales_tax_rate numeric(12,6) not null default 0.060000,
  warehouse_handling_usd numeric(12,2) not null default 2.50,
  storage_reserve_usd numeric(12,2) not null default 1.00,
  insurance_reserve_rate numeric(12,6) not null default 0.005000,
  signature_reserve_usd numeric(12,2) not null default 3.50,
  carrier_risk_rate numeric(12,6) not null default 0.010000,
  max_item_capital_pct numeric(12,6) not null default 0.100000,
  max_category_capital_pct numeric(12,6) not null default 0.350000,
  max_family_capital_pct numeric(12,6) not null default 0.200000,
  cash_reserve_pct numeric(12,6) not null default 0.150000,
  high_profit_review_multiplier numeric(12,6) not null default 4.000000,
  min_safety_score_for_buy numeric(12,6) not null default 0.700000,
  category_rank_weight numeric(12,6) not null default 1.000000,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(policy_version, category_key)
);

insert into arb.acquisition_policy_version(policy_version, scoring_version, status, description, config_json, activated_at)
values (
  'acq-domain1-schema-v3',
  'acq-score-schema-v3',
  'active',
  'Schema-compatible Domain 1 policy: capital safety gate, ShipEngine evidence, current decisions schema',
  '{"capital_safety_required":true,"shipengine_shipping_required_for_buy":true,"opportunity_queue_claim_strategy":"status_plus_entity_claim_ledger"}'::jsonb,
  now()
)
on conflict (policy_version) do nothing;

insert into arb.acquisition_category_policy(
  policy_version, category_key, min_sold_count, min_profit_usd, min_roi, max_active_sold_ratio,
  min_identity_confidence, min_comp_quality, max_volatility, return_risk_rate, damage_risk_rate,
  dispute_risk_rate, marketplace_fee_rate, payment_fee_rate, packaging_cost_usd, shipping_buffer_usd,
  sales_tax_rate, warehouse_handling_usd, storage_reserve_usd, insurance_reserve_rate, signature_reserve_usd,
  carrier_risk_rate, max_item_capital_pct, max_category_capital_pct, max_family_capital_pct,
  cash_reserve_pct, high_profit_review_multiplier, min_safety_score_for_buy, category_rank_weight, notes
)
values
('acq-domain1-schema-v3','default',5,30,0.28,3.0,0.62,0.60,0.58,0.045,0.020,0.015,0.135,0.030,2.75,6.00,0.060,2.50,1.00,0.005,3.50,0.010,0.10,0.35,0.20,0.15,4.00,0.70,1.00,'Default schema-compatible conservative policy'),
('acq-domain1-schema-v3','phones',10,45,0.33,2.3,0.80,0.70,0.45,0.080,0.020,0.035,0.135,0.030,3.50,8.00,0.060,3.00,1.25,0.007,4.00,0.012,0.08,0.25,0.15,0.18,3.50,0.76,1.10,'Phones require carrier/storage/model grounding'),
('acq-domain1-schema-v3','tools',6,35,0.30,3.0,0.66,0.60,0.55,0.045,0.030,0.015,0.135,0.030,4.50,9.00,0.060,3.00,1.00,0.005,3.50,0.012,0.10,0.32,0.18,0.15,4.00,0.70,1.00,'Tools require bare/kit/accessory state'),
('acq-domain1-schema-v3','cameras',8,50,0.35,2.5,0.75,0.68,0.50,0.090,0.035,0.030,0.135,0.030,4.75,10.00,0.060,3.50,1.50,0.007,4.00,0.015,0.08,0.25,0.15,0.18,3.25,0.76,1.05,'Cameras require body/lens/bundle grounding'),
('acq-domain1-schema-v3','small_appliances',6,30,0.32,2.8,0.64,0.60,0.55,0.070,0.050,0.025,0.135,0.030,6.50,14.00,0.060,4.00,2.00,0.005,3.50,0.018,0.06,0.22,0.14,0.20,3.50,0.72,0.90,'Appliances carry shipping and defect risk'),
('acq-domain1-schema-v3','audio',6,35,0.30,2.8,0.66,0.62,0.55,0.055,0.025,0.020,0.135,0.030,4.25,9.00,0.060,3.00,1.25,0.005,3.50,0.012,0.08,0.25,0.15,0.15,4.00,0.70,1.00,'Audio gear hardened policy'),
('acq-domain1-schema-v3','computers',8,55,0.34,2.6,0.74,0.68,0.50,0.085,0.025,0.035,0.135,0.030,4.50,10.00,0.060,3.50,1.50,0.007,4.00,0.014,0.08,0.25,0.15,0.18,3.50,0.76,1.05,'Computers require model/spec clarity')
on conflict (policy_version, category_key) do nothing;
