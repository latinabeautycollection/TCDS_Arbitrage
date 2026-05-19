\echo '════════════════════════════════════════════════════════'
\echo '  QA Certification — PRONG1 + PRONG2 (post-2026-04-28)  '
\echo '════════════════════════════════════════════════════════'
\echo ''

\echo '--- TEST 1: PRONG1 — Catalog enrichment coverage ---'
\echo '(Of completed listings with non-REJECT decisions, how many have epid populated?)'
SELECT
  COUNT(*) FILTER (WHERE comp_result_json -> 'product' -> 'epid' IS NOT NULL) AS with_epid,
  COUNT(*) AS actionable_completed,
  ROUND(
    100.0 * COUNT(*) FILTER (WHERE comp_result_json -> 'product' -> 'epid' IS NOT NULL)
    / NULLIF(COUNT(*), 0),
    1
  ) AS pct_enriched,
  CASE
    WHEN COUNT(*) FILTER (WHERE comp_result_json -> 'product' -> 'epid' IS NOT NULL) >= COUNT(*) * 0.50 THEN 'PASS'
    WHEN COUNT(*) FILTER (WHERE comp_result_json -> 'product' -> 'epid' IS NOT NULL) >= COUNT(*) * 0.20 THEN 'PARTIAL'
    ELSE 'FAIL'
  END AS verdict
FROM arb.listings
WHERE comp_status = 'completed'
  AND comp_completed_at >= '2026-04-27 22:00:00+00'
  AND comp_result_json -> 'decision' IN ('"BUY"'::jsonb, '"WATCH"'::jsonb);


\echo ''
\echo '--- TEST 2: PRONG1 — Pricing tier distribution ---'
\echo '(All three tiers should appear with non-zero counts)'
SELECT
  comp_result_json ->> 'pricingMethod' AS method,
  COUNT(*) AS rows,
  ROUND(AVG((comp_result_json ->> 'expectedResaleUsd')::numeric), 2) AS avg_resale_usd,
  COUNT(*) FILTER (WHERE comp_result_json ->> 'decision' = 'BUY') AS buy_count,
  COUNT(*) FILTER (WHERE comp_result_json ->> 'decision' = 'WATCH') AS watch_count,
  COUNT(*) FILTER (WHERE comp_result_json ->> 'decision' = 'REJECT') AS reject_count
FROM arb.listings
WHERE comp_status = 'completed'
  AND comp_result_json ->> 'pricingMethod' IS NOT NULL
GROUP BY 1
ORDER BY 1;

\echo ''
\echo '--- TEST 3: PRONG2 — Drain health ---'
\echo '(profit_decision rows + queue status counts)'
SELECT
  (SELECT COUNT(*) FROM arb.profit_decision) AS profit_decisions,
  (SELECT COUNT(*) FROM arb.opportunity_queue WHERE status = 'queued') AS queued,
  (SELECT COUNT(*) FROM arb.opportunity_queue WHERE status = 'reviewed') AS reviewed,
  (SELECT COUNT(*) FROM arb.opportunity_queue WHERE status = 'passed') AS passed,
  (SELECT COUNT(*) FROM arb.opportunity_queue WHERE status = 'purchased') AS purchased;

\echo ''
\echo '--- TEST 4: PRONG1 ↔ PRONG2 decision consistency ---'
\echo '(Every BUY/WATCH/REJECT in profit_decision should match the listing comp_result_json.decision)'
SELECT
  pd.decision_status AS prong2_decision,
  l.comp_result_json ->> 'decision' AS prong1_decision,
  COUNT(*) AS rows,
  CASE
    WHEN pd.decision_status = (l.comp_result_json ->> 'decision') THEN 'CONSISTENT'
    ELSE 'MISMATCH'
  END AS verdict
FROM arb.profit_decision pd
JOIN arb.candidates c ON c.id = pd.listing_id
JOIN arb.listings l ON l.id = c.listing_id
GROUP BY pd.decision_status, l.comp_result_json ->> 'decision'
ORDER BY rows DESC;

\echo ''
\echo '--- TEST 5: PRONG2 — Math sanity (net_profit recomputation) ---'
\echo '(Reconstruct from inputs and compare to stored value; tolerance $0.10)'
SELECT
  pd.id,
  pd.decision_status,
  pd.estimated_resale_price AS resale,
  pd.propertyroom_price AS pr_price,
  pd.estimated_total_cost AS stored_total_cost,
  ROUND(
    pd.propertyroom_price + pd.propertyroom_shipping
    + pd.estimated_ebay_fee + pd.estimated_payment_fee
    + pd.estimated_packaging_cost + pd.estimated_other_costs,
    2
  ) AS recomputed_total_cost,
  pd.estimated_net_profit AS stored_profit,
  ROUND(pd.estimated_resale_price - (
    pd.propertyroom_price + pd.propertyroom_shipping
    + pd.estimated_ebay_fee + pd.estimated_payment_fee
    + pd.estimated_packaging_cost + pd.estimated_other_costs
  ), 2) AS recomputed_profit,
  CASE
    WHEN ABS(pd.estimated_net_profit - (pd.estimated_resale_price - (
      pd.propertyroom_price + pd.propertyroom_shipping
      + pd.estimated_ebay_fee + pd.estimated_payment_fee
      + pd.estimated_packaging_cost + pd.estimated_other_costs
    ))) <= 0.10 THEN 'PASS'
    ELSE 'FAIL'
  END AS verdict
FROM arb.profit_decision pd
ORDER BY pd.decided_at DESC
LIMIT 10;

\echo ''
\echo '--- TEST 6: OAuth token health ---'
SELECT
  account_label,
  CASE WHEN length(access_token) > 1000 THEN 'OK' ELSE 'TOO_SHORT' END AS access_token_len_check,
  CASE WHEN length(refresh_token) > 50 THEN 'OK' ELSE 'MISSING' END AS refresh_token_check,
  ROUND(EXTRACT(EPOCH FROM (access_expires_at - now())) / 60, 1) AS access_minutes_left,
  ROUND(EXTRACT(EPOCH FROM (refresh_expires_at - now())) / 86400, 1) AS refresh_days_left,
  is_active,
  request_fail_count
FROM arb.ebay_oauth_tokens
WHERE environment = 'production'
ORDER BY created_at DESC
LIMIT 5;

\echo ''
\echo '════════════════════════════════════════════════════════'
\echo '  AGGREGATE CERTIFICATION SCORE (0–100)                  '
\echo '════════════════════════════════════════════════════════'
WITH scores AS (
  SELECT
    -- Test 1: enrichment coverage on actionable listings (max 25)
        LEAST(25, ROUND(25.0 * (
      SELECT COALESCE(COUNT(*) FILTER (WHERE comp_result_json -> 'product' -> 'epid' IS NOT NULL)::numeric
                      / NULLIF(COUNT(*), 0), 0)
      FROM arb.listings
      WHERE comp_status='completed'
        AND comp_completed_at >= '2026-04-27 22:00:00+00'
        AND comp_result_json -> 'decision' IN ('"BUY"'::jsonb, '"WATCH"'::jsonb)
    ))) AS s_enrichment,
    -- Test 2: pricing tier presence (15 if all 3 tiers represented; 8 if 2; 0 if 1)
    (SELECT
       CASE COUNT(DISTINCT comp_result_json ->> 'pricingMethod')
         WHEN 0 THEN 0
         WHEN 1 THEN 0
         WHEN 2 THEN 8
         ELSE 15
       END
     FROM arb.listings
     WHERE comp_status='completed'
       AND comp_result_json ->> 'pricingMethod' IN ('sold_median','active_max','active_median')
    ) AS s_pricing,

    -- Test 3: PRONG2 drain operational (20 if has decisions; else 0)
    CASE WHEN (SELECT COUNT(*) FROM arb.profit_decision) > 0 THEN 20 ELSE 0 END AS s_prong2_active,

    -- Test 4: decision consistency (20 if 100% match, scaled otherwise)
    LEAST(20, ROUND(20.0 * COALESCE((
      SELECT
        COUNT(*) FILTER (WHERE pd.decision_status = (l.comp_result_json ->> 'decision'))::numeric
        / NULLIF(COUNT(*), 0)
      FROM arb.profit_decision pd
      JOIN arb.candidates c ON c.id = pd.listing_id
      JOIN arb.listings l ON l.id = c.listing_id
    ), 0))) AS s_consistency,

    -- Test 5: math sanity (10 if all sample rows pass)
    CASE WHEN (
      SELECT COUNT(*)
      FROM arb.profit_decision pd
      WHERE ABS(pd.estimated_net_profit - (pd.estimated_resale_price - (
        pd.propertyroom_price + pd.propertyroom_shipping
        + pd.estimated_ebay_fee + pd.estimated_payment_fee
        + pd.estimated_packaging_cost + pd.estimated_other_costs
      ))) > 0.10
    ) = 0 THEN 10 ELSE 0 END AS s_math,

    -- Test 6: OAuth health (10 if active token + refresh token present + access ttl > 10min)
    CASE WHEN EXISTS (
      SELECT 1 FROM arb.ebay_oauth_tokens
      WHERE environment='production'
        AND is_active = true
        AND length(refresh_token) > 50
        AND access_expires_at > now() + interval '10 minutes'
    ) THEN 10 ELSE 0 END AS s_oauth
)
SELECT
  s_enrichment,
  s_pricing,
  s_prong2_active,
  s_consistency,
  s_math,
  s_oauth,
  (s_enrichment + s_pricing + s_prong2_active + s_consistency + s_math + s_oauth) AS total_score_100,
  CASE
    WHEN (s_enrichment + s_pricing + s_prong2_active + s_consistency + s_math + s_oauth) >= 90 THEN 'GREEN_PASS'
    WHEN (s_enrichment + s_pricing + s_prong2_active + s_consistency + s_math + s_oauth) >= 70 THEN 'YELLOW_NEEDS_TUNING'
    WHEN (s_enrichment + s_pricing + s_prong2_active + s_consistency + s_math + s_oauth) >= 50 THEN 'ORANGE_PARTIAL'
    ELSE 'RED_FAIL'
  END AS certification_band
FROM scores;
