#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="${APP_DIR:-/srv/arb-system/api}"
SCRIPT_NAME="scripts/preflight-domain1-promotion.sh"
LOG_DIR="${APP_DIR}/logs/domain1"
LOG_FILE="${LOG_DIR}/preflight-domain1-promotion.log"
DOMAIN1_WORKER_NAME_PATTERN="${DOMAIN1_WORKER_NAME_PATTERN:-acquisition|domain1}"
MIN_NODE_MAJOR="${MIN_NODE_MAJOR:-20}"

mkdir -p "${LOG_DIR}"
: > "${LOG_FILE}"

CAN_RECORD_CHECKS="false"
PREFLIGHT_COMPLETED="false"

log() {
  printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" | tee -a "${LOG_FILE}"
}

record_check() {
  local check_name="$1"
  local check_status="$2"
  local check_source="$3"
  local message="$4"
  local exit_code="${5:-0}"
  local details_json="${6:-}"
  [[ -z "${details_json}" ]] && details_json="{}"

  if [[ "${CAN_RECORD_CHECKS}" != "true" ]]; then
    log "CHECK_NOT_RECORDED ${check_name}=${check_status}: ${message}"
    return 0
  fi

  psql "${DATABASE_URL}" \
    -v ON_ERROR_STOP=1 \
    -v check_name="${check_name}" \
    -v check_status="${check_status}" \
    -v check_source="${check_source}" \
    -v message="${message}" \
    -v log_file="${LOG_FILE}" \
    -v exit_code="${exit_code}" \
    -v details_json="${details_json}" <<'SQL' >/dev/null
select arb.record_domain1_promotion_check(
  :'check_name',
  :'check_status',
  :'check_source',
  :'message',
  :'log_file',
  :'exit_code'::int,
  :'details_json'::jsonb
);
SQL
}

fail() {
  local check_name="${1:-DOMAIN1_PREFLIGHT}"
  local message="${2:-preflight failed}"
  local exit_code="${3:-1}"

  log "NO_GO: ${message}"
  record_check "${check_name}" "FAIL" "${SCRIPT_NAME}" "${message}" "${exit_code}" || true
  exit "${exit_code}"
}

unexpected_failure_trap() {
  local exit_code=$?
  local line_no="${1:-unknown}"

  if [[ "${PREFLIGHT_COMPLETED}" != "true" ]]; then
    log "UNEXPECTED_FAILURE at line ${line_no}, exit_code=${exit_code}"
    record_check \
      "DOMAIN1_PREFLIGHT" \
      "FAIL" \
      "${SCRIPT_NAME}" \
      "unexpected script failure at line ${line_no}" \
      "${exit_code}" \
      "{\"line\":\"${line_no}\"}" || true
  fi

  exit "${exit_code}"
}

trap 'unexpected_failure_trap ${LINENO}' ERR

pass_check() {
  local check_name="$1"
  local source="$2"
  local message="$3"
  record_check "${check_name}" "PASS" "${source}" "${message}" 0
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "DOMAIN1_PREFLIGHT" "missing required command: $1" 127
}

validate_node_version() {
  local node_major
  node_major="$(node -p "Number(process.versions.node.split('.')[0])")"

  if [[ "${node_major}" -lt "${MIN_NODE_MAJOR}" ]]; then
    fail "DOMAIN1_PREFLIGHT" "Node.js ${MIN_NODE_MAJOR}+ required; found $(node -v)" 1
  fi

  log "Node version OK: $(node -v)"
}

package_script_exists() {
  local script_name="$1"
  node -e "
    const fs = require('fs');
    const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
    process.exit(pkg.scripts && pkg.scripts['${script_name}'] ? 0 : 1);
  "
}

run_required_step() {
  local check_name="$1"
  local source="$2"
  shift 2

  log "Running ${source}"

  set +e
  "$@" >>"${LOG_FILE}" 2>&1
  local exit_code=$?
  set -e

  if [[ "${exit_code}" -eq 0 ]]; then
    pass_check "${check_name}" "${source}" "${source} completed successfully"
  else
    record_check "${check_name}" "FAIL" "${source}" "${source} failed" "${exit_code}" || true
    fail "${check_name}" "${source} failed" "${exit_code}"
  fi
}

strict_db_object_checks() {
  log "Checking required DB objects"

  psql "${DATABASE_URL}" -v ON_ERROR_STOP=1 <<'SQL' >/dev/null
do $$
begin
  if to_regclass('arb.domain1_promotion_certification_checks') is null then
    raise exception 'Missing table: arb.domain1_promotion_certification_checks';
  end if;

  if to_regclass('arb.domain1_runtime_state') is null then
    raise exception 'Missing table: arb.domain1_runtime_state';
  end if;

  if to_regclass('arb.acquisition_shadow_decisions') is null then
    raise exception 'Missing table: arb.acquisition_shadow_decisions';
  end if;

  if to_regclass('arb.worker_heartbeats') is null then
    raise exception 'Missing table: arb.worker_heartbeats';
  end if;

  if to_regclass('arb.v_domain1_promotion_readiness') is null then
    raise exception 'Missing view: arb.v_domain1_promotion_readiness';
  end if;

  if to_regprocedure(
    'arb.record_domain1_promotion_check(text,text,text,text,text,integer,jsonb)'
  ) is null then
    raise exception 'Missing function: arb.record_domain1_promotion_check';
  end if;
end $$;
SQL
}

main() {
  log "Starting Domain 1 promotion preflight"

  cd "${APP_DIR}" || fail "DOMAIN1_PREFLIGHT" "APP_DIR not found: ${APP_DIR}" 1

  if [[ -f ".env" ]]; then
    set -a
    # shellcheck disable=SC1091
    source ".env"
    set +a
  fi

  [[ -n "${DATABASE_URL:-}" ]] || fail "DOMAIN1_PREFLIGHT" "DATABASE_URL missing" 1

  require_cmd node
  require_cmd npm
  require_cmd psql
  require_cmd pm2
  require_cmd jq

  validate_node_version

  log "Checking database connectivity"
  psql "${DATABASE_URL}" -v ON_ERROR_STOP=1 -c "select 1;" >/dev/null \
    || fail "DOMAIN1_PREFLIGHT" "database connectivity failed" 1

  strict_db_object_checks
  CAN_RECORD_CHECKS="true"

  record_check \
    "DOMAIN1_PREFLIGHT" \
    "RUNNING" \
    "${SCRIPT_NAME}" \
    "Domain 1 promotion preflight started" \
    0 \
    "{\"app_dir\":\"${APP_DIR}\",\"worker_pattern\":\"${DOMAIN1_WORKER_NAME_PATTERN}\"}"

  log "Checking Domain 1 runtime state"
  RUNTIME_STATE="$(
    psql "${DATABASE_URL}" -t -A -F '|' -v ON_ERROR_STOP=1 <<'SQL'
select
  engine_mode,
  decision_owner,
  canonical_write_enabled::text
from arb.domain1_runtime_state
where id = 1;
SQL
  )"

  [[ -n "${RUNTIME_STATE}" ]] || fail "DOMAIN1_PREFLIGHT" "domain1 runtime state row missing" 1

  ENGINE_MODE="$(cut -d'|' -f1 <<<"${RUNTIME_STATE}")"
  DECISION_OWNER="$(cut -d'|' -f2 <<<"${RUNTIME_STATE}")"
  CANONICAL_WRITE="$(cut -d'|' -f3 <<<"${RUNTIME_STATE}")"

  [[ "${ENGINE_MODE}" == "shadow" ]] || fail "DOMAIN1_PREFLIGHT" "engine_mode must be shadow, found ${ENGINE_MODE}" 1
  [[ "${DECISION_OWNER}" == "legacy" ]] || fail "DOMAIN1_PREFLIGHT" "decision_owner must be legacy during certification, found ${DECISION_OWNER}" 1
  [[ "${CANONICAL_WRITE}" == "false" || "${CANONICAL_WRITE}" == "f" ]] || fail "DOMAIN1_PREFLIGHT" "canonical_write_enabled must be false during certification" 1

  log "Checking PM2 worker pattern: ${DOMAIN1_WORKER_NAME_PATTERN}"
  if ! pm2 jlist | jq -e --arg pattern "${DOMAIN1_WORKER_NAME_PATTERN}" '
    .[]
    | select((.name | test($pattern; "i")) and .pm2_env.status == "online")
  ' >/dev/null; then
    fail "DOMAIN1_PREFLIGHT" "PM2 Domain 1 worker is not online for pattern ${DOMAIN1_WORKER_NAME_PATTERN}" 1
  fi

  log "Checking Domain 1 DB heartbeat"
  HEARTBEATS="$(
    psql "${DATABASE_URL}" -t -A -v ON_ERROR_STOP=1 <<'SQL'
select count(*)
from arb.worker_heartbeats
where worker_name ilike any(array['%acquisition%', '%domain1%'])
  and status in ('running','processing')
  and last_seen_at >= now() - interval '5 minutes';
SQL
  )"

  [[ "${HEARTBEATS}" =~ ^[0-9]+$ ]] || fail "DOMAIN1_PREFLIGHT" "heartbeat query returned invalid value: ${HEARTBEATS}" 1
  (( HEARTBEATS >= 1 )) || fail "DOMAIN1_PREFLIGHT" "no healthy Domain 1 worker heartbeat found" 1

  run_required_step "DOMAIN1_BUILD" "npm run build" npm run build
  run_required_step "DOMAIN1_TEST_SUITE" "npm test" npm test

  if package_script_exists "certify:domain1-replay"; then
    run_required_step "DOMAIN1_REPLAY_SUITE" "npm run certify:domain1-replay" npm run certify:domain1-replay
  else
    record_check "DOMAIN1_REPLAY_SUITE" "FAIL" "package.json" "missing package script certify:domain1-replay" 127 || true
    fail "DOMAIN1_REPLAY_SUITE" "missing package script certify:domain1-replay" 127
  fi

  log "Checking promotion readiness view"
  READINESS="$(
    psql "${DATABASE_URL}" -t -A -F '|' -v ON_ERROR_STOP=1 <<'SQL'
select
  promotion_status,
  eligible_for_human_promotion_review::text
from arb.v_domain1_promotion_readiness
limit 1;
SQL
  )"

  [[ -n "${READINESS}" ]] || fail "DOMAIN1_PREFLIGHT" "promotion readiness view returned no rows" 1

  PROMOTION_STATUS="$(cut -d'|' -f1 <<<"${READINESS}")"
  ELIGIBLE="$(cut -d'|' -f2 <<<"${READINESS}")"

  log "Promotion status: ${PROMOTION_STATUS}"
  log "Eligible for human promotion review: ${ELIGIBLE}"

  if [[ "${PROMOTION_STATUS}" != "GO_READY_FOR_PROMOTION_REVIEW" || "${ELIGIBLE}" != "true" ]]; then
    fail "DOMAIN1_PREFLIGHT" "readiness failed: ${PROMOTION_STATUS}, eligible=${ELIGIBLE}" 1
  fi

  pass_check "DOMAIN1_PREFLIGHT" "${SCRIPT_NAME}" "all promotion preflight gates passed; eligible for human promotion review"

  PREFLIGHT_COMPLETED="true"
  log "GO: Domain 1 is eligible for human promotion review. This does not mean auto-promote."
  exit 0
}

main "$@"
