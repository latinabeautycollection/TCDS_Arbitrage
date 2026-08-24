# TCDS Domain 10 — Slice 10D
## Incident Lifecycle, Acknowledgement & Escalation Engine
### Green Tier 1 target

10D is deliberately built **after reviewed 10A, reviewed 10B and reviewed 10C**.

```text
10A = authoritative database / incident / delivery evidence contract
10B = event intake + notification decision/planning
10C = Email/SMS provider delivery orchestration
10D = incident activation + acknowledgement + lifecycle + escalation orchestration
```

10D does not send Email or SMS. Every escalation communication is emitted back into the reviewed **10B event intake**, where the exact frozen 10B policy decides audience/channel/template. 10C then performs provider delivery.

## New runtime namespace

`src/domains/operations/incidents/`

No existing 10A/10B/10C runtime file is overlaid.

## Key guarantees

- every 10B `incident_required` notification is durably queued for incident activation
- one incident per source notification through advisory-lock idempotency
- 10A `incidents` remains authoritative
- 10A incident state trigger remains authoritative
- acknowledgement deadline evidence
- verified SMS `ACK <INCIDENT>`, `OWN <INCIDENT>`, `DECLINE <INCIDENT>` commands
- START/STOP/HELP remain in the existing Telnyx consent subsystem
- application commands require existing authenticated recipient identity
- PostgreSQL independently authorizes incident actors
- escalation plan is snapshotted per incident
- 10A escalation policy changes cannot rewrite historical incident plan
- every escalation step must map to one exact frozen 10B event contract + policy
- the mapped 10B audience/channels/ack semantics must exactly match the 10A escalation step
- binding drift fails closed
- escalation events use deterministic source IDs for 10B idempotency
- 10D never creates `notification_requests` or `notification_deliveries`
- settlement waits on 10B decision evidence and 10C delivery evidence
- repeated escalation uses 10A `incident_escalation_executions`
- acknowledgement/resolution cancels pending acknowledgement-conditioned escalation
- `SKIP LOCKED` + leases on all 10D worker queues
- least-privilege roles
- no competing root package.json/tsconfig

## Required integration configuration

10D intentionally does not invent production escalation audiences or message templates. For every enabled 10A escalation step, configure `operations.incident_escalation_bindings_10d` to an exact frozen 10B event contract and policy. Certification refuses to treat missing/invalid bindings as valid. Runtime incidents still open, but escalation enters `BLOCKED_CONFIGURATION` rather than sending to the wrong audience.

See `docs/10D_ARCHITECTURE.md` and `docs/10D_CERTIFICATION_MATRIX.md`.


## Reviewed-final hardening
The reviewed package adds migration 522 and security step 523. Both are required after 519/520/521.

## In-depth reviewed final

This reviewed package includes required hardening migration `522_domain10_10d_review_hardening.sql` and security step `523_domain10_10d_reviewed_least_privilege.sql`. The uploaded original should not be deployed without these steps.
