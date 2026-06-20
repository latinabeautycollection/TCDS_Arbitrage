-- 352_msp_scored_index_retention.sql — market_snapshot_products claim index + 30d retention purge
create index concurrently if not exists idx_msp_scored_score
  on arb.market_snapshot_products (overall_watch_score desc nulls last, id asc) where status = 'scored';
do $$ begin perform cron.unschedule('purge-msp-scored-rejected-30d'); exception when others then null; end $$;
select cron.schedule('purge-msp-scored-rejected-30d','15 3 * * *',
  $cron$delete from arb.market_snapshot_products where status in ('scored','rejected') and created_at < now() - interval '30 days' and (claim_expires_at is null or claim_expires_at < now())$cron$);
