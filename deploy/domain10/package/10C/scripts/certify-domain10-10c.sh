#!/usr/bin/env bash
set -Eeuo pipefail

: "${DATABASE_URL:?DATABASE_URL must point to a disposable certification database}"
: "${REPO_ROOT:?REPO_ROOT must point to the production TCDS repository checkout}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

command -v psql >/dev/null || { echo "FAIL: psql required"; exit 1; }

bash scripts/preflight-domain10-10c.sh
bash scripts/preflight-domain10-10c-repo.sh

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f database/preflight/516_preflight_domain10_10c.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f database/migrations/516_domain10_delivery_orchestration.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f database/migrations/517_domain10_delivery_orchestration_hardening.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f database/security/518_domain10_10c_least_privilege_roles.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f database/tests/516_domain10_10c_contract_tests.sql

[[ -f "$REPO_ROOT/package-lock.json" ]] || {
  echo "FAIL: production package-lock.json required"
  exit 1
}

echo "Database/static 10C certification passed."
echo "Now overlay 10C into a certification branch of REPO_ROOT and run the production root:"
echo "  npm ci"
echo "  npm run build"
echo "  npm test"
echo
echo "LIVE PROVIDER GATES STILL REQUIRED:"
echo "  Graph real 202 + Sent Items + recipient delivery"
echo "  Telnyx real 200/message-id + message.sent + message.finalized"
echo "  STOP-after-planning suppression"
echo "  timeout ambiguity quarantine"
echo "  429/5xx explicit retry"
echo "  dead-letter behavior"
