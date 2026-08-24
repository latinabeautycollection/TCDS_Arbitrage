# Domain 10B — Event Intake & Notification Decision Engine

## Mission

10B converts an authoritative originating-domain event into one deterministic, explainable, governed notification plan.

10B does **not** send provider messages. Its final external-side-effect boundary is the Domain 10 transactional delivery outbox consumed by 10C.

## Flow

Producer
→ strict envelope validation
→ frozen per-event JSON Schema validation
→ DB-authoritative event ingestion
→ immutable `operational_events`
→ durable event-planning outbox
→ `SKIP LOCKED` planner claim
→ deterministic frozen-policy resolution
→ suppression evaluation
→ declarative audience resolution
→ recipient authorization
→ SMS subscription eligibility
→ channel selection
→ frozen template binding
→ allowlisted deterministic rendering
→ notification request
→ recipient snapshot
→ per-recipient EMAIL/SMS delivery
→ notification outbox
→ immutable decision + candidate evidence.

## Deterministic policy winner

Policies are ordered by:

1. `decision_priority DESC`
2. event-pattern specificity DESC

If more than one policy ties at the winning priority and specificity, 10B **fails closed** with `POLICY_AMBIGUOUS`.

It does not silently pick a policy by UUID or insertion order.

## Event contract model

Each `(event_type, schema_version)` must have an active `FROZEN` contract.

The TypeScript intake validates the complete JSON Schema with AJV.

The PostgreSQL ingestion function independently enforces:

- enabled source
- enabled event type
- exact frozen contract/hash
- required top-level fields
- top-level JSON types
- duplicate source-event identity
- payload hash
- source-event collision detection.

This gives defense in depth without requiring a non-core PostgreSQL JSON-schema extension.

## Policy/template governance

A policy cannot transition to `FROZEN` unless every enabled channel has exactly one frozen template binding.

Bindings contain:

- exact template ID/version
- allowed template variable paths
- required variable paths.

After the policy is frozen, its bindings cannot change.

## Recipient resolution

10B supports declarative resolvers:

- `STATIC_MEMBERSHIP`
- `ALL_ENABLED`
- `DEPARTMENT`
- `ROLE`

No SQL fragments or arbitrary executable expressions are accepted as audience rules.

Recipient authorization is evaluated at the event's effective timestamp and snapshotted into `notification_recipients`.

SMS is selected only if:

- policy selects SMS
- recipient has a mobile number
- authorization allows SMS
- current subscription projection is `SUBSCRIBED`.

10A/10C recheck SMS consent again immediately before send.

## Decision evidence

Every processed event receives one immutable `notification_decisions` row.

Every matching candidate is persisted in `notification_decision_candidates`, including priority, specificity, definition hash, and whether it won.

This makes policy selection explainable after the fact.

## Side-effect boundary

10B performs no Microsoft Graph or Telnyx calls.

Its terminal action is a transaction that atomically creates:

- notification request
- recipient snapshots
- channel deliveries
- delivery outbox
- decision evidence
- audit evidence
- planning completion.

10C is responsible for provider submission.
