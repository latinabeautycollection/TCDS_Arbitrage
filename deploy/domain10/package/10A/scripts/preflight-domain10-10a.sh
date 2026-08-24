#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
M="$ROOT/database/migrations/510_domain10_notifications_operations.sql"
for x in operational_events notification_requests notification_deliveries notification_outbox sms_consent_events record_sms_consent_event audit_ledger claim_notification_outbox UNKNOWN_PROVIDER_OUTCOME MICROSOFT_GRAPH TELNYX '+15715160419'; do grep -q "$x" "$M" || { echo "FAIL missing $x"; exit 1; }; done
grep -q 'FOR UPDATE OF o SKIP LOCKED' "$M" || { echo 'FAIL missing SKIP LOCKED'; exit 1; }
! grep -Eq 'Slack|Discord' "$M" || { echo 'FAIL unsupported channel'; exit 1; }
echo 'PASS: Domain 10 10A static preflight'

test -f "$ROOT/database/migrations/511_domain10_green_tier1_hardening.sql"
grep -q "sms_delivery_currently_eligible" "$ROOT/database/migrations/511_domain10_green_tier1_hardening.sql"
grep -q "trg_provider_receipts_immutable" "$ROOT/database/migrations/511_domain10_green_tier1_hardening.sql"
grep -q "trg_incident_state_transition" "$ROOT/database/migrations/511_domain10_green_tier1_hardening.sql"
