# 10D Green Tier 1 Certification Matrix

## Ownership / collision
- [x] no 10A incident table recreation
- [x] no 10B notification-decision recreation
- [x] no 10C provider delivery code/import
- [x] no root package.json / tsconfig
- [x] new runtime isolated under `operations/incidents`
- [x] new functions named `_10d`
- [x] repository collision preflight

## Incident activation
- [x] durable activation queue
- [x] trigger from 10B `incident_required` output
- [x] existing-row backfill
- [x] advisory-lock idempotency
- [x] 10A incident is authoritative
- [x] owner audience copied from exact 10B policy version
- [x] ACK deadline copied from 10B notification request

## Acknowledgement / lifecycle
- [x] immutable/deduplicated command evidence
- [x] verified-SMS boundary only
- [x] START/STOP/HELP not consumed
- [x] actor authorization rechecked in PostgreSQL
- [x] ACK/OWN satisfies deadline
- [x] OWN creates responder assignment
- [x] DECLINE releases responder assignment
- [x] 10A status trigger remains final state authority
- [x] terminal lifecycle cancels pending escalation runtime

## Escalation
- [x] frozen per-incident escalation snapshot
- [x] exact 10B binding required per step
- [x] binding verifies audience/channel/ACK equivalence
- [x] recursive incident policy forbidden
- [x] binding drift fails closed
- [x] deterministic escalation source-event ID
- [x] 10B idempotent event handoff
- [x] no direct notification-request creation
- [x] no direct Email/SMS send
- [x] repeats recorded in 10A execution evidence
- [x] ACK-conditioned escalation cancellation

## Settlement
- [x] waits for 10B decision evidence
- [x] verifies selected 10B policy equals frozen binding
- [x] waits for 10C/10A delivery states
- [x] Graph/Telnyx acceptance/delivery semantics inherited from 10C/10A
- [x] SENT requires at least one accepted/delivered delivery
- [x] partial failure preserved in details

## Concurrency/security
- [x] `SKIP LOCKED` activation queue
- [x] `SKIP LOCKED` ACK deadline queue
- [x] `SKIP LOCKED` escalation queue
- [x] `SKIP LOCKED` settlement queue
- [x] leases and recovery
- [x] least-privilege executor/command roles
- [x] PUBLIC EXECUTE revoked on controlled functions

## Live gates
- [ ] reviewed 10A-10C certifications pass first
- [ ] 519/520/521 apply cleanly on PostgreSQL clone
- [ ] exact escalation bindings configured and validated
- [ ] incident activation concurrency test
- [ ] duplicate SMS command test
- [ ] unauthorized actor rejection test
- [ ] ACK deadline breach drill
- [ ] ACK cancels pending escalation drill
- [ ] escalation event reaches 10B exact bound policy
- [ ] 10C delivery settlement produces 10A execution evidence
- [ ] partial delivery failure drill
- [ ] policy-binding drift fails closed
- [ ] root npm ci/build/Jest pass after overlay
- [ ] production repo collision preflight passes at merge commit


## In-depth review remediation
- [x] 10B planner requires no direct 10D queue write permission
- [x] 10D mutating worker functions are SECURITY DEFINER with fixed search path
- [x] PUBLIC EXECUTE revoked from controlled 10D functions
- [x] owner-required CLOSE/CANCEL cannot be satisfied by ordinary responder assignment
- [x] bound 10B escalation policy must be the unique authoritative winner before emission
- [x] higher-priority/ambiguous 10B policy blocks escalation before emission
- [x] 10D escalation-event emission retries are bounded
- [x] command-ID content collision is rejected
- [x] terminal-incident commands are NOOP
- [x] application commands enforce freshness
- [x] escalation-emission identity is immutable
