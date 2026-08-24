#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

test -f database/preflight/513_preflight_domain10_10b.sql
test -f database/migrations/513_domain10_event_decision_engine.sql
test -f database/migrations/514_domain10_10b_green_tier1_hardening.sql
test -f database/security/515_domain10_10b_least_privilege_roles.sql
test -f src/domains/operations/infrastructure/operationsRuntime.ts

grep -q "event_envelope_hash" database/migrations/514_domain10_10b_green_tier1_hardening.sql
grep -q "decision_basis_at" database/migrations/514_domain10_10b_green_tier1_hardening.sql
grep -q "resolve_authoritative_notification_policy" database/migrations/514_domain10_10b_green_tier1_hardening.sql
grep -q "seal_notification_decision" database/migrations/514_domain10_10b_green_tier1_hardening.sql
grep -q "FOR UPDATE OF o SKIP LOCKED" database/migrations/513_domain10_event_decision_engine.sql
grep -q "SMS_NOT_SUBSCRIBED" src/domains/operations/engines/channelSelectionEngine.ts
grep -q "Database rejected TypeScript policy winner" src/domains/operations/repositories/decisionCommitRepository.ts

if find src -type f \( -name '*.test.ts' -o -path '*/tests/*' \) | grep -q .; then
  echo "FAIL: tests under src"
  exit 1
fi
if grep -R -E "SLACK|DISCORD" src database/migrations >/dev/null 2>&1; then
  echo "FAIL: unsupported human notification channel found"
  exit 1
fi
if grep -R -E 'from ["'\''][^"'\'']+\.js["'\'']' src --include='*.ts' >/dev/null; then
  echo "FAIL: production-incompatible .js import suffix found"
  exit 1
fi

echo "PASS: Domain 10B Revision 2 static preflight"
