\echo '═══════════════════════════════════════════════════'
\echo '  DATA QUALITY SNAPSHOT — Live Pipeline Health      '
\echo '═══════════════════════════════════════════════════'

\echo ''
\echo '── 1. Ingestion freshness (PropertyRoom feed) ──'
SELECT 
  COUNT(*) AS total_listings,
  COUNT(*) FILTER (WHERE created_at > now() - interval '24 hours') AS new_24h,
  COUNT(*) FILTER (WHERE created_at > now() - interval '1 hour') AS new_1h,
  to_char(MAX(created_at), 'YYYY-MM-DD HH24:MI') AS latest_ingestion
FROM arb.listings;

\echo ''
\echo '── 2. PRONG1 throughput (last 24h) ──'
SELECT 
  comp_status,
  COUNT(*) AS rows,
  ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 1) AS pct
FROM arb.listings
WHERE comp_completed_at > now() - interval '24 hours'
   OR comp_locked_at > now() - interval '24 hours'
GROUP BY comp_status
ORDER BY rows DESC;

\echo ''
\echo '── 3. Identity coverage (current state) ──'
SELECT
  COUNT(*) AS total,
  ROUND(100.0 * COUNT(*) FILTER (WHERE brand IS NOT NULL) / COUNT(*), 1) AS pct_with_brand,
  ROUND(100.0 * COUNT(*) FILTER (WHERE comp_result_json -> 'product' -> 'epid' IS NOT NULL) / COUNT(*), 1) AS pct_with_epid,
  ROUND(100.0 * COUNT(*) FILTER (WHERE brand IS NOT NULL AND model IS NOT NULL) / COUNT(*), 1) AS pct_with_brand_and_model
FROM arb.listings;

\echo ''
\echo '── 4. Decision distribution (post-Patch-2) ──'
SELECT 
  comp_result_json ->> 'decision' AS decision,
  COUNT(*) AS rows,
  ROUND(AVG((comp_result_json ->> 'estimatedProfitUsd')::numeric), 2) AS avg_profit_usd,
  ROUND(AVG((comp_result_json ->> 'estimatedRoi')::numeric * 100), 1) AS avg_roi_pct
FROM arb.listings
WHERE comp_completed_at > '2026-04-27 22:00:00+00'
  AND comp_status = 'completed'
GROUP BY decision
ORDER BY rows DESC;

\echo ''
\echo '── 5. Pricing tier usage (post-Patch-2) ──'
SELECT 
  comp_result_json ->> 'pricingMethod' AS method,
  COUNT(*) AS rows,
  ROUND(AVG((comp_result_json ->> 'expectedResaleUsd')::numeric), 2) AS avg_resale
FROM arb.listings
WHERE comp_completed_at > '2026-04-27 22:00:00+00'
  AND comp_status = 'completed'
  AND comp_result_json ->> 'pricingMethod' IS NOT NULL
GROUP BY method
ORDER BY rows DESC;

\echo ''
\echo '── 6. Comp match-score quality (last 24h) ──'
SELECT 
  CASE 
    WHEN overall_comp_score >= 0.95 THEN '1. EXACT (>=0.95)'
    WHEN overall_comp_score >= 0.85 THEN '2. STRONG (0.85-0.94)'
    WHEN overall_comp_score >= 0.70 THEN '3. GOOD (0.70-0.84)'
    WHEN overall_comp_score >= 0.50 THEN '4. WEAK (0.50-0.69)'
    ELSE '5. POOR (<0.50)'
  END AS band,
  COUNT(*) AS comps,
  ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 1) AS pct
FROM arb.ebay_comps
WHERE created_at > now() - interval '24 hours'
GROUP BY band
ORDER BY band;

\echo ''
\echo '── 7. PRONG2 drainer health ──'
SELECT
  (SELECT COUNT(*) FROM arb.opportunity_queue WHERE status='queued') AS queued,
  (SELECT COUNT(*) FROM arb.opportunity_queue WHERE status='reviewed') AS reviewed,
  (SELECT COUNT(*) FROM arb.opportunity_queue WHERE status='passed') AS passed,
  (SELECT COUNT(*) FROM arb.profit_decision) AS decisions_total,
  (SELECT COUNT(*) FROM arb.profit_decision WHERE decision_status='BUY') AS prong2_buys,
  (SELECT COUNT(*) FROM arb.profit_decision WHERE decision_status='WATCH') AS prong2_watches;

\echo ''
\echo '── 8. eBay API error rate (last 6h, comp worker) ──'
SELECT 
  COUNT(*) AS total_listings_attempted,
  COUNT(*) FILTER (WHERE comp_status='completed') AS succeeded,
  COUNT(*) FILTER (WHERE comp_status='dead_letter') AS dead_lettered,
  COUNT(*) FILTER (WHERE comp_last_error_class='SERVER') AS server_errors,
  COUNT(*) FILTER (WHERE comp_last_error_class='TOKEN') AS token_errors
FROM arb.listings
WHERE (comp_completed_at > now() - interval '6 hours' 
       OR comp_locked_at > now() - interval '6 hours');

\echo ''
\echo '── 9. OAuth health ──'
SELECT 
  account_label,
  is_active,
  refresh_token IS NOT NULL AS has_refresh,
  ROUND(EXTRACT(EPOCH FROM (access_expires_at - now())) / 60, 1) AS access_min_left,
  ROUND(EXTRACT(EPOCH FROM (refresh_expires_at - now())) / 86400, 1) AS refresh_days_left,
  request_fail_count
FROM arb.ebay_oauth_tokens
WHERE environment='production' AND is_active=true;

\echo ''
\echo '── 10. Recent BUY/WATCH listings (top 10 by profit) ──'
SELECT 
  substring(l.title, 1, 40) AS title,
  l.brand,
  l.comp_result_json ->> 'pricingMethod' AS method,
  l.comp_result_json ->> 'decision' AS decision,
  (l.comp_result_json ->> 'estimatedProfitUsd')::numeric AS profit,
  ROUND((l.comp_result_json ->> 'estimatedRoi')::numeric * 100, 1) AS roi_pct,
  l.comp_completed_at::date AS completed
FROM arb.listings l
WHERE l.comp_status='completed'
  AND l.comp_result_json ->> 'decision' IN ('BUY', 'WATCH')
  AND l.comp_completed_at > '2026-04-27 22:00:00+00'
ORDER BY (l.comp_result_json ->> 'estimatedProfitUsd')::numeric DESC NULLS LAST
LIMIT 10;
