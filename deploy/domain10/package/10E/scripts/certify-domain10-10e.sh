#!/usr/bin/env bash
set -Eeuo pipefail
: "${DATABASE_URL:?DATABASE_URL must point to disposable certification DB}"
: "${REPO_ROOT:?REPO_ROOT must point to production checkout}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"; cd "$ROOT"
command -v psql >/dev/null || { echo "FAIL: psql required"; exit 1; }
bash scripts/preflight-domain10-10e.sh
bash scripts/preflight-domain10-10e-repo.sh
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f database/preflight/524_preflight_domain10_10e.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f database/migrations/524_domain10_communication_assurance.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f database/migrations/525_domain10_communication_assurance_hardening.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f database/security/526_domain10_10e_least_privilege.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f database/migrations/527_domain10_communication_assurance_review_hardening.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f database/security/528_domain10_10e_reviewed_privilege_lockdown.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f database/seeds/524_domain10_10e_integration_seed.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f database/tests/524_domain10_10e_contract_tests.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f database/tests/527_domain10_10e_review_hardening_tests.sql
[[ -f "$REPO_ROOT/package-lock.json" ]] || { echo "FAIL: production package-lock required"; exit 1; }
echo "PASS: 10E DB/static certification gates."
