#!/usr/bin/env bash
set -Eeuo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"

TENANT_ID="${DOMAIN8_TENANT_ID:-00000000-0000-0000-0000-000000000008}"
ACTOR_ID="${DOMAIN8_ACTOR_ID:-00000000-0000-0000-0000-000000000001}"
CORRELATION_ID="$(python3 - <<'PY'
import uuid
print(uuid.uuid4())
PY
)"

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -v tenant_id="$TENANT_ID" \
  -v actor_id="$ACTOR_ID" \
  -v correlation_id="$CORRELATION_ID" <<'SQL'
BEGIN;
SET LOCAL app.tenant_id = :'tenant_id';
SET LOCAL app.actor_id = :'actor_id';
SET LOCAL app.correlation_id = :'correlation_id';

SELECT count(*) > 0 AS has_active_policy
FROM return_defense.v_active_policies
WHERE tenant_id = :'tenant_id'::uuid
  AND policy_key = 'DOMAIN8_ENTERPRISE_BASELINE';

SELECT *
FROM return_defense.claim_idempotency_key(
    'SMOKE:FOUNDATION',
    'smoke-key-1',
    '{"purpose":"foundation-smoke"}'::jsonb,
    interval '5 minutes',
    :'correlation_id'::uuid
);

SELECT return_defense.append_domain_event(
    'FOUNDATION_TEST',
    'smoke-1',
    'DOMAIN8_FOUNDATION_SMOKE_PASSED',
    '{"result":"PASS"}'::jsonb,
    '{"source":"smoke-domain8-foundation.sh"}'::jsonb,
    :'correlation_id'::uuid,
    'smoke-event-1',
    'SYSTEM',
    :'actor_id'::uuid,
    'tcds.domain8.foundation'
);

ROLLBACK;
SQL

echo "Domain 8 foundation smoke test: PASS"
