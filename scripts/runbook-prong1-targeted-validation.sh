#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="${APP_DIR:-/srv/arb-system/api}"
LOG_DIR="${APP_DIR}/logs/runbooks/prong1"
RUN_LOG="${LOG_DIR}/prong1-targeted-validation.log"

API_BASE_URL="${API_BASE_URL:-http://127.0.0.1:3101}"
DATABASE_URL="${DATABASE_URL:-}"
PSQL="${PSQL:-psql}"

PRONG1_WORKER_NAME="${PRONG1_WORKER_NAME:-comp-analysis-worker}"
PRONG1_START_CMD="${PRONG1_START_CMD:-node dist/workers/compAnalysisWorker.js}"
BUILD_CMD="${BUILD_CMD:-npm run build}"

TARGET_LISTING_COUNT="${TARGET_LISTING_COUNT:-10}"
HEARTBEAT_MAX_AGE_SECONDS="${HEARTBEAT_MAX_AGE_SECONDS:-180}"
WORKER_RUNTIME_SECONDS="${WORKER_RUNTIME_SECONDS:-90}"

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

cleanup_worker() {
  if [[ -n "${WORKER_PID:-}" ]]; then
    kill "${WORKER_PID}" >/dev/null 2>&1 || true
    wait "${WORKER_PID}" >/dev/null 2>&1 || true
  fi
}
trap cleanup_worker EXIT

[[ -n "${DATABASE_URL}" ]] || fail "DATABASE_URL is required"
[[ -n "${EBAY_CLIENT_ID:-}" ]] || fail "EBAY_CLIENT_ID is required"
[[ -n "${EBAY_CLIENT_SECRET:-}" ]] || fail "EBAY_CLIENT_SECRET is required"

cd "${APP_DIR}"

info "Build"
eval "${BUILD_CMD}"

info "API health"
assert_http_200 "/health"
assert_http_200 "/metrics"

info "Target listings before run"
run_sql "${LOG_DIR}/01_target_listings_before.txt" "
with target as (
  select
    id,
    listing_external_id,
    title,
    brand,
    model,
    category_key,
    category_id,
    current_price,
    current_bid_price,
    buy_now_price,
    inbound_shipping_usd,
    comp_status,
    comp_attempts,
    updated_at
  from arb.listings
  where platform::text = 'propertyroom'
  order by updated_at desc nulls last, created_at desc nulls last, id desc
  limit ${TARGET_LISTING_COUNT}
)
select * from target
order by updated_at desc nulls last, id desc;
"

info "Prong 1 state before run"
run_sql "${LOG_DIR}/02_prong1_state_before.txt" "
with target as (
  select id
  from arb.listings
  where platform::text = 'propertyroom'
  order by updated_at desc nulls last, created_at desc nulls last, id desc
  limit ${TARGET_LISTING_COUNT}
)
select
  l.id,
  l.listing_external_id,
  l.title,
  l.comp_status,
  l.comp_attempts,
  l.comp_locked_at,
  l.comp_locked_by,
  l.comp_started_at,
  l.comp_completed_at,
  l.comp_updated_at,
  l.next_comp_attempt_at,
  l.comp_last_error,
  l.comp_last_error_class,
  l.comp_result_json
from arb.listings l
join target t on t.id = l.id
order by l.id;
"

info "Start Prong 1 worker"
bash -lc "cd '${APP_DIR}' && ${PRONG1_START_CMD}" &
WORKER_PID=$!

sleep 10

info "Heartbeat check during run"
run_sql "${LOG_DIR}/03_prong1_heartbeat_during_run.txt" "
select
  worker_name,
  worker_instance_id,
  status,
  details_json,
  last_seen_at,
  floor(extract(epoch from now() - last_seen_at))::int as heartbeat_age_seconds
from arb.worker_heartbeats
where worker_name = '${PRONG1_WORKER_NAME}'
order by last_seen_at desc;
"

sleep "${WORKER_RUNTIME_SECONDS}"
cleanup_worker
unset WORKER_PID

info "Prong 1 market evidence"
run_sql "${LOG_DIR}/04_prong1_market_after.txt" "
with target as (
  select id
  from arb.listings
  where platform::text = 'propertyroom'
  order by updated_at desc nulls last, created_at desc nulls last, id desc
  limit ${TARGET_LISTING_COUNT}
)
select
  m.listing_id,
  m.query_text,
  m.sold_30d,
  m.active_count,
  m.median_sold_price,
  m.p25_sold_price,
  m.p75_sold_price,
  m.median_active_price,
  m.resale_anchor_price,
  m.liquidity_ratio,
  m.confidence,
  m.correlation_id,
  m.updated_at
from arb.ebay_market m
join target t on t.id = m.listing_id
order by m.updated_at desc, m.listing_id;
"

info "Prong 1 decision evidence"
run_sql "${LOG_DIR}/05_prong1_decisions_after.txt" "
with target as (
  select id
  from arb.listings
  where platform::text = 'propertyroom'
  order by updated_at desc nulls last, created_at desc nulls last, id desc
  limit ${TARGET_LISTING_COUNT}
)
select
  d.listing_id,
  d.decision::text as decision,
  d.confidence,
  d.expected_resale_usd,
  d.expected_net_usd,
  d.estimated_profit_usd,
  d.estimated_roi,
  d.max_bid_usd,
  d.reasons_json,
  d.risk_flags_json,
  d.correlation_id,
  d.updated_at
from arb.decisions d
join target t on t.id = d.listing_id
order by d.updated_at desc, d.listing_id;
"

info "Prong 1 listing state after run"
run_sql "${LOG_DIR}/06_prong1_state_after.txt" "
with target as (
  select id
  from arb.listings
  where platform::text = 'propertyroom'
  order by updated_at desc nulls last, created_at desc nulls last, id desc
  limit ${TARGET_LISTING_COUNT}
)
select
  l.id,
  l.listing_external_id,
  l.title,
  l.comp_status,
  l.comp_attempts,
  l.comp_locked_at,
  l.comp_locked_by,
  l.comp_started_at,
  l.comp_completed_at,
  l.comp_updated_at,
  l.next_comp_attempt_at,
  l.comp_last_error,
  l.comp_last_error_class,
  l.comp_result_json
from arb.listings l
join target t on t.id = l.id
order by l.id;
"

info "Prong 1 dead letters"
run_sql "${LOG_DIR}/07_prong1_dead_letters_after.txt" "
with target as (
  select id
  from arb.listings
  where platform::text = 'propertyroom'
  order by updated_at desc nulls last, created_at desc nulls last, id desc
  limit ${TARGET_LISTING_COUNT}
)
select
  dl.id,
  dl.listing_id,
  dl.failure_reason,
  dl.failure_class,
  dl.error_json,
  dl.created_at
from arb.comp_dead_letter dl
join target t on t.id = dl.listing_id
order by dl.created_at desc;
"

info "Prong 1 idempotency proof"
run_sql "${LOG_DIR}/08_prong1_idempotency.txt" "
with target as (
  select id
  from arb.listings
  where platform::text = 'propertyroom'
  order by updated_at desc nulls last, created_at desc nulls last, id desc
  limit ${TARGET_LISTING_COUNT}
)
select
  'ebay_market' as table_name,
  count(*) as row_count,
  count(distinct listing_id) as distinct_listing_count
from arb.ebay_market
where listing_id in (select id from target)

union all

select
  'decisions' as table_name,
  count(*) as row_count,
  count(distinct listing_id) as distinct_listing_count
from arb.decisions
where listing_id in (select id from target);
"

echo
echo "PRONG1_RUNBOOK_COMPLETE"
echo "Review artifacts in ${LOG_DIR}"
