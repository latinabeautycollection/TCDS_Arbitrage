-- 350_phase3_shadow_infra.sql — Domain 1 shadow-mode tables + comparison view
create table if not exists arb.acquisition_shadow_decisions (
  id bigserial primary key, opportunity_queue_id bigint, listing_id uuid not null, candidate_id bigint,
  policy_version text, legacy_decision text, legacy_reason_codes text[], legacy_risk_flags text[], legacy_max_bid numeric(12,2),
  domain1_decision text, domain1_reason_codes text[], domain1_risk_flags text[], domain1_confidence numeric(12,6), domain1_max_bid numeric(12,2),
  profit_delta numeric(12,2), roi_delta numeric(12,6), agreement_status text, capital_safety_status text, shipping_signal_status text,
  domain1_input_hash text, comparison_json jsonb not null default '{}'::jsonb, created_at timestamptz not null default now());
create index if not exists idx_acq_shadow_oq on arb.acquisition_shadow_decisions(opportunity_queue_id, created_at desc);
create index if not exists idx_acq_shadow_listing on arb.acquisition_shadow_decisions(listing_id, created_at desc);
create index if not exists idx_acq_shadow_agreement on arb.acquisition_shadow_decisions(agreement_status, created_at desc);
create index if not exists idx_acq_shadow_created on arb.acquisition_shadow_decisions(created_at desc);
create table if not exists arb.acquisition_shadow_claims (
  opportunity_queue_id bigint primary key, candidate_id bigint, listing_id uuid, claim_token uuid not null default gen_random_uuid(),
  claimed_by text, claimed_at timestamptz not null default now(), claim_expires_at timestamptz, last_status text, updated_at timestamptz not null default now());
create index if not exists idx_acq_shadow_claims_expiry on arb.acquisition_shadow_claims(claim_expires_at);
create or replace view arb.v_acquisition_shadow_comparison_daily as
select date_trunc('day', created_at)::date as day, count(*) total_scored,
  round(100.0*count(*) filter (where agreement_status in ('AGREE_BUY','AGREE_REJECT','AGREE_REVIEW'))/nullif(count(*),0),2) agreement_rate_pct,
  count(*) filter (where legacy_decision='BUY') legacy_buy, count(*) filter (where domain1_decision='BUY') domain1_buy,
  count(*) filter (where agreement_status='LEGACY_BUY_DOMAIN1_REVIEW') legacy_buy_d1_review,
  count(*) filter (where agreement_status='LEGACY_BUY_DOMAIN1_REJECT') legacy_buy_d1_reject,
  count(*) filter (where agreement_status='LEGACY_REJECT_DOMAIN1_BUY') legacy_reject_d1_buy,
  count(*) filter (where agreement_status='DOMAIN1_MORE_CONSERVATIVE') d1_more_conservative,
  count(*) filter (where agreement_status='DOMAIN1_MORE_AGGRESSIVE') d1_more_aggressive,
  round(avg(profit_delta) filter (where profit_delta is not null),2) avg_profit_delta,
  round(avg(roi_delta) filter (where roi_delta is not null),6) avg_roi_delta,
  count(*) filter (where capital_safety_status is not null and capital_safety_status not in ('PASS','PASSED','ALLOW','ALLOWED','APPROVED')) capital_safety_failures,
  count(*) filter (where shipping_signal_status is distinct from 'shipengine') shipping_evidence_failures,
  count(*) filter (where agreement_status='DATA_MISSING') missing_data_failures
from arb.acquisition_shadow_decisions group by 1 order by 1 desc;
