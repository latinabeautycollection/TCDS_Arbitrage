# 10E Green Tier 1 Certification Matrix

## Ownership
- [x] additive `/operations/assurance` source namespace
- [x] no 10A authoritative table recreation
- [x] no 10B decision table recreation
- [x] no 10C delivery table recreation
- [x] no 10D incident runtime table recreation
- [x] no Graph/Telnyx provider imports
- [x] no incident command/lifecycle ownership
- [x] no notification policy selection in 10E
- [x] breach/recovery routed back through 10B

## PostgreSQL
- [x] frozen/versioned SLO policy contract
- [x] DB-verified policy hash
- [x] immutable frozen/retired policy versions
- [x] durable evaluation runs
- [x] SKIP LOCKED run claiming
- [x] lease recovery
- [x] DB-authoritative metric calculation
- [x] minimum-sample fail-safe
- [x] immutable completed evaluation evidence
- [x] breach/recovery hysteresis
- [x] one open episode per policy version
- [x] durable breach/recovery event outbox
- [x] bounded emission retry
- [x] immutable terminal assurance events
- [x] least-privilege evaluator/emitter/reader roles

## Metrics correctness
- [x] Graph/Telnyx provider acceptance measured by `provider_accepted_at`
- [x] no Graph 202→DELIVERED inference
- [x] ambiguous attempt rate derived from delivery attempts
- [x] dead-letter rate derived from 10A dead-letter truth
- [x] provider health derived from 10A provider-health truth
- [x] ACK SLA derived from 10A notification SLA + acknowledgements
- [x] escalation success derived from 10D settled emissions

## Integration
- [x] 10E producer event contracts registered through 10B catalog
- [x] no 10B notification policy silently created
- [x] shared 10B DB/logger/metrics/tracing runtime
- [x] read-only views available for Domain 11/EOC

## Live certification gates
- [ ] reviewed 10A–10D installed and certified on target PostgreSQL clone
- [ ] 524/525/526 apply cleanly
- [ ] multi-session run/event SKIP LOCKED tests
- [ ] frozen real SLO thresholds approved by leadership
- [ ] controlled forced breach opens one episode
- [ ] repeated breach windows do not duplicate breach event
- [ ] controlled recovery closes episode and emits one recovery fact
- [ ] 10B receives breach/recovery event idempotently
- [ ] production root npm ci/build/Jest passes
- [ ] Domain 11/EOC can read assurance views without mutation privileges

## In-depth review remediation
- [x] maturity delays evaluation; full SLO window is measured
- [x] missed-window catchup after worker downtime
- [x] bounded assurance-evaluation retry
- [x] contiguous-window hysteresis
- [x] ACK SLA due-time cohorting
- [x] SLO semantic threshold guard
- [x] exact 10B operational-event linkage validation
- [x] incompatible pre-existing event contracts fail closed
- [x] PUBLIC helper execution removed
