-- Domain 4 V4 Enterprise Listing Intelligence Platform
-- Additive only. Does not replace existing arb.ebay_listing_draft / arb.ebay_listing source-of-truth tables.

create table if not exists arb.listing_ai_route_performance (
  id bigint generated always as identity primary key,
  provider text not null check (provider in ('openai','claude','gemini')),
  task_name text not null,
  category_specialist text not null,
  success_rate numeric not null default 1.0,
  average_quality_score numeric not null default 0.75,
  average_latency_ms numeric not null default 1000,
  average_cost_usd numeric not null default 0,
  sample_count integer not null default 0,
  is_enabled boolean not null default true,
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(provider, task_name, category_specialist)
);

create table if not exists arb.product_digital_twin (
  id bigint generated always as identity primary key,
  source_listing_normalized_id bigint not null unique references arb.listing_normalized(id),
  candidate_id bigint references arb.candidates(id),
  listing_id uuid references arb.listings(id),
  ebay_listing_fk bigint references arb.ebay_listing(id),
  category_key text,
  ebay_category_id text,
  twin_json jsonb not null default '{}'::jsonb,
  identity_confidence_score numeric,
  conversion_score numeric,
  risk_score numeric,
  process_run_id uuid references arb.process_runs(run_id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists arb.listing_multi_objective_scores (
  id bigint generated always as identity primary key,
  ebay_listing_draft_fk bigint references arb.ebay_listing_draft(id),
  ebay_listing_fk bigint references arb.ebay_listing(id),
  source_listing_normalized_id bigint references arb.listing_normalized(id),
  seo_score numeric not null,
  conversion_score numeric not null,
  profit_score numeric not null,
  risk_adjusted_score numeric not null,
  account_health_score numeric not null,
  velocity_score numeric not null,
  total_score numeric not null,
  objective_weights_json jsonb not null default '{}'::jsonb,
  explanation_json jsonb not null default '[]'::jsonb,
  process_run_id uuid references arb.process_runs(run_id),
  created_at timestamptz not null default now()
);

create table if not exists arb.listing_learning_signal (
  id bigint generated always as identity primary key,
  ebay_listing_fk bigint references arb.ebay_listing(id),
  source_listing_normalized_id bigint references arb.listing_normalized(id),
  signal_name text not null,
  signal_value numeric not null,
  interpretation text,
  process_run_id uuid references arb.process_runs(run_id),
  created_at timestamptz not null default now()
);

create table if not exists arb.listing_autonomous_revision_recommendation (
  id bigint generated always as identity primary key,
  ebay_listing_fk bigint not null references arb.ebay_listing(id),
  revision_type text not null check (revision_type in ('PRICE','TITLE','DESCRIPTION','SPECIFICS','STATUS')),
  recommendation_status text not null default 'PENDING_REVIEW' check (recommendation_status in ('PENDING_REVIEW','APPROVED','REJECTED','APPLIED','EXPIRED')),
  reason text not null,
  old_value jsonb,
  new_value jsonb not null default '{}'::jsonb,
  expected_impact_score numeric not null default 0,
  human_approval_required boolean not null default true,
  process_run_id uuid references arb.process_runs(run_id),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by text
);

create table if not exists arb.listing_knowledge_edges (
  id bigint generated always as identity primary key,
  from_entity_type text not null,
  from_entity_pk text not null,
  to_entity_type text not null,
  to_entity_pk text not null,
  edge_type text not null,
  evidence_json jsonb not null default '{}'::jsonb,
  process_run_id uuid references arb.process_runs(run_id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(from_entity_type, from_entity_pk, to_entity_type, to_entity_pk, edge_type)
);

insert into arb.process_registry(process_name, phase_no, process_group, description, owner_team)
values
('domain4_listing_enterprise_generate', 3, 'DOMAIN_4_LISTING', 'Enterprise AI listing generation with digital twin, model routing, SEO, photo intelligence, and human safety gates', 'TCDS'),
('domain4_listing_closed_loop_learning', 3, 'DOMAIN_4_LISTING', 'Closed-loop learning from live listing performance, returns, disputes, and conversion evidence', 'TCDS'),
('domain4_listing_autonomous_optimization', 3, 'DOMAIN_4_LISTING', 'Autonomous listing optimization recommendations after publication', 'TCDS'),
('domain4_listing_knowledge_graph', 3, 'DOMAIN_4_LISTING', 'Knowledge graph connections across sourcing, catalog, listing, shipping, returns, disputes, and profit', 'TCDS')
on conflict(process_name) do update set active_flag=true, updated_at=now();

insert into arb.listing_ai_route_performance(provider, task_name, category_specialist, success_rate, average_quality_score, average_latency_ms, average_cost_usd, sample_count)
values
('openai','title_generation','generic',1,0.82,1500,0.03,1),
('openai','description_generation','generic',1,0.84,2200,0.05,1),
('claude','compliance_review','generic',1,0.86,2400,0.05,1),
('gemini','photo_validation','generic',1,0.80,2100,0.04,1)
on conflict(provider, task_name, category_specialist) do nothing;
