create table if not exists arb.acquisition_shipping_profile (
  id bigserial primary key,
  listing_id uuid not null references arb.listings(id),
  shipping_class text not null,
  inbound_shipping_usd numeric not null default 0,
  outbound_shipping_usd numeric not null default 0,
  packaging_cost_usd numeric not null default 0,
  insurance_reserve_usd numeric not null default 0,
  signature_reserve_usd numeric not null default 0,
  return_reserve_usd numeric not null default 0,
  dispute_reserve_usd numeric not null default 0,
  damage_reserve_usd numeric not null default 0,
  shipping_risk_score numeric not null,
  shipping_confidence_score numeric not null,
  reason_codes jsonb not null default '[]'::jsonb,
  evidence_json jsonb not null default '{}'::jsonb,
  correlation_id text,
  created_at timestamptz not null default now(),
  unique (listing_id, correlation_id)
);

create table if not exists arb.acquisition_listing_generation (
  id bigserial primary key,
  listing_id uuid not null references arb.listings(id),
  title text not null,
  subtitle text,
  bullet_points jsonb not null default '[]'::jsonb,
  description_html text not null,
  condition_disclosure text not null,
  included_items_disclosure text not null,
  defect_disclosure text,
  testing_disclosure text not null,
  defense_language jsonb not null default '[]'::jsonb,
  seo_keywords jsonb not null default '[]'::jsonb,
  listing_risk_flags jsonb not null default '[]'::jsonb,
  description_quality_score numeric not null,
  evidence_json jsonb not null default '{}'::jsonb,
  generation_version text not null default 'acquisition-listing-v1',
  correlation_id text,
  created_at timestamptz not null default now(),
  unique (listing_id, generation_version, correlation_id)
);

create table if not exists arb.acquisition_return_risk (
  id bigserial primary key,
  listing_id uuid not null references arb.listings(id),
  return_probability numeric not null,
  dispute_probability numeric not null,
  return_reserve_usd numeric not null default 0,
  dispute_reserve_usd numeric not null default 0,
  damage_reserve_usd numeric not null default 0,
  return_risk_score numeric not null,
  reason_codes jsonb not null default '[]'::jsonb,
  evidence_json jsonb not null default '{}'::jsonb,
  correlation_id text,
  created_at timestamptz not null default now(),
  unique (listing_id, correlation_id)
);

create table if not exists arb.acquisition_forensic_chain (
  id bigserial primary key,
  listing_id uuid not null references arb.listings(id),
  event_type text not null,
  evidence_type text not null,
  storage_url text,
  raw_text text,
  raw_json jsonb not null default '{}'::jsonb,
  hash_sha256 text not null check (char_length(hash_sha256) = 64),
  actor text,
  correlation_id text,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (listing_id, event_type, evidence_type, hash_sha256)
);

create table if not exists arb.acquisition_dispute_defense (
  id bigserial primary key,
  listing_id uuid not null references arb.listings(id),
  defensibility_score numeric not null,
  seller_protection_score numeric not null,
  required_evidence jsonb not null default '[]'::jsonb,
  missing_evidence jsonb not null default '[]'::jsonb,
  recommended_action text not null check (recommended_action in ('PROCEED','REVIEW','BLOCK_UNTIL_EVIDENCE_COMPLETE')),
  reason_codes jsonb not null default '[]'::jsonb,
  evidence_json jsonb not null default '{}'::jsonb,
  correlation_id text,
  created_at timestamptz not null default now(),
  unique (listing_id, correlation_id)
);

alter table arb.decisions
  add column if not exists shipping_class text,
  add column if not exists outbound_shipping_usd numeric,
  add column if not exists packaging_cost_usd numeric,
  add column if not exists insurance_reserve_usd numeric,
  add column if not exists signature_reserve_usd numeric,
  add column if not exists return_reserve_usd numeric,
  add column if not exists dispute_reserve_usd numeric,
  add column if not exists damage_reserve_usd numeric,
  add column if not exists shipping_risk_score numeric,
  add column if not exists shipping_confidence_score numeric,
  add column if not exists description_quality_score numeric,
  add column if not exists return_probability numeric,
  add column if not exists dispute_probability numeric,
  add column if not exists return_risk_score numeric,
  add column if not exists defensibility_score numeric,
  add column if not exists seller_protection_score numeric,
  add column if not exists execution_integrity_score numeric,
  add column if not exists forensic_required_json jsonb not null default '[]'::jsonb,
  add column if not exists forensic_missing_json jsonb not null default '[]'::jsonb;

create index if not exists idx_acq_shipping_profile_listing_created on arb.acquisition_shipping_profile(listing_id, created_at desc);
create index if not exists idx_acq_listing_generation_listing_created on arb.acquisition_listing_generation(listing_id, created_at desc);
create index if not exists idx_acq_return_risk_listing_created on arb.acquisition_return_risk(listing_id, created_at desc);
create index if not exists idx_acq_forensic_chain_listing_event on arb.acquisition_forensic_chain(listing_id, event_type, created_at desc);
create index if not exists idx_acq_dispute_defense_listing_created on arb.acquisition_dispute_defense(listing_id, created_at desc);
create index if not exists idx_decisions_execution_integrity on arb.decisions(execution_integrity_score desc nulls last);
