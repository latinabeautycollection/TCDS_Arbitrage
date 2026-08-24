#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

test -f database/migrations/524_domain10_communication_assurance.sql
test -f database/migrations/525_domain10_communication_assurance_hardening.sql
test -f database/security/526_domain10_10e_least_privilege.sql
test -f src/domains/operations/assurance/workers/assuranceEvaluationWorker.ts
test -f src/domains/operations/assurance/workers/assuranceEventWorker.ts

grep -q "communication_assurance_runs_10e" database/migrations/524_domain10_communication_assurance.sql
grep -q "calculate_assurance_metric_10e" database/migrations/524_domain10_communication_assurance.sql
grep -q "FOR UPDATE OF r SKIP LOCKED" database/migrations/524_domain10_communication_assurance.sql
grep -q "COMMUNICATION_ASSURANCE_BREACH" database/migrations/524_domain10_communication_assurance.sql
grep -q "COMMUNICATION_ASSURANCE_RECOVERY" database/migrations/524_domain10_communication_assurance.sql

if grep -R -E 'microsoftGraphEmailProvider|telnyxSmsProvider|runDeliveryOrchestrationBatch|apply_incident_command_10d|transition_incident_10d' \
  src/domains/operations/assurance >/dev/null 2>&1; then
  echo "FAIL: 10E contains direct 10A-10D execution ownership"
  exit 1
fi

if grep -R -E 'CREATE TABLE operations\.(notification_requests|notification_deliveries|notification_decisions|incidents|incident_events|delivery_reconciliation_tasks_10c|incident_escalation_runtime_10d)' \
  database/migrations/524_domain10_communication_assurance.sql database/migrations/525_domain10_communication_assurance_hardening.sql >/dev/null 2>&1; then
  echo "FAIL: 10E recreates prior-slice authoritative table"
  exit 1
fi

echo "PASS: Domain 10E static preflight"
test -f database/migrations/527_domain10_communication_assurance_review_hardening.sql
test -f database/security/528_domain10_10e_reviewed_privilege_lockdown.sql
grep -q "validate_assurance_policy_semantics_10e" database/migrations/527_domain10_communication_assurance_review_hardening.sql
grep -q "v_last_end" database/migrations/527_domain10_communication_assurance_review_hardening.sql
grep -q "max_attempts" database/migrations/527_domain10_communication_assurance_review_hardening.sql
grep -q "DOMAIN10_ASSURANCE" database/migrations/527_domain10_communication_assurance_review_hardening.sql
