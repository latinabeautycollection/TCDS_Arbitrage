#!/usr/bin/env bash
set -Eeuo pipefail

# ============================================================================
# System-wide Node 20 upgrade + clean reinstall + rebuild + PM2 refresh
# Target: Ubuntu / Linode
# App:    /srv/arb-system/api
#
# What it does:
#   1. Validates environment and required commands
#   2. Installs Node 20 system-wide from NodeSource
#   3. Verifies node and npm versions after upgrade
#   4. Removes node_modules and package-lock.json
#   5. Reinstalls dependencies cleanly
#   6. Runs dependency lock check
#   7. Builds the project
#   8. Refreshes PM2 startup after Node upgrade
#   9. Runs preflight
#
# Exit codes:
#   0 success
#   1 failure
# ============================================================================

APP_DIR="/srv/arb-system/api"
NODE_MAJOR="${NODE_MAJOR:-20}"
RUN_LOG="${APP_DIR}/logs/node-upgrade-rebuild.log"
PM2_BIN_LOCAL="${APP_DIR}/node_modules/.bin/pm2"

RED=$'\033[31m'
GREEN=$'\033[32m'
YELLOW=$'\033[33m'
BLUE=$'\033[34m'
BOLD=$'\033[1m'
RESET=$'\033[0m'

log() {
  local level="$1"
  shift
  local msg="$*"
  printf '[%s] [%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$level" "$msg" | tee -a "$RUN_LOG"
}

step() {
  printf '\n%s%s==> %s%s\n' "${BLUE}" "${BOLD}" "$1" "${RESET}" | tee -a "$RUN_LOG"
}

fail() {
  local msg="$1"
  printf '%s[ERROR]%s %s\n' "${RED}${BOLD}" "${RESET}" "$msg" | tee -a "$RUN_LOG" >&2
  exit 1
}

success() {
  printf '%s[SUCCESS]%s %s\n' "${GREEN}${BOLD}" "${RESET}" "$1" | tee -a "$RUN_LOG"
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "Missing required command: $1"
}

require_root() {
  if [[ "${EUID}" -ne 0 ]]; then
    fail "Run this script as root or with sudo"
  fi
}

assert_file() {
  [[ -f "$1" ]] || fail "Missing required file: $1"
}

assert_dir() {
  [[ -d "$1" ]] || fail "Missing required directory: $1"
}

cleanup_apt_lock_wait() {
  local waited=0
  while fuser /var/lib/dpkg/lock-frontend >/dev/null 2>&1 || fuser /var/lib/apt/lists/lock >/dev/null 2>&1; do
    if (( waited >= 120 )); then
      fail "Timed out waiting for apt/dpkg lock"
    fi
    log "WARN" "Waiting for apt/dpkg lock to clear..."
    sleep 2
    waited=$((waited + 2))
  done
}

verify_node_major() {
  local major
  major="$(node -p "process.versions.node.split('.')[0]")"
  [[ "$major" =~ ^[0-9]+$ ]] || fail "Unable to detect Node major version"
  [[ "$major" == "$NODE_MAJOR" ]] || fail "Node upgrade failed. Expected major ${NODE_MAJOR}, got $(node -v)"
}

verify_npm_modern() {
  local major
  major="$(npm -v | awk -F. '{print $1}')"
  [[ "$major" =~ ^[0-9]+$ ]] || fail "Unable to detect npm major version"
  (( major >= 10 )) || fail "npm version too old after upgrade: $(npm -v)"
}

main() {
  mkdir -p "${APP_DIR}/logs"
  touch "$RUN_LOG"

  step "Pre-checks"
  require_root
  require_cmd curl
  require_cmd gpg
  require_cmd apt-get
  require_cmd systemctl
  require_cmd bash

  assert_dir "$APP_DIR"
  assert_file "${APP_DIR}/package.json"
  assert_file "${APP_DIR}/tsconfig.json"

  log "INFO" "Current Node version: $(command -v node >/dev/null 2>&1 && node -v || echo 'not installed')"
  log "INFO" "Current npm version:  $(command -v npm >/dev/null 2>&1 && npm -v || echo 'not installed')"

  step "Install NodeSource Node ${NODE_MAJOR}.x repository"
  cleanup_apt_lock_wait
  apt-get update -y
  apt-get install -y ca-certificates curl gnupg

  mkdir -p /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
    | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg

  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_${NODE_MAJOR}.x nodistro main" \
    > /etc/apt/sources.list.d/nodesource.list

  step "Upgrade Node.js system-wide"
  cleanup_apt_lock_wait
  apt-get update -y
  apt-get install -y nodejs

  step "Verify Node and npm after upgrade"
  require_cmd node
  require_cmd npm
  verify_node_major
  verify_npm_modern
  success "Node upgraded successfully: $(node -v)"
  success "npm upgraded successfully:  $(npm -v)"

  step "Remove all Node 18-era app artifacts"
  cd "$APP_DIR"
  rm -rf node_modules
  rm -f package-lock.json
  success "Removed node_modules and package-lock.json"

  step "Clean reinstall dependencies on new runtime"
  npm install
  success "npm install completed"

  step "Verify locked dependency versions"
  npm run check:deps
  success "Dependency verification passed"

  step "Rebuild application"
  npm run build
  [[ -f "${APP_DIR}/dist/server.js" ]] || fail "Build failed: dist/server.js missing"
  success "Build completed and dist/server.js exists"

  step "Refresh PM2 startup after Node upgrade"
  if [[ -x "$PM2_BIN_LOCAL" ]]; then
    "$PM2_BIN_LOCAL" unstartup || true
    "$PM2_BIN_LOCAL" startup
    "$PM2_BIN_LOCAL" save
    success "PM2 startup refreshed with local PM2 binary"
  elif command -v pm2 >/dev/null 2>&1; then
    pm2 unstartup || true
    pm2 startup
    pm2 save
    success "PM2 startup refreshed with global PM2 binary"
  else
    fail "PM2 not available after reinstall"
  fi

  step "Run final preflight before first probe"
  npm run preflight
  success "Preflight passed"

  printf '\n%s✅ NODE UPGRADE, REINSTALL, REBUILD, PM2 REFRESH, AND PREFLIGHT COMPLETED%s\n' "${GREEN}${BOLD}" "${RESET}" | tee -a "$RUN_LOG"
}

main "$@"
