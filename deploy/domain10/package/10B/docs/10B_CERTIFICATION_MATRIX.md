# Domain 10B Revision 2 — Green Tier 1 Certification Matrix

## 10A integration
- [x] extends reviewed 10A tables rather than duplicating notification/delivery authority
- [x] no direct 10A table/function-name collision detected in package comparison
- [x] provider delivery remains out of 10B
- [x] 10B commits into 10A `notification_requests`, `notification_recipients`, `notification_deliveries`, `notification_outbox`
- [x] SMS send-time consent remains a 10A/10C final gate

## Event intake
- [x] strict envelope validation
- [x] frozen JSON-schema contract validation
- [x] DB source/type/contract verification
- [x] DB-computed full event-envelope fingerprint
- [x] exact replay idempotency
- [x] changed source-event content rejected
- [x] event + processing + planning outbox atomic intake
- [x] decision-basis timestamp frozen at receipt
- [x] historical contract effective-time support

## Policy/decision authority
- [x] frozen/retired historical policy resolution by frozen decision basis
- [x] deterministic priority/specificity ordering
- [x] tied authoritative winner fails closed
- [x] DB independently re-derives selected policy before commit
- [x] policy freeze requires exact channel/template bindings
- [x] acknowledgement timeout invariant enforced
- [x] event-pattern grammar enforced
- [x] immutable policy/template definition lineage inherited from reviewed 10A

## Recipient/channel decision
- [x] declarative audiences only
- [x] membership and authorization validity windows
- [x] classification gate
- [x] contact availability gate
- [x] SMS subscription planning-time gate
- [x] DB independently validates per-recipient/per-channel eligibility
- [x] recipient/authorization snapshot persisted

## Suppression
- [x] all matching rules evaluated
- [x] global suppression supported
- [x] EMAIL-only suppression supported
- [x] SMS-only suppression supported
- [x] grouping fields declarative/string-only
- [x] frozen decision-basis time used for window comparison
- [x] suppressed and unsuppressed evidence persisted
- [x] suppression evidence append-only

## Planning durability
- [x] durable planning outbox
- [x] `FOR UPDATE SKIP LOCKED`
- [x] leases
- [x] expired planning lease safely recoverable
- [x] DB-authoritative attempt number
- [x] exponential retry uses actual attempt number
- [x] one failed item does not abandon remainder of claimed batch
- [x] final failure stops replay automatically

## Decision evidence
- [x] one decision per event
- [x] all matching candidates persisted
- [x] candidate-set hash
- [x] sealed decision
- [x] candidates cannot be appended after seal
- [x] NOTIFY requires exactly one selected candidate
- [x] DB seal re-derives authoritative candidate set
- [x] decision hash includes sealed candidate-set hash

## Security/repository compatibility
- [x] SECURITY DEFINER functions revoked from PUBLIC
- [x] dedicated ingestor/planner roles
- [x] no direct immutable-event DML for ingestor
- [x] no standalone production `package.json` / `tsconfig.json`
- [x] no runtime duplicate `db.ts`
- [x] no duplicate email provider/service files
- [x] tests outside production `src`
- [x] extensionless imports for root CommonJS TypeScript build
- [x] read-only database collision/precondition preflight
- [x] live repository path-collision preflight

## Current live production gates
- [ ] add root `ajv` + `ajv-formats` dependencies and commit production lockfile
- [ ] run repository path preflight against merge commit immediately before overlay
- [ ] production root `npm ci`
- [ ] production root TypeScript build
- [ ] production Jest tests including 10B suite
- [ ] reviewed 10A + 513/514/515 SQL applied to PostgreSQL clone
- [ ] 513 + 514 SQL behavioral tests pass
- [ ] two-session/multi-worker SKIP LOCKED concurrency test passes
- [ ] real originating-domain event contracts registered/frozen
- [ ] production policies/templates registered/frozen
- [ ] recipient/audience directory populated from authoritative source
- [ ] exact duplicate event replay returns same event
- [ ] conflicting source-event envelope is rejected
- [ ] policy-tie scenario fails closed
- [ ] STOP-before-planning excludes SMS
- [ ] STOP-after-planning suppressed at 10C send-time gate
- [ ] 10C successfully consumes generated notification outbox
- [ ] production composition root injects shared pool/logger/metrics/tracer
- [ ] planning worker registered with existing worker bootstrap/graceful shutdown
