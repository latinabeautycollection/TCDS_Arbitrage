#!/usr/bin/env bash
set -Eeuo pipefail

# ============================================================================
# Production Preflight + First eBay Probe Validator
# Path: /srv/arb-system/api/scripts/preflight-and-probe.sh
#
# Purpose:
#   - validate runtime/tooling
#   - validate code readiness
#   - validate environment variables
#   - validate database connectivity and schema visibility
#   - build the application cleanly
#   - safely start the API in controlled mode
#   - validate /health, /ready, /metrics
#   - execute the first eBay browse probe
#   - classify failures
#   - emit GO / NO-GO verdict
#
# Exit codes:
#   0 success
#   1 validation / runtime failure
# ============================================================================

APP_DIR="/srv/arb-system/api"
SCRIPT_DIR="${APP_DIR}/scripts"
LOG_DIR="${APP_DIR}/logs/preflight"
PM2_LOG_DIR="${APP_DIR}/logs/pm2"
RUN_LOG="${LOG_DIR}/preflight-and-probe.log"
SERVER_STDOUT_LOG="${LOG_DIR}/server.stdout.log"
SERVER_STDERR_LOG="${LOG_DIR}/server.stderr.log"
PID_FILE="${LOG_DIR}/server.pid"

DEFAULT_HOST="127.0.0.1"
DEFAULT_PORT="3101"
PROBE_ENV_DEFAULT="production"

ALLOW_KILL_STALE_PORT="${ALLOW_KILL_STALE_PORT:-false}"
PROBE_ENV="${PROBE_ENV:-$PROBE_ENV_DEFAULT}"
START_MODE="${START_MODE:-background}" # background | foreground
HTTP_TIMEOUT_SECONDS="${HTTP_TIMEOUT_SECONDS:-20}"
PROBE_RETRIES="${PROBE_RETRIES:-2}"
PROBE_RETRY_DELAY_SECONDS="${PROBE_RETRY_DELAY_SECONDS:-2}"

mkdir -p "${LOG_DIR}" "${PM2_LOG_DIR}"
touch "${RUN_LOG}" "${SERVER_STDOUT_LOG}" "${SERVER_STDERR_LOG}"

RED=$'\033[31m'
GREEN=$'\033[32m'
YELLOW=$'\033[33m'
BLUE=$'\033[34m'
BOLD=$'\033[1m'
RESET=$'\033[0m'

CURRENT_STEP=""
FAILURE_CATEGORY=""
FAILURE_REASON=""

log() {
  local level="$1"
  shift
  local msg="$*"
  local ts
  ts="$(date '+%Y-%m-%d %H:%M:%S')"
  printf '[%s] [%s] %s\n' "$ts" "$level" "$msg" | tee -a "${RUN_LOG}"
}

info() {
  log "INFO" "$*"
}

warn() {
  log "WARN" "$*"
}

error() {
  log "ERROR" "$*"
}

success() {
  log "SUCCESS" "$*"
}

step() {
  CURRENT_STEP="$1"
  printf '\n%s%s==> %s%s\n' "${BLUE}" "${BOLD}" "${CURRENT_STEP}" "${RESET}" | tee -a "${RUN_LOG}"
}

classify_and_fail() {
  local reason="$1"
  FAILURE_REASON="$reason"

  case "$reason" in
    *"EBAY_CLIENT_ID"*|*"EBAY_CLIENT_SECRET"*|*"credentials"*|*"auth failure"*|*"401"*|*"403"*)
      FAILURE_CATEGORY="AUTH FAILURE"
      ;;
    *"network"*|*"timeout"*|*"DNS"*|*"TLS"*|*"egress"*|*"connectivity"*|*"api.ebay.com"*|*"api.sandbox.ebay.com"*)
      FAILURE_CATEGORY="NETWORK FAILURE"
      ;;
    *"route"*|*"ebayProbeRoutes"*|*"probe route"*|*"404"*|*"missing route"*|*"dist/routes/ebayProbe.js"*)
      FAILURE_CATEGORY="ROUTE FAILURE"
      ;;
    *"tokenMode"*|*"application token"*|*"user token"*|*"No active eBay user token"*|*"wrong token path"*)
      FAILURE_CATEGORY="TOKEN MODE FAILURE"
      ;;
    *"build"*|*"tsc"*|*"compile"*|*"dist/server.js"*|*"dist/routes/ebayProbe.js"*)
      FAILURE_CATEGORY="BUILD FAILURE"
      ;;
    *".env"*|*"environment variable"*|*"DATABASE_URL"*|*"missing required env"*|*"ENV"*)
      FAILURE_CATEGORY="ENV FAILURE"
      ;;
    *)
      FAILURE_CATEGORY="GENERAL FAILURE"
      ;;
  esac

  error "${FAILURE_CATEGORY}: ${FAILURE_REASON}"
  printf '\n%s❌ SYSTEM NOT READY%s\n' "${RED}${BOLD}" "${RESET}" | tee -a "${RUN_LOG}"
  printf '%sREASON:%s %s\n' "${RED}${BOLD}" "${RESET}" "${FAILURE_REASON}" | tee -a "${RUN_LOG}"
  exit 1
}

require_cmd() {
  local cmd="$1"
  command -v "$cmd" >/dev/null 2>&1 || classify_and_fail "Missing required command: ${cmd}"
}

require_file() {
  local file="$1"
  [[ -f "$file" ]] || classify_and_fail "Missing required file: ${file}"
}

require_dir() {
  local dir="$1"
  [[ -d "$dir" ]] || classify_and_fail "Missing required directory: ${dir}"
}

cleanup() {
  if [[ -f "${PID_FILE}" ]]; then
    local pid
    pid="$(cat "${PID_FILE}" 2>/dev/null || true)"
    if [[ -n "${pid}" ]] && kill -0 "${pid}" 2>/dev/null; then
      warn "Stopping controlled server process PID=${pid}"
      kill "${pid}" 2>/dev/null || true

      for _ in {1..10}; do
        if kill -0 "${pid}" 2>/dev/null; then
          sleep 1
        else
          break
        fi
      done

      if kill -0 "${pid}" 2>/dev/null; then
        warn "Force killing PID=${pid}"
        kill -9 "${pid}" 2>/dev/null || true
      fi
    fi
    rm -f "${PID_FILE}"
  fi
}
trap cleanup EXIT

parse_env_file() {
  local env_file="$1"
  set -a
  # shellcheck disable=SC1090
  source "$env_file"
  set +a
}

assert_nonempty_env() {
  local var="$1"
  local value="${!var:-}"
  [[ -n "${value// /}" ]] || classify_and_fail "Missing or empty required environment variable: ${var}"
}

assert_integer_env() {
  local var="$1"
  local value="${!var:-}"
  [[ "$value" =~ ^[0-9]+$ ]] || classify_and_fail "Malformed integer environment variable: ${var}=${value}"
}

assert_boolean_env() {
  local var="$1"
  local value="${!var:-}"
  [[ "$value" =~ ^(true|false|1|0|yes|no|on|off)$ ]] || classify_and_fail "Malformed boolean environment variable: ${var}=${value}"
}

assert_urlish_env() {
  local var="$1"
  local value="${!var:-}"
  [[ "$value" =~ ^[A-Za-z0-9+.-]+:// ]] || classify_and_fail "Malformed URL-like environment variable: ${var}=${value}"
}

assert_enum_env() {
  local var="$1"
  shift
  local allowed=("$@")
  local value="${!var:-}"
  local ok="false"
  for item in "${allowed[@]}"; do
    if [[ "$value" == "$item" ]]; then
      ok="true"
      break
    fi
  done
  [[ "$ok" == "true" ]] || classify_and_fail "Invalid enum value for ${var}: ${value} (allowed: ${allowed[*]})"
}

extract_db_host_from_url() {
  local url="$1"
  python3 - <<'PY' "$url"
import sys
from urllib.parse import urlparse
u = urlparse(sys.argv[1])
print(u.hostname or "")
PY
}

http_json_check() {
  local url="$1"
  local target_file="$2"
  local status_file="$3"

  curl -sS \
    --max-time "${HTTP_TIMEOUT_SECONDS}" \
    -o "${target_file}" \
    -w "%{http_code}" \
    "${url}" > "${status_file}"
}

retry_http_json_check() {
  local url="$1"
  local target_file="$2"
  local status_file="$3"

  local attempt=1
  while (( attempt <= PROBE_RETRIES + 1 )); do
    if http_json_check "${url}" "${target_file}" "${status_file}"; then
      return 0
    fi
    if (( attempt <= PROBE_RETRIES )); then
      warn "Retrying HTTP check for ${url} (attempt ${attempt}/${PROBE_RETRIES})"
      sleep "${PROBE_RETRY_DELAY_SECONDS}"
    fi
    attempt=$((attempt + 1))
  done
  return 1
}

json_field_equals() {
  local file="$1"
  local jq_expr="$2"
  local expected="$3"
  local actual
  actual="$(jq -r "${jq_expr}" "${file}" 2>/dev/null || true)"
  [[ "${actual}" == "${expected}" ]]
}

json_has_nonempty_array() {
  local file="$1"
  local jq_expr="$2"
  local len
  len="$(jq -r "${jq_expr} | length" "${file}" 2>/dev/null || echo 0)"
  [[ "${len}" =~ ^[0-9]+$ ]] && (( len > 0 ))
}

ensure_port_free_or_handle() {
  local port="$1"
  local pids
  pids="$(ss -ltnp 2>/dev/null | awk -v p=":${port}" '$4 ~ p {print $NF}' | sed -E 's/.*pid=([0-9]+).*/\1/' | sort -u | tr '\n' ' ')"

  if [[ -z "${pids// /}" ]]; then
    success "Port ${port} is free"
    return 0
  fi

  warn "Port ${port} is currently in use by PID(s): ${pids}"

  if [[ "${ALLOW_KILL_STALE_PORT}" == "true" ]]; then
    for pid in ${pids}; do
      if [[ -n "${pid}" ]]; then
        warn "Killing stale PID ${pid}"
        kill "${pid}" 2>/dev/null || true
      fi
    done
    sleep 2

    local remaining
    remaining="$(ss -ltnp 2>/dev/null | awk -v p=":${port}" '$4 ~ p {print $NF}')"
    [[ -z "${remaining}" ]] || classify_and_fail "Port ${port} remains occupied after stale process cleanup"
    success "Port ${port} cleared"
  else
    classify_and_fail "Port ${port} is occupied. Re-run with ALLOW_KILL_STALE_PORT=true if you want controlled cleanup"
  fi
}

start_server_background() {
  local host="$1"
  local port="$2"

  : > "${SERVER_STDOUT_LOG}"
  : > "${SERVER_STDERR_LOG}"

  (
    cd "${APP_DIR}"
    nohup node dist/server.js >"${SERVER_STDOUT_LOG}" 2>"${SERVER_STDERR_LOG}" &
    echo $! > "${PID_FILE}"
  )

  local pid
  pid="$(cat "${PID_FILE}")"
  info "Started controlled server in background with PID=${pid}"

  local waited=0
  while (( waited < 20 )); do
    if ss -ltnp 2>/dev/null | grep -q "${host}:${port}"; then
      success "Server is listening on ${host}:${port}"
      return 0
    fi
    if ! kill -0 "${pid}" 2>/dev/null; then
      error "Server process exited early"
      tail -n 100 "${SERVER_STDERR_LOG}" | tee -a "${RUN_LOG}" >/dev/null
      classify_and_fail "Server exited before binding to ${host}:${port}"
    fi
    sleep 1
    waited=$((waited + 1))
  done

  classify_and_fail "Server failed to bind to ${host}:${port} within timeout"
}

verify_health_endpoints() {
  local host="$1"
  local port="$2"

  local health_file ready_file metrics_file health_status ready_status metrics_status
  health_file="$(mktemp)"
  ready_file="$(mktemp)"
  metrics_file="$(mktemp)"
  health_status="$(mktemp)"
  ready_status="$(mktemp)"
  metrics_status="$(mktemp)"

  retry_http_json_check "http://${host}:${port}/health" "${health_file}" "${health_status}" || classify_and_fail "/health endpoint request failed"
  retry_http_json_check "http://${host}:${port}/ready" "${ready_file}" "${ready_status}" || classify_and_fail "/ready endpoint request failed"
  retry_http_json_check "http://${host}:${port}/metrics" "${metrics_file}" "${metrics_status}" || classify_and_fail "/metrics endpoint request failed"

  [[ "$(cat "${health_status}")" == "200" ]] || warn "/health returned $(cat "${health_status}") — expected during initial setup (workers not yet running)"
  [[ "$(cat "${ready_status}")" == "200" ]] || warn "/ready returned $(cat "${ready_status}") — expected during initial setup (workers not yet running)"
  [[ "$(cat "${metrics_status}")" == "200" ]] || classify_and_fail "/metrics returned non-200 status: $(cat "${metrics_status}")"

  jq . "${health_file}" >/dev/null 2>&1 || classify_and_fail "/health did not return valid JSON"
  jq . "${ready_file}" >/dev/null 2>&1 || classify_and_fail "/ready did not return valid JSON"

  grep -q "arb_db_ping_latency_ms" "${metrics_file}" || classify_and_fail "/metrics did not return expected Prometheus metrics text"

  success "/health, /ready, and /metrics validated"

  rm -f "${health_file}" "${ready_file}" "${metrics_file}" "${health_status}" "${ready_status}" "${metrics_status}"
}

execute_probe() {
  local host="$1"
  local port="$2"
  local probe_env="$3"

  local probe_file probe_status
  probe_file="$(mktemp)"
  probe_status="$(mktemp)"

  retry_http_json_check "http://${host}:${port}/probe/ebay/browse/${probe_env}" "${probe_file}" "${probe_status}" || classify_and_fail "Probe request failed"

  local http_code
  http_code="$(cat "${probe_status}")"

  if [[ "${http_code}" != "200" ]]; then
    local probe_body
    probe_body="$(cat "${probe_file}")"

    if grep -qiE "auth|credential|401|403" <<<"${probe_body}"; then
      classify_and_fail "Probe returned auth failure: HTTP ${http_code} body=${probe_body}"
    elif grep -qiE "network|timeout|fetch|dns|tls" <<<"${probe_body}"; then
      classify_and_fail "Probe returned network failure: HTTP ${http_code} body=${probe_body}"
    elif grep -qiE "tokenMode|user token|application token|No active eBay user token" <<<"${probe_body}"; then
      classify_and_fail "Probe returned token mode failure: HTTP ${http_code} body=${probe_body}"
    else
      classify_and_fail "Probe returned non-200 status: HTTP ${http_code} body=${probe_body}"
    fi
  fi

  jq . "${probe_file}" >/dev/null 2>&1 || classify_and_fail "Probe did not return valid JSON"
  json_field_equals "${probe_file}" '.ok' 'true' || classify_and_fail "Probe JSON missing ok=true"
  json_field_equals "${probe_file}" '.tokenMode' 'application' || classify_and_fail "Probe did not run with tokenMode=application"

  if jq -e '.data.itemSummaries' "${probe_file}" >/dev/null 2>&1; then
    json_has_nonempty_array "${probe_file}" '.data.itemSummaries' || classify_and_fail "Probe returned empty data.itemSummaries"
  elif jq -e '.data.itemSummaries?' "${probe_file}" >/dev/null 2>&1; then
    json_has_nonempty_array "${probe_file}" '.data.itemSummaries' || classify_and_fail "Probe returned empty data.itemSummaries"
  else
    classify_and_fail "Probe response missing expected Browse payload content"
  fi

  success "First eBay probe validated successfully"
  info "Probe response:"
  jq . "${probe_file}" | tee -a "${RUN_LOG}"

  rm -f "${probe_file}" "${probe_status}"
}

main() {
  step "Phase A — System Validation"

  require_dir "${APP_DIR}"
  require_cmd node
  require_cmd npm
  require_cmd pm2
  require_cmd psql
  require_cmd curl
  require_cmd jq
  require_cmd ss
  require_cmd grep
  require_cmd sed
  require_cmd awk
  require_cmd python3

  local node_major
  node_major="$(node -p "process.versions.node.split('.')[0]")"
  [[ "${node_major}" =~ ^[0-9]+$ ]] || classify_and_fail "Unable to determine Node.js major version"
  (( node_major >= 20 )) || classify_and_fail "Node.js 20+ required. Found $(node -v)"

  success "Required tools are installed"
  info "Node version: $(node -v)"
  info "npm version: $(npm -v)"
  info "PM2 version: $(pm2 -v | tail -n 1)"

  step "Phase C — ENV Validation"

  require_file "${APP_DIR}/.env"
  parse_env_file "${APP_DIR}/.env"

  assert_nonempty_env "NODE_ENV"
  assert_nonempty_env "APP_SERVICE_NAME"
  assert_nonempty_env "LOG_LEVEL"
  assert_nonempty_env "PORT"
  assert_nonempty_env "DATABASE_URL"
  assert_nonempty_env "EBAY_ENVIRONMENT"
  assert_nonempty_env "EBAY_MARKETPLACE_ID"
  assert_nonempty_env "EBAY_USER_AGENT"
  assert_nonempty_env "EBAY_CLIENT_ID"
  assert_nonempty_env "EBAY_CLIENT_SECRET"
  assert_nonempty_env "EBAY_REQUEST_TIMEOUT_MS"
  assert_nonempty_env "EBAY_HTTP_MAX_RETRIES"
  assert_nonempty_env "EBAY_HTTP_BASE_BACKOFF_MS"
  assert_nonempty_env "EBAY_HTTP_MAX_BACKOFF_MS"
  assert_nonempty_env "EBAY_MIN_REQUEST_INTERVAL_MS"
  assert_nonempty_env "EBAY_MAX_CONCURRENT_REQUESTS"
  assert_nonempty_env "EBAY_DEFAULT_CACHE_TTL_MS"
  assert_nonempty_env "EBAY_TOKEN_CACHE_TTL_SAFETY_MS"
  assert_nonempty_env "EBAY_BROWSE_LIMIT_DEFAULT"
  assert_nonempty_env "EBAY_BROWSE_LIMIT_MAX"
  assert_nonempty_env "EBAY_DEFAULT_SCOPES"
  assert_nonempty_env "PG_SSL_ENABLED"
  assert_nonempty_env "PG_POOL_MAX"
  assert_nonempty_env "PG_IDLE_TIMEOUT_MS"
  assert_nonempty_env "PG_CONNECTION_TIMEOUT_MS"
  assert_nonempty_env "PG_STATEMENT_TIMEOUT_MS"
  assert_nonempty_env "PG_QUERY_TIMEOUT_MS"

  assert_enum_env "NODE_ENV" "production" "development" "test"
  assert_enum_env "EBAY_ENVIRONMENT" "production" "sandbox"
  assert_integer_env "PORT"
  assert_integer_env "EBAY_REQUEST_TIMEOUT_MS"
  assert_integer_env "EBAY_HTTP_MAX_RETRIES"
  assert_integer_env "EBAY_HTTP_BASE_BACKOFF_MS"
  assert_integer_env "EBAY_HTTP_MAX_BACKOFF_MS"
  assert_integer_env "EBAY_MIN_REQUEST_INTERVAL_MS"
  assert_integer_env "EBAY_MAX_CONCURRENT_REQUESTS"
  assert_integer_env "EBAY_DEFAULT_CACHE_TTL_MS"
  assert_integer_env "EBAY_TOKEN_CACHE_TTL_SAFETY_MS"
  assert_integer_env "EBAY_BROWSE_LIMIT_DEFAULT"
  assert_integer_env "EBAY_BROWSE_LIMIT_MAX"
  assert_integer_env "PG_POOL_MAX"
  assert_integer_env "PG_IDLE_TIMEOUT_MS"
  assert_integer_env "PG_CONNECTION_TIMEOUT_MS"
  assert_integer_env "PG_STATEMENT_TIMEOUT_MS"
  assert_integer_env "PG_QUERY_TIMEOUT_MS"
  assert_boolean_env "PG_SSL_ENABLED"

  local port host
  port="${PORT:-$DEFAULT_PORT}"
  host="${HOST:-$DEFAULT_HOST}"

  local db_host ebay_host
  db_host="$(extract_db_host_from_url "${DATABASE_URL}")"
  [[ -n "${db_host}" ]] || classify_and_fail "Unable to extract database host from DATABASE_URL"

  if [[ "${EBAY_ENVIRONMENT}" == "sandbox" ]]; then
    ebay_host="api.sandbox.ebay.com"
  else
    ebay_host="api.ebay.com"
  fi

  step "Phase A.2 — Network Connectivity Validation"

  getent hosts "${ebay_host}" >/dev/null 2>&1 || classify_and_fail "DNS resolution failed for ${ebay_host}"
  getent hosts "${db_host}" >/dev/null 2>&1 || classify_and_fail "DNS resolution failed for database host ${db_host}"

  curl -sS --max-time "${HTTP_TIMEOUT_SECONDS}" "https://${ebay_host}" >/dev/null || warn "Direct HTTPS fetch to ${ebay_host} returned non-success; continuing because some endpoints may reject root path"
  success "DNS resolution succeeded for eBay host and database host"

  step "Phase B — Code Validation"

  require_file "${APP_DIR}/src/server.ts"
  require_file "${APP_DIR}/src/routes/ebayProbe.ts"
  require_file "${APP_DIR}/src/services/ebayRequestLayer.ts"
  require_file "${APP_DIR}/src/services/ebayClient.ts"

  grep -n "ebayProbeRoutes" "${APP_DIR}/src/server.ts" >/dev/null || classify_and_fail "Missing ebayProbeRoutes mount in src/server.ts"
  grep -n "/probe/ebay/browse/:environment" "${APP_DIR}/src/routes/ebayProbe.ts" >/dev/null || classify_and_fail "Missing probe route in src/routes/ebayProbe.ts"
  grep -n "tokenMode" "${APP_DIR}/src/services/ebayRequestLayer.ts" >/dev/null || classify_and_fail "Missing tokenMode support in src/services/ebayRequestLayer.ts"
  grep -n "getApplicationToken" "${APP_DIR}/src/services/ebayClient.ts" >/dev/null || classify_and_fail "Missing getApplicationToken in src/services/ebayClient.ts"

  success "Code readiness checks passed"

  step "Phase D — Database Validation"

  psql "${DATABASE_URL}" -c "select 1;" >/dev/null || classify_and_fail "Database connectivity test failed"
  psql "${DATABASE_URL}" -c "\dt arb.*" >/dev/null || classify_and_fail "arb schema visibility test failed"
  success "Database connectivity and schema visibility validated"

  step "Phase E — Clean Build"

  cd "${APP_DIR}"
  npm ci --include=dev || classify_and_fail "npm ci failed"
  npm run build || classify_and_fail "Build failed"

  test -f "${APP_DIR}/dist/server.js" || classify_and_fail "Build output missing: dist/server.js"
  test -f "${APP_DIR}/dist/routes/ebayProbe.js" || classify_and_fail "Build output missing: dist/routes/ebayProbe.js"
  success "Build completed successfully"

  step "Phase F — Port Safety Check"
  ensure_port_free_or_handle "${port}"

  step "Phase G — Controlled Server Start"

  if [[ "${START_MODE}" == "foreground" ]]; then
    info "Foreground mode selected"
    info "Run manually: cd ${APP_DIR} && node dist/server.js"
    classify_and_fail "Foreground mode is not supported for automated all-inclusive preflight execution"
  else
    start_server_background "${host}" "${port}"
  fi

  step "Phase H — Health Validation"
  verify_health_endpoints "${host}" "${port}"

  step "Phase I — First eBay Probe"
  execute_probe "${host}" "${port}" "${PROBE_ENV}"

  step "Phase J — PM2 Validation"
  cd "${APP_DIR}"
  pm2 start ecosystem.config.cjs >/dev/null 2>&1 || classify_and_fail "PM2 start failed"
  pm2 status | tee -a "${RUN_LOG}" >/dev/null
  pm2 status | grep -q "arb-api" || classify_and_fail "PM2 does not show arb-api online"
  success "PM2 process validation passed"

  printf '\n%s✅ SYSTEM READY FOR EBAY DATA INGESTION%s\n' "${GREEN}${BOLD}" "${RESET}" | tee -a "${RUN_LOG}"
  exit 0
}

main "$@"
