#!/usr/bin/env bash
set -Eeuo pipefail
SLICE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_ROOT="${REPO_ROOT:-}"
: "${DATABASE_URL:?DATABASE_URL must point to disposable certification DB}"
[[ -n "$REPO_ROOT" ]] || { echo "FAIL: REPO_ROOT required"; exit 1; }

command -v psql >/dev/null || { echo "FAIL: psql required"; exit 1; }

bash "$SLICE_ROOT/scripts/preflight-domain10-10b.sh"
REPO_ROOT="$REPO_ROOT" bash "$SLICE_ROOT/scripts/preflight-domain10-10b-repo.sh"

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$SLICE_ROOT/database/preflight/513_preflight_domain10_10b.sql"

if [[ "$(psql "$DATABASE_URL" -Atqc "SELECT to_regclass('operations.event_contract_versions') IS NULL")" == "t" ]]; then
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$SLICE_ROOT/database/migrations/513_domain10_event_decision_engine.sql"
fi
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$SLICE_ROOT/database/migrations/514_domain10_10b_green_tier1_hardening.sql"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$SLICE_ROOT/database/security/515_domain10_10b_least_privilege_roles.sql"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$SLICE_ROOT/database/seeds/513_domain10_10b_seed.sql"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$SLICE_ROOT/database/tests/513_domain10_10b_contract_tests.sql"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$SLICE_ROOT/database/tests/514_domain10_10b_hardening_tests.sql"

# Production-root reproducibility, not a competing standalone Node project.
cd "$REPO_ROOT"
test -f package-lock.json || { echo "FAIL: production package-lock.json missing"; exit 1; }
npm ci
npm run typecheck
npm test -- --runInBand tests/domain10/10b
npm run build

echo "PASS: Domain 10B production-root code/database certification gates"
