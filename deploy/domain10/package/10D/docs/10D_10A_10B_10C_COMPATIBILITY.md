# 10D Compatibility Contract

## Reused 10A
`operations.incidents`, `incident_events`, `incident_assignments`, `incident_acknowledgements`, `incident_escalations`, `incident_escalation_executions`, `escalation_policies`, `escalation_steps`, `notification_requests`, `notification_deliveries`, `audit_ledger`.

## Reused 10B
`event_contract_versions`, `notification_decisions`, `notification_policy_versions`, `resolve_authorized_audience`, `event_type_pattern_matches`, and the TypeScript `acceptOperationalEvent()` intake injected through a structural port.

## Reused 10C
10D does not call 10C code directly. It reads the authoritative 10A delivery states that 10C advances. This avoids a runtime dependency cycle.

## New 10D objects only
Tables and functions are either in the `src/domains/operations/incidents/` path or use `_10d` database naming, except the additive 10D trigger attached to `notification_requests` to enqueue incident activation.


## Reviewed hardening
Migrations 522/523 do not create any competing 10A/10B/10C source of truth. They only harden 10D execution security, command integrity, bounded orchestration retry, and pre-emission validation that the configured 10B policy is the unique authoritative winner.
