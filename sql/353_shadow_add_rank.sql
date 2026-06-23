-- 353_shadow_add_rank.sql — add domain1_rank + refresh comparison view (live-only scoring is in the worker)
alter table arb.acquisition_shadow_decisions add column if not exists domain1_rank text;
drop view if exists arb.v_acquisition_shadow_comparison_daily;
create view arb.v_acquisition_shadow_comparison_daily as
select date_trunc('day', created_at)::date as day, count(*) total_scored,
  round(100.0*count(*) filter (where agreement_status in ('AGREE_BUY','AGREE_REJECT','AGREE_REVIEW'))/nullif(count(*),0),2) agreement_rate_pct,
  count(*) filter (where legacy_decision='BUY') legacy_buy,
  count(*) filter (where domain1_decision='BUY') domain1_buy,
  count(*) filter (where domain1_rank='BUY_A_PLUS') buy_a_plus,
  count(*) filter (where domain1_rank='BUY_A') buy_a,
  count(*) filter (where domain1_rank='BUY_B') buy_b,
  count(*) filter (where agreement_status='LEGACY_REJECT_DOMAIN1_BUY') legacy_reject_d1_buy,
  count(*) filter (where agreement_status='LEGACY_BUY_DOMAIN1_REVIEW') legacy_buy_d1_review,
  count(*) filter (where agreement_status='LEGACY_BUY_DOMAIN1_REJECT') legacy_buy_d1_reject,
  round(avg(profit_delta) filter (where profit_delta is not null),2) avg_profit_delta,
  round(avg(roi_delta) filter (where roi_delta is not null),6) avg_roi_delta,
  count(*) filter (where capital_safety_status is not null and capital_safety_status not in ('PASS','PASSED','ALLOW','ALLOWED','APPROVED')) capital_safety_failures,
  count(*) filter (where shipping_signal_status is distinct from 'shipengine') shipping_evidence_failures
from arb.acquisition_shadow_decisions group by 1 order by 1 desc;
