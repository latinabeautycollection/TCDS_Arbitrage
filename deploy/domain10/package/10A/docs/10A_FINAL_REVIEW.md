# Domain 10A Green Tier 1 Review — Final Remediation

The original 10A architecture was strong, but this review identified enterprise-integrity gaps that prevented a literal 10/10 certification. The added 511 hardening migration closes those gaps without discarding the original 510 contract.

## Remediated

1. Frozen policy/template definitions remain immutable while supporting controlled retirement.
2. Event/template/rendered-message hashes are now verified by PostgreSQL.
3. Notification plan and recipient snapshots are frozen once dispatch begins.
4. SMS webhook duplicate handling is concurrency-safe.
5. STOP wins at equal event timestamps.
6. Current SMS consent is rechecked at send/claim time so STOP after planning suppresses queued SMS.
7. Provider receipts and completed delivery attempts are immutable evidence.
8. Microsoft Graph provider acceptance requires HTTP 202; Telnyx requires 2xx.
9. Final-delivery evidence is provider-specific; Graph 202 cannot be mislabeled delivered.
10. Incident lifecycle transitions are database-enforced and incident events are append-only.
11. Repeated escalation executions have a separate immutable evidence table.
12. Suppression grouping is now declarative; executable grouping_expression is deprecated.
13. Retention governance registry added.
14. Least-privilege database role/grant script added.

## Remaining live certification gates

The package can be rated Green Tier 1 as a database-contract target. Live production certification still requires running migrations/tests on the target PostgreSQL version, multi-session concurrency tests, backup/restore, security-role mapping, and real Microsoft/Telnyx provider certification.
