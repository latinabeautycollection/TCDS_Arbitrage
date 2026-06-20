-- 351_candidate_dedupe_gate_populator.sql — populates candidate_dedupe_gate (one PRIMARY per canonical_product_key)
create or replace function arb.refresh_candidate_dedupe_gate() returns integer language sql as $func$
  with g as (
    select c.id, c.listing_id, c.canonical_product_key as k, coalesce(c.identity_confidence,0) as ic,
           count(*) over (partition by c.canonical_product_key) as gs,
           row_number() over (partition by c.canonical_product_key order by coalesce(c.identity_confidence,0) desc, c.id asc) as rk
    from arb.candidates c where c.canonical_product_key is not null and c.canonical_product_key <> ''
  ), ups as (
    insert into arb.candidate_dedupe_gate (dedupe_key,candidate_id,listing_id,group_size,rank_in_group,gate_status,reason_json,created_at,updated_at)
    select g.k,g.id,g.listing_id,g.gs,g.rk, case when g.rk=1 then 'PRIMARY' else 'DUPLICATE_BLOCKED' end,
      jsonb_build_object('dedupe_reason','ONE_PRIMARY_PER_DEDUPE_KEY','auto',true,'identity_confidence',g.ic,'group_size',g.gs,'rank_in_group',g.rk), now(),now()
    from g on conflict (candidate_id) do update set dedupe_key=excluded.dedupe_key, listing_id=excluded.listing_id,
      group_size=excluded.group_size, rank_in_group=excluded.rank_in_group, gate_status=excluded.gate_status, reason_json=excluded.reason_json, updated_at=now()
    returning 1) select count(*)::int from ups;
$func$;
select arb.refresh_candidate_dedupe_gate();  -- initial backfill
do $$ begin perform cron.unschedule('refresh-candidate-dedupe-gate'); exception when others then null; end $$;
select cron.schedule('refresh-candidate-dedupe-gate','7 * * * *', $cron$select arb.refresh_candidate_dedupe_gate();$cron$);
