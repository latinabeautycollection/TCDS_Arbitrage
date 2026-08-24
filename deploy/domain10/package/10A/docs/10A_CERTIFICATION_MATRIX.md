# 10A Green Tier 1 Certification Matrix

## Implemented contract gates
- [x] Immutable events
- [x] DB idempotency
- [x] Policy freeze/versioning
- [x] Template freeze/versioning
- [x] Recipient/audience authorization
- [x] Recipient snapshots
- [x] EMAIL/Microsoft Graph provider binding
- [x] SMS/Telnyx provider binding
- [x] Delivery state machine
- [x] Provider acceptance separated from delivery
- [x] Ambiguous outcome quarantine
- [x] Outbox leases + SKIP LOCKED
- [x] Attempts + dead letters
- [x] SMS consent event ledger
- [x] Duplicate/out-of-order consent handling
- [x] Incidents/acknowledgements/escalations
- [x] Suppression records
- [x] Provider health/rate limits
- [x] Fail-closed channel controls
- [x] Append-only hash-chain audit
- [x] Rollback, seed, preflight, SQL behavior tests

## Live gates
- [ ] Run migration/seeds/tests on target PostgreSQL 15+
- [ ] Concurrent worker session test
- [ ] Backup/restore test
- [ ] Least-privilege DB grants
- [ ] Microsoft certificate auth + Exchange App RBAC
- [ ] Microsoft real send/Sent Items/inbox test
- [ ] Telnyx campaign/profile/number mapping
- [ ] START → HELP → STOP → START live SMS test
- [ ] Telnyx signature verification in application layer
- [ ] Provider receipt persistence
- [ ] Dead-letter replay runbook
- [ ] Audit-chain verification
- [ ] Domain 11 observability integration


## 10A.1 reviewed hardening gates
- [x] Frozen-version controlled retirement
- [x] DB-verified evidence hashes
- [x] Notification/recipient evidence freeze
- [x] Concurrent-safe SMS webhook dedupe
- [x] Equal-time STOP precedence
- [x] Send-time SMS subscription enforcement
- [x] Immutable provider receipts
- [x] Immutable completed delivery attempts
- [x] Graph HTTP 202 acceptance enforcement
- [x] Provider-specific final-delivery evidence
- [x] Incident state machine
- [x] Immutable incident event history
- [x] Repeat escalation execution evidence
- [x] Declarative suppression grouping
- [x] Retention governance registry
- [x] Least-privilege role/grant script
