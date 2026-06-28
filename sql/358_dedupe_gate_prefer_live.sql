
-- sql/358: dedupe gate picks a LIVE candidate as PRIMARY (ended listings no longer block live ones)
CREATE OR REPLACE FUNCTION arb.refresh_candidate_dedupe_gate()
 RETURNS integer LANGUAGE sql AS $function$
  with g as (
    select c.id, c.listing_id, c.canonical_product_key as k,
           coalesce(c.identity_confidence,0) as ic,
           count(*) over (partition by c.canonical_product_key) as gs,
           row_number() over (partition by c.canonical_product_key
                              order by (l.end_time > now()) desc nulls last,
                                       coalesce(c.identity_confidence,0) desc, c.id asc) as rk
    from arb.candidates c
    left join arb.listings l on l.id = c.listing_id
    where c.canonical_product_key is not null and c.canonical_product_key <> ''
  ), ups as (
    insert into arb.candidate_dedupe_gate
      (dedupe_key,candidate_id,listing_id,group_size,rank_in_group,gate_status,reason_json,created_at,updated_at)
    select g.k,g.id,g.listing_id,g.gs,g.rk,
      case when g.rk=1 then 'PRIMARY' else 'DUPLICATE_BLOCKED' end,
      jsonb_build_object('dedupe_reason','ONE_PRIMARY_PER_DEDUPE_KEY_PREFER_LIVE','auto',true,
                         'identity_confidence',g.ic,'group_size',g.gs,'rank_in_group',g.rk),
      now(),now()
    from g
    on conflict (candidate_id) do update set
      dedupe_key=excluded.dedupe_key, listing_id=excluded.listing_id, group_size=excluded.group_size,
      rank_in_group=excluded.rank_in_group, gate_status=excluded.gate_status,
      reason_json=excluded.reason_json, updated_at=now()
    returning 1
  ) select count(*)::int from ups;
$function$;
