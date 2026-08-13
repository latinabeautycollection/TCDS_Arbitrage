#!/usr/bin/env bash
# Domain 8 seed wrapper — supplies the app.* context that migration 806 made
# mandatory for governed writes. The shipped seed-domain8-policies.sql only sets
# app.tenant_id, so it aborts with "app.correlation_id is required" and rolls back
# (leaving empty catalogs). Run this instead of the raw seed.
set -Eeuo pipefail
: "${DATABASE_URL:?DATABASE_URL is required}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TENANT_ID="${DOMAIN8_TENANT_ID:-00000000-0000-0000-0000-000000000008}"
ACTOR_ID="${DOMAIN8_ACTOR_ID:-00000000-0000-0000-0000-000000000001}"
CORR="$(python3 -c 'import uuid;print(uuid.uuid4())')"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<SQL
SET app.tenant_id='$TENANT_ID';
SET app.actor_id='$ACTOR_ID';
SET app.actor_type='SYSTEM';
SET app.correlation_id='$CORR';
\i $ROOT/scripts/seed-domain8-policies.sql
SQL
echo "Domain 8 seed (with context): DONE"
