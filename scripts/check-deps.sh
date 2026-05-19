#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="/srv/arb-system/api"
PACKAGE_JSON="${APP_DIR}/package.json"

# ===== REQUIRED VERSIONS (LOCKED) =====
REQ_TYPESCRIPT="6.0.2"
REQ_PM2="6.0.14"
REQ_EXPRESS="5.2.1"
REQ_PG="8.20.0"
REQ_SUPABASE="2.100.1"
REQ_DOTENV="17.3.1"
REQ_TYPES_NODE="25.5.0"
REQ_TYPES_EXPRESS="5.0.6"
REQ_TYPES_PG="8.20.0"

# ===== COLORS =====
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log() {
  printf "${YELLOW}[%s] %s${NC}\n" "$(date '+%Y-%m-%d %H:%M:%S')" "$*"
}

pass() {
  printf "${GREEN}✔ %s${NC}\n" "$*"
}

fail() {
  printf "${RED}✖ %s${NC}\n" "$*" >&2
  exit 1
}

check_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "$1 is not installed"
}

get_pkg_version() {
  node -p "require('./package.json').dependencies?.['$1'] || require('./package.json').devDependencies?.['$1'] || ''" 2>/dev/null
}

strip_prefix() {
  echo "$1" | sed 's/^[\^~]//'
}

check_version() {
  local pkg="$1"
  local expected="$2"

  local raw
  raw=$(get_pkg_version "$pkg")

  if [ -z "$raw" ]; then
    fail "$pkg not found in package.json"
  fi

  local actual
  actual=$(strip_prefix "$raw")

  if [ "$actual" != "$expected" ]; then
    fail "$pkg version mismatch → expected: $expected, found: $actual"
  fi

  pass "$pkg version OK ($actual)"
}

# ===== START =====

cd "$APP_DIR" || fail "Cannot access app directory"

log "Checking required system tools"
check_cmd node
check_cmd npm

pass "Node version: $(node -v)"
pass "NPM version: $(npm -v)"

log "Checking package.json exists"
[ -f "$PACKAGE_JSON" ] || fail "package.json missing"

log "Validating dependency versions"

check_version "typescript" "$REQ_TYPESCRIPT"
check_version "pm2" "$REQ_PM2"
check_version "express" "$REQ_EXPRESS"
check_version "pg" "$REQ_PG"
check_version "@supabase/supabase-js" "$REQ_SUPABASE"
check_version "dotenv" "$REQ_DOTENV"

log "Validating type packages"

check_version "@types/node" "$REQ_TYPES_NODE"
check_version "@types/express" "$REQ_TYPES_EXPRESS"
check_version "@types/pg" "$REQ_TYPES_PG"

log "Verifying installed node_modules versions"

node_modules_check() {
  local pkg="$1"
  local expected="$2"

  local installed
  installed=$(node -p "require('$pkg/package.json').version" 2>/dev/null || echo "")

  if [ -z "$installed" ]; then
    fail "$pkg not installed in node_modules"
  fi

  if [ "$installed" != "$expected" ]; then
    fail "$pkg installed version mismatch → expected: $expected, found: $installed"
  fi

  pass "$pkg installed OK ($installed)"
}

node_modules_check "typescript" "$REQ_TYPESCRIPT"
node_modules_check "pm2" "$REQ_PM2"
node_modules_check "express" "$REQ_EXPRESS"
node_modules_check "pg" "$REQ_PG"
node_modules_check "@supabase/supabase-js" "$REQ_SUPABASE"
node_modules_check "dotenv" "$REQ_DOTENV"

node_modules_check "@types/node" "$REQ_TYPES_NODE"
node_modules_check "@types/express" "$REQ_TYPES_EXPRESS"
node_modules_check "@types/pg" "$REQ_TYPES_PG"

log "Checking TypeScript compiler"

TS_VERSION=$(npx tsc -v | awk '{print $2}')
[ "$TS_VERSION" = "$REQ_TYPESCRIPT" ] || fail "TypeScript CLI mismatch → expected $REQ_TYPESCRIPT, got $TS_VERSION"
pass "TypeScript CLI OK ($TS_VERSION)"

log "Checking PM2 runtime"

PM2_VERSION=$(npx pm2 -v | tail -n1)
[ "$PM2_VERSION" = "$REQ_PM2" ] || fail "PM2 mismatch → expected $REQ_PM2, got $PM2_VERSION"
pass "PM2 OK ($PM2_VERSION)"

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}✅ ALL DEPENDENCIES VERIFIED — LOCKED${NC}"
echo -e "${GREEN}SYSTEM READY FOR BUILD + PROBE${NC}"
echo -e "${GREEN}========================================${NC}"

exit 0
