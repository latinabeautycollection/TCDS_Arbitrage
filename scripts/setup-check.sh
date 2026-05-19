#!/usr/bin/env bash

set -e

echo "========================================"
echo " TCDS ARBITRAGE SYSTEM SETUP CHECK"
echo "========================================"

PASS_COUNT=0
FAIL_COUNT=0

function pass() {
  echo "✅ PASS: $1"
  PASS_COUNT=$((PASS_COUNT+1))
}

function fail() {
  echo "❌ FAIL: $1"
  FAIL_COUNT=$((FAIL_COUNT+1))
}

function check_or_install_pkg() {
  PKG=$1
  VERSION=$2
  DEV=$3

  if npm list "$PKG" >/dev/null 2>&1; then
    pass "$PKG installed"
  else
    fail "$PKG missing → installing"
    if [ "$DEV" = "dev" ]; then
      npm install -D "$PKG@$VERSION"
    else
      npm install "$PKG@$VERSION"
    fi
  fi
}

echo ""
echo "🔍 Checking Node.js..."

NODE_VERSION=$(node -v | sed 's/v//')
NODE_MAJOR=$(echo $NODE_VERSION | cut -d. -f1)

if [ "$NODE_MAJOR" -ge 18 ]; then
  pass "Node.js version $NODE_VERSION"
else
  fail "Node.js version too low ($NODE_VERSION). Recommend >=18"
fi

echo ""
echo "🔍 Checking npm..."

if command -v npm >/dev/null 2>&1; then
  pass "npm installed"
else
  fail "npm not found"
  exit 1
fi

echo ""
echo "🔍 Checking TypeScript..."

if npx tsc -v >/dev/null 2>&1; then
  TS_VERSION=$(npx tsc -v | awk '{print $2}')
  TS_MAJOR=$(echo $TS_VERSION | cut -d. -f1)
  TS_MINOR=$(echo $TS_VERSION | cut -d. -f2)

  if [ "$TS_MAJOR" -gt 5 ] || { [ "$TS_MAJOR" -eq 5 ] && [ "$TS_MINOR" -ge 5 ]; }; then
    pass "TypeScript version $TS_VERSION"
  else
    fail "TypeScript version too low ($TS_VERSION) → upgrading"
    npm install -D typescript@^5.5.0
  fi
else
  fail "TypeScript not installed → installing"
  npm install -D typescript@^5.5.0
fi

echo ""
echo "📦 Checking runtime dependencies..."

check_or_install_pkg "zod" "^4.0.0"
check_or_install_pkg "dotenv" "^16.4.5"
check_or_install_pkg "pino" "^9.3.2"
check_or_install_pkg "pg" "^8.11.5"
check_or_install_pkg "ioredis" "^5.4.1"
check_or_install_pkg "bullmq" "^5.7.0"

echo ""
echo "🧪 Checking dev dependencies..."

check_or_install_pkg "ts-node" "^10.9.2" "dev"
check_or_install_pkg "tsx" "^4.19.0" "dev"
check_or_install_pkg "@types/node" "^20.12.7" "dev"
check_or_install_pkg "jest" "^29.7.0" "dev"
check_or_install_pkg "ts-jest" "^29.1.2" "dev"
check_or_install_pkg "@types/jest" "^29.5.12" "dev"

echo ""
echo "⚙️ Checking tsconfig.json..."

if [ -f "tsconfig.json" ]; then
  pass "tsconfig.json exists"
else
  fail "tsconfig.json missing → creating"
  npx tsc --init
fi

echo ""
echo "========================================"
echo " SUMMARY"
echo "========================================"
echo "PASS: $PASS_COUNT"
echo "FAIL: $FAIL_COUNT"

if [ "$FAIL_COUNT" -eq 0 ]; then
  echo "🟢 SYSTEM STATUS: GREEN TIER READY"
else
  echo "🟡 SYSTEM STATUS: AUTO-FIX APPLIED — RE-RUN SCRIPT"
fi

echo "========================================"
