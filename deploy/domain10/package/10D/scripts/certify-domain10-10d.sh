#!/usr/bin/env bash
set -Eeuo pipefail

: "${DATABASE_URL:?DATABASE_URL must target a disposable certification database}"
: "${REPO_ROOT:?REPO_ROOT must target production checkout}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

command -v psql >/dev/null || { echo 'FAIL: psql required'; exit 1; }

bash scripts/preflight-domain10-10d.sh
bash scripts/preflight-domain10-10d-repo.sh

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f database/preflight/519_preflight_domain10_10d.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f database/migrations/519_domain10_incident_lifecycle_escalation.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f database/migrations/520_domain10_incident_lifecycle_hardening.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f database/security/521_domain10_10d_least_privilege_roles.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f database/migrations/522_domain10_10d_review_hardening.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f database/security/523_domain10_10d_reviewed_least_privilege.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f database/seeds/519_domain10_10d_integration_seed.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f database/tests/519_domain10_10d_contract_tests.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f database/tests/522_domain10_10d_review_hardening_tests.sql

[[ -f "$REPO_ROOT/package-lock.json" ]] || {
  echo 'FAIL: production package-lock required'
  exit 1
}

echo 'PASS: 10D DB/static gates.'
echo 'NEXT LIVE GATES: overlay on certification branch and run root npm ci/build/Jest plus incident/ACK/escalation drills.'
