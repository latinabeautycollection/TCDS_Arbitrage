#!/usr/bin/env bash
set -Eeuo pipefail
: "${DATABASE_URL:?DATABASE_URL must point to disposable certification DB}"
: "${REPO_ROOT:?REPO_ROOT must point to production checkout}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

command -v psql >/dev/null || { echo "FAIL: psql required"; exit 1; }

bash scripts/preflight-domain10-10f.sh
bash scripts/preflight-domain10-10f-repo.sh

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f database/preflight/529_preflight_domain10_10f.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f database/migrations/529_domain10_enterprise_certification.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f database/migrations/530_domain10_enterprise_certification_hardening.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f database/security/531_domain10_10f_least_privilege.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f database/seeds/529_domain10_10f_default_profile.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f database/migrations/532_domain10_10f_enterprise_review_hardening.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f database/seeds/533_domain10_10f_reviewed_profile_v2.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f database/security/534_domain10_10f_reviewed_privilege_lockdown.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f database/tests/529_domain10_10f_contract_tests.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f database/tests/532_domain10_10f_review_hardening_tests.sql

[[ -f "$REPO_ROOT/package-lock.json" ]] || {
  echo "FAIL: production package-lock required"
  exit 1
}

echo "PASS: 10F reviewed DB/static gates."
echo "Use DOMAIN10_ENTERPRISE_RELEASE profile version 2."
echo "All 19 required v2 attestations must exist before CERTIFIED finalization."
