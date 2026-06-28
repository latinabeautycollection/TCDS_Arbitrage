#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="${APP_DIR:-/srv/arb-system/api}"
SCRIPT_NAME="scripts/preflight-capital-allocation.sh"
LOG_DIR="${APP_DIR}/logs/domain2"
LOG_FILE="${LOG_DIR}/preflight-capital-allocation.log"
WORKER_PATTERN="${CAPITAL_ALLOCATION_WORKER_PATTERN:-capital-allocation}"
MIN_NODE_MAJOR="${MIN_NODE_MAJOR:-20}"

mkdir -p "${LOG_DIR}"
: > "${LOG_FILE}"

log() {
  printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" | tee -a "${LOG_FILE}"
}

record_check() {
  local status="$1"
  local message="$2"

  psql "${DATABASE_URL}" \
    -v ON_ERROR_STOP=1 \
    -v check_status="${status}" \
    -v check_source="${SCRIPT_NAME}" \
    -v details_json="{\"message\":\"${message}\",\"log_file\":\"${LOG_FILE}\"}" <<'SQL' >/dev/null
select arb.record_capital_allocation_certification_check(
  'CAPITAL_ALLOCATION_PREFLIGHT',
  :'check_status',
  :'check_source',
  :'details_json'::jsonb
);
SQL
}

fail() {
  local message="$1"
  log "NO_GO: ${message}"
  record_check "FAIL" "${message}" || true
  exit 1
}

cd "${APP_DIR}" || exit 1

if [[ -f ".env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source ".env"
  set +a
fi

: "${DATABASE_URL:?DATABASE_URL missing}"

command -v node >/dev/null || fail "missing node"
command -v npm >/dev/null || fail "missing npm"
command -v psql >/dev/null || fail "missing psql"
command -v pm2 >/dev/null || fail "missing pm2"
command -v jq >/dev/null || fail "missing jq"

NODE_MAJOR="$(node -p "Number(process.versions.node.split('.')[0])")"
[[ "${NODE_MAJOR}" -ge "${MIN_NODE_MAJOR}" ]] || fail "Node ${MIN_NODE_MAJOR}+ required"

log "Recording preflight RUNNING"
record_check "RUNNING" "Domain 2 capital allocation preflight started"

log "Checking database objects and Domain 1 dependencies"
psql "${DATABASE_URL}" -v ON_ERROR_STOP=1 <<'SQL' >/dev/null
do $$
begin
  if to_regclass('arb.capital_allocation_policy') is null then raise exception 'missing arb.capital_allocation_policy'; end if;
  if to_regclass('arb.capital_allocation_runs') is null then raise exception 'missing arb.capital_allocation_runs'; end if;
  if to_regclass('arb.capital_allocation_items') is null then raise exception 'missing arb.capital_allocation_items'; end if;
  if to_regclass('arb.capital_allocation_dead_letter') is null then raise exception 'missing arb.capital_allocation_dead_letter'; end if;
  if to_regclass('arb.capital_allocation_certification_checks') is null then raise exception 'missing arb.capital_allocation_certification_checks'; end if;
  if to_regclass('arb.v_capital_allocation_latest') is null then raise exception 'missing arb.v_capital_allocation_latest'; end if;
  if to_regclass('arb.v_capital_allocation_readiness') is null then raise exception 'missing arb.v_capital_allocation_readiness'; end if;
  if to_regclass('arb.v_capital_allocation_latest_certification_checks') is null then raise exception 'missing arb.v_capital_allocation_latest_certification_checks'; end if;
  if to_regclass('arb.v_domain2_buy_qualified_source') is null then raise exception 'missing arb.v_domain2_buy_qualified_source'; end if;

  if to_regclass('arb.worker_heartbeats') is null then raise exception 'missing arb.worker_heartbeats'; end if;
  if to_regclass('arb.process_registry') is null then raise exception 'missing arb.process_registry'; end if;
  if to_regclass('arb.process_runs') is null then raise exception 'missing arb.process_runs'; end if;
  if to_regclass('arb.dead_letter') is null then raise exception 'missing arb.dead_letter'; end if;

  if to_regclass('arb.decisions') is null then raise exception 'missing arb.decisions'; end if;
  if to_regclass('arb.listings') is null then raise exception 'missing arb.listings'; end if;
  if to_regclass('arb.candidates') is null then raise exception 'missing arb.candidates'; end if;
  if to_regclass('arb.profit_analysis') is null then raise exception 'missing arb.profit_analysis'; end if;
  if to_regclass('arb.opportunity_queue') is null then raise exception 'missing arb.opportunity_queue'; end if;
  if to_regclass('arb.capital_safety_gate') is null then raise exception 'missing arb.capital_safety_gate'; end if;
  if to_regclass('arb.shipping_evidence') is null then raise exception 'missing arb.shipping_evidence'; end if;
end $$;
SQL

log "Checking policy sanity"
psql "${DATABASE_URL}" -v ON_ERROR_STOP=1 <<'SQL' >/dev/null
do $$
declare
  v_count int;
begin
  select count(*) into v_count
  from arb.capital_allocation_policy
  where id = 1
    and enabled is true
    and total_capital_usd > 0
    and reserve_pct >= 0
    and reserve_pct <= 0.90
    and max_per_item_usd > 0
    and max_category_exposure_pct > 0
    and max_category_exposure_pct <= 1
    and max_family_exposure_pct > 0
    and max_family_exposure_pct <= 1
    and min_buy_a_plus_score >= min_buy_a_score
    and min_buy_a_score >= min_buy_b_score;

  if v_count <> 1 then
    raise exception 'capital allocation policy is invalid, disabled, or missing';
  end if;
end $$;
SQL

log "Checking PM2 worker pattern: ${WORKER_PATTERN}"
pm2 jlist | jq -e --arg pattern "${WORKER_PATTERN}" '
  .[]
  | select((.name | test($pattern; "i")) and .pm2_env.status == "online")
' >/dev/null || fail "capital allocation PM2 worker is not online"

log "Running build"
npm run build >>"${LOG_FILE}" 2>&1 || fail "npm run build failed"

log "Running tests"
npm test >>"${LOG_FILE}" 2>&1 || fail "npm test failed"

log "Recording test suite PASS"
psql "${DATABASE_URL}" \
  -v ON_ERROR_STOP=1 \
  -v details_json="{\"message\":\"npm test passed\",\"log_file\":\"${LOG_FILE}\"}" <<'SQL' >/dev/null
select arb.record_capital_allocation_certification_check(
  'CAPITAL_ALLOCATION_TEST_SUITE',
  'PASS',
  'npm test',
  :'details_json'::jsonb
);
SQL

if node -e "const p=require('./package.json'); process.exit(p.scripts && p.scripts['certify:capital-allocation-replay'] ? 0 : 1)"; then
  log "Running replay certification"
  npm run certify:capital-allocation-replay >>"${LOG_FILE}" 2>&1 || fail "replay certification failed"

  psql "${DATABASE_URL}" \
    -v ON_ERROR_STOP=1 \
    -v details_json="{\"message\":\"replay certification passed\",\"log_file\":\"${LOG_FILE}\"}" <<'SQL' >/dev/null
select arb.record_capital_allocation_certification_check(
  'CAPITAL_ALLOCATION_REPLAY_SUITE',
  'PASS',
  'npm run certify:capital-allocation-replay',
  :'details_json'::jsonb
);
SQL
else
  fail "missing package script certify:capital-allocation-replay"
fi

STATUS="$(psql "${DATABASE_URL}" -t -A -c "select readiness_status from arb.v_capital_allocation_readiness limit 1;")"
ELIGIBLE="$(psql "${DATABASE_URL}" -t -A -c "select eligible_for_domain2_promotion_review::text from arb.v_capital_allocation_readiness limit 1;")"

if [[ "${STATUS}" != "GO_CAPITAL_ALLOCATION_READY" || "${ELIGIBLE}" != "true" ]]; then
  fail "readiness failed: ${STATUS}, eligible=${ELIGIBLE}"
fi

record_check "PASS" "Domain 2 capital allocation preflight passed"

echo "GO: capital allocation ready for human promotion review"
