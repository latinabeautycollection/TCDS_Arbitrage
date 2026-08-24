# Domain 10E — Communication Assurance, SLO & Compliance Engine

## Mission

10E proves whether the Domain 10 communication system is performing to its frozen reliability objectives.

It is an **assurance/evidence layer**, not a notification sender and not an incident engine.

10E reads authoritative facts produced by 10A–10D, evaluates frozen SLO policies, creates immutable evaluation evidence, tracks breach/recovery episodes, and emits only a new operational fact into reviewed 10B when a breach/recovery becomes actionable.

## Ownership

### 10A retains
- operational/notification/delivery/incident truth
- provider health samples
- attempts/receipts/dead letters
- SMS consent
- audit truth

### 10B retains
- event intake
- policy decision
- audience/recipient authorization
- channel/template selection
- notification plan creation

### 10C retains
- Microsoft Graph/Telnyx execution
- retry, ambiguity, receipts, reconciliation, dead letters

### 10D retains
- incident activation
- ACK/OWN/DECLINE
- incident lifecycle
- escalation scheduling/emission/settlement

### 10E owns only
- SLO policy definitions
- assurance evaluation windows/results
- breach/recovery episodes
- assurance breach/recovery event-outbox records
- handoff of breach/recovery facts to 10B

## Supported authoritative metrics

- provider acceptance rate
- provider acceptance p95 latency
- unknown/ambiguous provider-attempt rate
- dead-letter rate
- provider-health availability
- incident ACK-within-SLA rate
- incident ACK p95 latency
- incident escalation send success rate

No Graph `202` is treated as final email delivery. The acceptance metrics deliberately measure provider acceptance, not recipient delivery.

## Breach hysteresis

Policies contain:
- consecutive breach windows
- consecutive recovery windows

This prevents one noisy five-minute window from producing alert flapping.

## 10B handoff

10E emits:
- `COMMUNICATION_ASSURANCE_BREACH`
- `COMMUNICATION_ASSURANCE_RECOVERY`

through the reviewed 10B event intake.

10E does **not** create a notification policy for those events. Normal 10B governance decides whether they should generate EMAIL/SMS and whether they should create an incident.

## Domain 11 boundary

10E exposes read-only PostgreSQL views for dashboards/Domain 11 observability:
- `communication_assurance_current_10e`
- `communication_assurance_active_breaches_10e`

10E does not create a second Prometheus/Grafana/Loki ownership layer.
