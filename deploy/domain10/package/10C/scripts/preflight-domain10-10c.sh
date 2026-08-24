#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

test -f database/migrations/516_domain10_delivery_orchestration.sql
test -f database/migrations/517_domain10_delivery_orchestration_hardening.sql
test -f database/security/518_domain10_10c_least_privilege_roles.sql
test -f src/domains/operations/delivery/services/deliveryOrchestrationService.ts

grep -q "claim_notification_outbox" database/migrations/516_domain10_delivery_orchestration.sql
grep -q "sms_delivery_currently_eligible" database/migrations/516_domain10_delivery_orchestration.sql
grep -q "record_provider_acceptance_10c" database/migrations/516_domain10_delivery_orchestration.sql
grep -q "record_final_delivery" database/migrations/516_domain10_delivery_orchestration.sql
grep -q "UNKNOWN_PROVIDER_OUTCOME" database/migrations/516_domain10_delivery_orchestration.sql
grep -q "apply_telnyx_delivery_event_10c" database/migrations/516_domain10_delivery_orchestration.sql
grep -q "mark_delivery_reconciliation_manual_review_10c" database/migrations/516_domain10_delivery_orchestration.sql
grep -q "resolve_delivery_reconciliation_10c" database/migrations/516_domain10_delivery_orchestration.sql
grep -q "FOR UPDATE OF t SKIP LOCKED" database/migrations/516_domain10_delivery_orchestration.sql

if grep -R -E "CREATE TABLE operations\.(operational_events|notification_requests|notification_deliveries|notification_outbox|notification_decisions|sms_subscriptions)" \
  database/migrations/516_domain10_delivery_orchestration.sql; then
  echo "FAIL: 10C attempts to recreate 10A/10B authoritative table"
  exit 1
fi

if find src/domains/operations/delivery -type f -name '*.ts' -print0 |
   xargs -0 grep -E 'from ["'\''][^"'\'']+\.js["'\'']' >/dev/null 2>&1; then
  echo "FAIL: NodeNext .js import suffix found"
  exit 1
fi

echo "PASS: Domain 10C static preflight"
