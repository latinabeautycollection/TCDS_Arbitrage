#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"; cd "$ROOT"
test -f database/migrations/519_domain10_incident_lifecycle_escalation.sql
test -f database/migrations/520_domain10_incident_lifecycle_hardening.sql
test -f database/security/521_domain10_10d_least_privilege_roles.sql
grep -q 'claim_incident_activation_10d' database/migrations/519_domain10_incident_lifecycle_escalation.sql
grep -q 'apply_incident_command_10d' database/migrations/519_domain10_incident_lifecycle_escalation.sql
grep -q 'prepare_escalation_emission_10d' database/migrations/519_domain10_incident_lifecycle_escalation.sql
grep -q 'settle_escalation_emission_10d' database/migrations/519_domain10_incident_lifecycle_escalation.sql
grep -q 'notification_decisions' database/migrations/519_domain10_incident_lifecycle_escalation.sql
grep -q 'notification_deliveries' database/migrations/519_domain10_incident_lifecycle_escalation.sql
grep -q 'incident_escalation_executions' database/migrations/519_domain10_incident_lifecycle_escalation.sql
if grep -R -E 'microsoftGraphEmailProvider|telnyxSmsProvider|record_provider_acceptance_10c\(' src/domains/operations/incidents >/dev/null 2>&1; then echo 'FAIL: 10D imports/takes provider-delivery ownership'; exit 1; fi
if find src/domains/operations/incidents -type f -name '*.ts' -print0 | xargs -0 grep -E 'from ["'"'][^"'"']+\.js["'"']' >/dev/null 2>&1; then echo 'FAIL: NodeNext .js suffix found'; exit 1; fi
echo 'PASS: Domain 10D static preflight'

test -f database/migrations/522_domain10_10d_review_hardening.sql
test -f database/security/523_domain10_10d_reviewed_least_privilege.sql
grep -q "validate_incident_escalation_binding_for_event_10d" database/migrations/522_domain10_10d_review_hardening.sql
grep -q "SECURITY DEFINER" database/migrations/522_domain10_10d_review_hardening.sql
grep -q "Incident command idempotency collision" database/migrations/522_domain10_10d_review_hardening.sql
grep -q "max_emission_attempts" database/migrations/522_domain10_10d_review_hardening.sql
