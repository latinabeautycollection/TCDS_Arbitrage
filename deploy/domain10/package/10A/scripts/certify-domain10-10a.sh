#!/usr/bin/env bash
set -Eeuo pipefail
: "${DATABASE_URL:?DATABASE_URL must point to a disposable certification DB}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
command -v psql >/dev/null || { echo 'FAIL psql missing'; exit 1; }
[[ "$(psql "$DATABASE_URL" -Atqc 'show server_version_num')" -ge 150000 ]] || { echo 'FAIL PostgreSQL 15+ required'; exit 1; }
bash "$ROOT/scripts/preflight-domain10-10a.sh"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$ROOT/database/migrations/510_domain10_notifications_operations.sql"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$ROOT/database/migrations/511_domain10_green_tier1_hardening.sql"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$ROOT/database/seeds/510_domain10_seed.sql"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$ROOT/database/tests/510_domain10_contract_tests.sql"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$ROOT/database/tests/511_domain10_hardening_tests.sql"
echo 'PASS: Domain 10 10A PostgreSQL certification'
