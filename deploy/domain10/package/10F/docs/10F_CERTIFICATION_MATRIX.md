# 10F Green Tier 1 Certification Matrix

## Ownership isolation
- [x] no root package.json / tsconfig
- [x] additive `domain10Certification` namespace
- [x] no runtime worker
- [x] no Graph/Telnyx provider ownership
- [x] no 10B notification-decision ownership
- [x] no 10C delivery execution ownership
- [x] no 10D incident/escalation execution ownership
- [x] no 10E SLO evaluation ownership
- [x] no prior-slice DML grants

## Certification evidence
- [x] frozen versioned certification profile
- [x] DB-computed profile hash
- [x] fixed check registry; no arbitrary SQL configuration
- [x] schema fingerprint of 10A–10E contract
- [x] idempotent run input hash
- [x] repeatable-read TypeScript execution
- [x] immutable terminal run identity
- [x] append-only check evidence
- [x] append-only external attestations
- [x] DB-verified check/attestation hashes
- [x] sealed final run hash
- [x] minimum sample sizes produce INCONCLUSIVE, not false PASS
- [x] required INCONCLUSIVE blocks certification

## Automated coverage
- [x] 10A–10E structural contract
- [x] audit-chain continuity
- [x] 10B policy replay
- [x] 10B delivery-plan integrity
- [x] Graph 202 acceptance semantics
- [x] ambiguous-delivery reconciliation
- [x] Telnyx final-delivery evidence
- [x] incident-required linkage
- [x] ACK deadline integrity
- [x] escalation settlement integrity
- [x] 10E result/episode/event integrity
- [x] critical PUBLIC EXECUTE lockdown

## Required live attestations
- [ ] PostgreSQL migration/test suite
- [ ] production-root npm ci
- [ ] production-root build
- [ ] production-root Jest
- [ ] outbox SKIP LOCKED concurrency
- [ ] Graph live delivery drill
- [ ] Telnyx live delivery drill
- [ ] SMS STOP-before-send drill
- [ ] incident ACK/escalation drill
- [ ] assurance breach/recovery drill
- [ ] repository collision preflight


## In-depth Telnyx / Microsoft 365 / Exchange review
- [x] audit records cryptographically recomputed, not only chain-linked
- [x] schema fingerprint includes constraints/triggers/indexes/SHA-256 function defs
- [x] security fingerprint bound to certification input
- [x] frozen certification-profile definition hash bound to run
- [x] Graph provider acceptance independently requires HTTP 202 attempt evidence
- [x] Graph DELIVERED requires verified Exchange trace/NDR reconciliation evidence
- [x] Telnyx DELIVERED requires verified `message.finalized delivered` evidence
- [x] Telnyx final carrier failure requires verified finalized failure evidence
- [x] SMS provider acceptance requires historical OPT_IN state at send time
- [x] Exchange RBAC mailbox-scope attestation required
- [x] unscoped Entra Mail.Send removal attestation required
- [x] certificate authentication/expiry attestation required
- [x] Exchange final-delivery reconciliation drill required
- [x] Telnyx Ed25519 webhook verification drill required
- [x] Telnyx duplicate/out-of-order webhook drill required
- [x] START/STOP/HELP compliance drill required
- [x] active Telnyx 10DLC campaign attestation required
- [x] independent attestor required for sensitive provider/security drills
- [x] profile v1 retired; reviewed profile v2 is authoritative
