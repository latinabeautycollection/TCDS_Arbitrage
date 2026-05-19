#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="${APP_DIR:-/srv/arb-system/api}"
LOG_DIR="${APP_DIR}/logs/runbooks/prong2"
RUN_LOG="${LOG_DIR}/prong2-targeted-validation.log"

API_BASE_URL="${API_BASE_URL:-http://127.0.0.1:3101}"
DATABASE_URL="${DATABASE_URL:-}"

MARKET_INTEL_START_CMD="${MARKET_INTEL_START_CMD:-node dist/workers/marketIntelWorker.js}"
WATCHLIST_START_CMD="${WATCHLIST_START_CMD:-node dist/workers/watchlistWorker.js}"
OPPORTUNITY_START_CMD="${OPPORTUNITY_START_CMD:-node dist/workers/opportunityQueueWorker.js}"
BUILD_CMD="${BUILD_CMD:-npm run build}"

MARKET_INTEL_WORKER_NAME="${MARKET_INTEL_WORKER_NAME:-market-intel-worker}"
WATCHLIST_WORKER_NAME="${WATCHLIST_WORKER_NAME:-watchlist-worker}"
OPPORTUNITY_QUEUE_WORKER_NAME="${OPPORTUNITY_QUEUE_WORKER_NAME:-opportunity-queue-worker}"

MARKET_RUNTIME_SECONDS="${MARKET_RUNTIME_SECONDS:-90}"
WATCHLIST_RUNTIME_SECONDS="${WATCHLIST_RUNTIME_SECONDS:-45}"
OPPORTUNITY_RUNTIME_SECONDS="${OPPORTUNITY_RUNTIME_SECONDS:-45}"

mkdir -p "${LOG_DIR}"
exec > >(tee -a "${RUN_LOG}") 2>&1

fail() {
  echo "[FAIL] $*"
  exit 1
}

info() {
  echo
  echo "[INFO] $*"
}

run_sql() {
  local outfile="$1"
  shift
  psql "${DATABASE_URL}" -X -v ON_ERROR_STOP=1 -P pager=off -c "$@" | tee "${outfile}"
}

assert_http_200() {
  local path="$1"
  local code
  code="$(curl -sS -o /dev/null -w "%{http_code}" "${API_BASE_URL}${path}")"
  [[ "${code}" == "200" || "${code}" == "503" ]] || fail "Expected 200 for ${path}, got ${code}"
}

cleanup_pid() {
  local pid="${1:-}"
  if [[ -n "${pid}" ]]; then
    kill "${pid}" >/dev/null 2>&1 || true
    wait "${pid}" >/dev/null 2>&1 || true
  fi
}

cleanup_all() {
  cleanup_pid "${PID_MARKET:-}"
  cleanup_pid "${PID_WATCHLIST:-}"
  cleanup_pid "${PID_OPPORTUNITY:-}"
}
trap cleanup_all EXIT

[[ -n "${DATABASE_URL}" ]] || fail "DATABASE_URL is required"
[[ -n "${EBAY_CLIENT_ID:-}" ]] || fail "EBAY_CLIENT_ID is required"
[[ -n "${EBAY_CLIENT_SECRET:-}" ]] || fail "EBAY_CLIENT_SECRET is required"

cd "${APP_DIR}"

info "Build"
eval "${BUILD_CMD}"

info "API health"
assert_http_200 "/health"
assert_http_200 "/metrics"

info "Active strategies before run"
run_sql "${LOG_DIR}/01_active_strategies_before.txt" "
select
  id,
  category_key,
  category_name,
  ebay_category_id,
  priority,
  is_active,
  metric_name,
  max_products_per_run,
  min_price_usd,
  max_price_usd,
  min_demand_score,
  min_predicted_profit_usd,
  min_margin_pct,
  include_keywords,
  exclude_keywords
from arb.market_category_strategy
where is_active = true
order by priority asc, id asc
limit 10;
"

info "Start market intel worker"
bash -lc "cd '${APP_DIR}' && ${MARKET_INTEL_START_CMD}" &
PID_MARKET=$!
sleep 10

run_sql "${LOG_DIR}/02_market_heartbeat_during_run.txt" "
select
  worker_name,
  worker_instance_id,
  status,
  details_json,
  last_seen_at,
  floor(extract(epoch from now() - last_seen_at))::int as heartbeat_age_seconds
from arb.worker_heartbeats
where worker_name = '${MARKET_INTEL_WORKER_NAME}'
order by last_seen_at desc;
"

sleep "${MARKET_RUNTIME_SECONDS}"
cleanup_pid "${PID_MARKET}"
unset PID_MARKET

info "Market intel outputs"
run_sql "${LOG_DIR}/03_market_intel_runs_after.txt" "
select
  id,
  strategy_id,
  status,
  api_source,
  metric_name,
  requested_product_count,
  received_product_count,
  correlation_id,
  error_code,
  error_message,
  started_at,
  completed_at,
  created_at,
  updated_at
from arb.market_intel_runs
order by id desc
limit 25;
"

run_sql "${LOG_DIR}/04_snapshots_after.txt" "
select
  id,
  run_id,
  strategy_id,
  category_key,
  ebay_category_id,
  metric_name,
  item_count,
  avg_price_usd,
  median_price_usd,
  snapshot_taken_at,
  created_at
from arb.ebay_market_snapshots
order by id desc
limit 25;
"

run_sql "${LOG_DIR}/05_snapshot_products_after.txt" "
select
  id,
  run_id,
  snapshot_id,
  strategy_id,
  category_key,
  family_key,
  family_name,
  brand,
  model_family,
  demand_score,
  price_stability_score,
  competition_score,
  propertyroom_supply_fit_score,
  predicted_buy_cost_usd,
  predicted_sale_price_usd,
  predicted_profit_usd,
  predicted_margin_pct,
  overall_watch_score,
  status,
  rejection_reason_code,
  claim_token,
  claimed_at,
  claimed_by,
  claim_expires_at,
  process_attempts,
  updated_at
from arb.market_snapshot_products
order by id desc
limit 100;
"

info "Start watchlist worker"
bash -lc "cd '${APP_DIR}' && ${WATCHLIST_START_CMD}" &
PID_WATCHLIST=$!
sleep 10

run_sql "${LOG_DIR}/06_watchlist_heartbeat_during_run.txt" "
select
  worker_name,
  worker_instance_id,
  status,
  details_json,
  last_seen_at,
  floor(extract(epoch from now() - last_seen_at))::int as heartbeat_age_seconds
from arb.worker_heartbeats
where worker_name = '${WATCHLIST_WORKER_NAME}'
order by last_seen_at desc;
"

sleep "${WATCHLIST_RUNTIME_SECONDS}"
cleanup_pid "${PID_WATCHLIST}"
unset PID_WATCHLIST

run_sql "${LOG_DIR}/07_watchlist_after.txt" "
select
  id,
  strategy_id,
  category_key,
  family_key,
  family_name,
  brand,
  model_family,
  keyword_fingerprint,
  demand_score,
  price_stability_score,
  competition_score,
  propertyroom_supply_fit_score,
  profitability_score,
  overall_watch_score,
  predicted_buy_cost_usd,
  predicted_sale_price_usd,
  predicted_profit_usd,
  predicted_margin_pct,
  status,
  activation_reason_json,
  last_seen_at,
  updated_at
from arb.product_watchlist
order by updated_at desc nulls last, id desc
limit 100;
"

info "Start opportunity queue worker"
bash -lc "cd '${APP_DIR}' && ${OPPORTUNITY_START_CMD}" &
PID_OPPORTUNITY=$!
sleep 10

run_sql "${LOG_DIR}/08_opportunity_heartbeat_during_run.txt" "
select
  worker_name,
  worker_instance_id,
  status,
  details_json,
  last_seen_at,
  floor(extract(epoch from now() - last_seen_at))::int as heartbeat_age_seconds
from arb.worker_heartbeats
where worker_name = '${OPPORTUNITY_QUEUE_WORKER_NAME}'
order by last_seen_at desc;
"

sleep "${OPPORTUNITY_RUNTIME_SECONDS}"
cleanup_pid "${PID_OPPORTUNITY}"
unset PID_OPPORTUNITY

run_sql "${LOG_DIR}/09_candidates_after.txt" "
select
  id,
  listing_id,
  status,
  rejection_reason_code,
  rejection_reason_detail,
  brand,
  model,
  title,
  normalized_title,
  source_category_key,
  current_price,
  inbound_shipping_usd,
  candidate_confidence,
  claim_token,
  claimed_at,
  claimed_by,
  claim_expires_at,
  process_attempts,
  process_last_error,
  process_last_error_at,
  matched_watchlist_id,
  matched_at,
  updated_at
from arb.candidates
order by updated_at desc nulls last, id desc
limit 100;
"

run_sql "${LOG_DIR}/10_opportunity_queue_after.txt" "
select
  id,
  candidate_id,
  watchlist_id,
  match_score,
  priority_score,
  status,
  reason_json,
  created_at,
  updated_at
from arb.opportunity_queue
order by updated_at desc nulls last, id desc
limit 100;
"

run_sql "${LOG_DIR}/11_opportunity_queue_idempotency.txt" "
select
  candidate_id,
  watchlist_id,
  count(*) as active_pair_count
from arb.opportunity_queue
where status in ('queued', 'reviewed', 'purchased')
group by candidate_id, watchlist_id
having count(*) > 1
order by active_pair_count desc, candidate_id, watchlist_id;
"

run_sql "${LOG_DIR}/12_prong2_dead_letter_after.txt" "
select
  id,
  worker_name,
  entity_type,
  entity_id,
  failure_code,
  failure_message,
  payload,
  created_at
from arb.prong2_dead_letter
order by created_at desc
limit 100;
"

info "Readiness / metrics capture"
curl -sS "${API_BASE_URL}/metrics" | tee "${LOG_DIR}/13_metrics.txt" >/dev/null
curl -sS -i "${API_BASE_URL}/ready" | tee "${LOG_DIR}/14_ready.txt" >/dev/null
curl -sS "${API_BASE_URL}/health" | tee "${LOG_DIR}/15_health.json" >/dev/null

echo
echo "PRONG2_RUNBOOK_COMPLETE"
echo "Review artifacts in ${LOG_DIR}"
