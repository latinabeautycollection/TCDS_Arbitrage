# TCDS Domain 10 — Slice 10C
## Enterprise Delivery Orchestration
### Green Tier 1 target

This slice is written specifically to sit **after reviewed 10A and the attached reviewed 10B Revision 2** without taking over either slice.

10C consumes the provider-ready `operations.notification_outbox` produced by 10B and executes the already-designed Microsoft Graph Email and Telnyx SMS providers through injected ports.

## Core boundary

```text
10A = authoritative database/control contract
10B = event intake + notification decision/planning
10C = provider delivery orchestration
```

10C does not decide:
- whether an event deserves notification
- which policy wins
- who the recipients are
- whether Email/SMS is selected
- what template/version is used
- what message business content says
- SMS consent history
- incident/escalation policy

Those remain 10A/10B responsibilities.

## What 10C adds

- provider-ready outbox execution
- EMAIL/SMS channel worker orchestration
- current kill-switch gate
- current SMS consent gate immediately before send
- database rate permit
- exactly one provider submission per attempt
- Graph HTTP 202 acceptance enforcement
- Telnyx 2xx + message-ID acceptance enforcement
- bounded explicit retries
- Retry-After integration
- UNKNOWN provider outcome quarantine
- dead-letter transition for final/exhausted failures
- normalized verified Telnyx `message.sent` / `message.finalized` processing
- delivery receipt dedupe/order handling
- reconciliation task queue
- least-privilege executor/receipt/reconciler roles
- repository collision preflight

## New source namespace

All new runtime code is contained under:

`src/domains/operations/delivery/`

This avoids collisions with reviewed 10B and the existing production Email/SMS files.

## Fail-closed deployment

Application switches default to false.

The reviewed 10A database channel controls are independently fail closed.

No production send is possible until both layers are enabled.

See:
- `docs/10C_ARCHITECTURE.md`
- `docs/10C_10A_10B_COMPATIBILITY.md`
- `docs/10C_CERTIFICATION_MATRIX.md`
- `docs/10C_REVIEW_PASSES.md`
- `docs/PRODUCTION_INTEGRATION.md`
