# 10D Architecture

## Ownership

10A remains authoritative for incident rows, status constraints, incident timeline evidence, assignments, acknowledgements, escalation schedules/executions, notification/delivery/provider evidence and audit.

10B remains authoritative for whether an escalation fact should create a notification, who receives it, which channels are selected and which frozen templates render it.

10C remains authoritative for one-attempt provider execution, retry/ambiguity/dead-letter behavior and provider delivery receipts.

10D owns the orchestration around that truth:

```text
10B incident_required notification
        ↓
10D activation queue
        ↓
10A incident + assignment + ACK deadline
        ↓
10D frozen escalation-plan snapshot
        ↓
ACK/OWN/DECLINE + lifecycle state
        ↓
due escalation runtime
        ↓
10D emits authoritative escalation fact to 10B
        ↓
10B notification decision
        ↓
10C provider delivery
        ↓
10D settlement reads 10B + 10C evidence
        ↓
10A incident_escalation_executions
```

## Escalation binding rule

10D never overrides 10B's audience. Instead each 10A escalation step is mapped to an exact 10B event type + frozen policy whose audience/channels/ack requirement are required to match the 10A step.

This prevents 10D from becoming a second notification decision engine.

## SMS acknowledgement boundary

The existing Telnyx webhook layer retains raw-body Ed25519 verification, timestamp freshness, START/STOP/HELP and consent projection. Only after verification may it call `processVerifiedSmsIncidentCommand()` for explicit `ACK/OWN/DECLINE <incident-key>` commands.

## Incident state

10D's `transition_incident_10d()` uses the reviewed 10A incident status trigger; it does not replace it. CLOSE/CANCEL require owner-level incident authorization; operational transitions require active assignment or owner audience authorization.

## Escalation settlement

10D never marks an escalation `SENT` merely because it emitted an event. It waits for:
- 10B immutable `notification_decisions`, and
- 10C/10A delivery states.

At least one `ACCEPTED_BY_PROVIDER`/`DELIVERED` delivery is required for `SENT`. Partial failures are preserved in execution details.
