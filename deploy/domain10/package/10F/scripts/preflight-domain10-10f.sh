#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

test -f database/migrations/529_domain10_enterprise_certification.sql
test -f database/migrations/530_domain10_enterprise_certification_hardening.sql
test -f database/security/531_domain10_10f_least_privilege.sql
test -f src/domains/operations/domain10Certification/services/domain10CertificationService.ts

grep -q "resolve_authoritative_notification_policy" database/migrations/529_domain10_enterprise_certification.sql
grep -q "domain10_certification_summary_10f" database/migrations/529_domain10_enterprise_certification.sql
grep -q "append-only" database/migrations/530_domain10_enterprise_certification_hardening.sql

if grep -R -E 'microsoftGraphEmailProvider|telnyxSmsProvider|runDeliveryOrchestrationBatch|applyIncidentCommand|transitionIncident|runAssuranceEvaluationBatch' \
 src/domains/operations/domain10Certification >/dev/null 2>&1; then
 echo "FAIL: 10F crosses prior-slice execution ownership"; exit 1
fi

if grep -R -E 'CREATE TABLE operations\.(notification_requests|notification_deliveries|notification_decisions|delivery_reconciliation_tasks_10c|incidents|incident_escalation_emissions_10d|communication_assurance_runs_10e)' \
 database/migrations/529_domain10_enterprise_certification.sql database/migrations/530_domain10_enterprise_certification_hardening.sql >/dev/null 2>&1; then
 echo "FAIL: 10F recreates prior-slice authoritative tables"; exit 1
fi

echo "PASS: Domain 10F static preflight"

test -f database/migrations/532_domain10_10f_enterprise_review_hardening.sql
test -f database/seeds/533_domain10_10f_reviewed_profile_v2.sql
test -f database/security/534_domain10_10f_reviewed_privilege_lockdown.sql
grep -q "GRAPH_FINAL_DELIVERY_EVIDENCE" database/migrations/532_domain10_10f_enterprise_review_hardening.sql
grep -q "SMS_SEND_CONSENT_INTEGRITY" database/migrations/532_domain10_10f_enterprise_review_hardening.sql
grep -q "recomputed_hash" database/migrations/532_domain10_10f_enterprise_review_hardening.sql
grep -q "GRAPH_EXCHANGE_RBAC_SCOPE_PASS" database/seeds/533_domain10_10f_reviewed_profile_v2.sql
grep -q "TELNYX_WEBHOOK_SIGNATURE_VERIFICATION_PASS" database/seeds/533_domain10_10f_reviewed_profile_v2.sql
grep -q "TELNYX_10DLC_CAMPAIGN_ACTIVE_PASS" database/seeds/533_domain10_10f_reviewed_profile_v2.sql
