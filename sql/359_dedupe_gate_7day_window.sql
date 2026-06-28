
-- sql/359: dedupe gate = prefer-live primary + 7-day window (drops listings ended >7d). Testing setting.
CREATE OR REPLACE FUNCTION arb.refresh_candidate_dedupe_gate()
 RETURNS integer LANGUAGE plpgsql AS $function$
 DECLARE n int;
 BEGIN
   -- remove gate rows for listings ended more than 7 days ago
   DELETE FROM arb.candidate_dedupe_gate cdg
   USING arb.listings l
   WHERE cdg.listing_id = l.id AND l.end_time IS NOT NULL AND l.end_time <= now() - interval '7 days';

   WITH g AS (
     SELECT c.id, c.listing_id, c.canonical_product_key AS k,
            coalesce(c.identity_confidence,0) AS ic,
            count(*) OVER (PARTITION BY c.canonical_product_key) AS gs,
            row_number() OVER (PARTITION BY c.canonical_product_key
                               ORDER BY (l.end_time > now()) DESC NULLS LAST,
                                        coalesce(c.identity_confidence,0) DESC, c.id ASC) AS rk
     FROM arb.candidates c
     LEFT JOIN arb.listings l ON l.id = c.listing_id
     WHERE c.canonical_product_key IS NOT NULL AND c.canonical_product_key <> ''
       AND (l.end_time IS NULL OR l.end_time > now() - interval '7 days')
   )
   INSERT INTO arb.candidate_dedupe_gate
     (dedupe_key,candidate_id,listing_id,group_size,rank_in_group,gate_status,reason_json,created_at,updated_at)
   SELECT g.k,g.id,g.listing_id,g.gs,g.rk,
     CASE WHEN g.rk=1 THEN 'PRIMARY' ELSE 'DUPLICATE_BLOCKED' END,
     jsonb_build_object('dedupe_reason','PREFER_LIVE_7D_WINDOW','auto',true,
                        'identity_confidence',g.ic,'group_size',g.gs,'rank_in_group',g.rk),
     now(),now()
   FROM g
   ON CONFLICT (candidate_id) DO UPDATE SET
     dedupe_key=excluded.dedupe_key, listing_id=excluded.listing_id, group_size=excluded.group_size,
     rank_in_group=excluded.rank_in_group, gate_status=excluded.gate_status,
     reason_json=excluded.reason_json, updated_at=now();

   GET DIAGNOSTICS n = ROW_COUNT;
   RETURN n;
 END;
 $function$;
