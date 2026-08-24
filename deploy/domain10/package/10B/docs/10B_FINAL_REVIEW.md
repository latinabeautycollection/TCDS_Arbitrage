# Domain 10B Final Expert Review — Revision 2

## Verdict

The original 10B package had the correct architectural direction but was not safe to merge into the production TCDS repository as supplied. This Revision 2 hardening closes the material database-governance, retry, suppression, evidence, and repository-integration defects found during review.

## Original blockers remediated

1. **Production module/tooling collision** — the original standalone ESM/NodeNext/Vitest package metadata is now certification-only. Production source is repository-native CommonJS-compatible TypeScript with extensionless imports and uses the root package/tsconfig/Jest stack.
2. **Duplicate runtime infrastructure** — 10B no longer creates a second PostgreSQL pool or separate logger/metrics/tracer control plane. `operationsRuntime.ts` is dependency-injected by the production composition root.
3. **Tests inside production `src`** — tests were moved to `tests/domain10/10b` so they do not contaminate the root production TypeScript compilation surface.
4. **Source-event collision weakness** — the authoritative ingestion function now fingerprints the complete immutable event envelope, not only payload/type/version. Reuse of a source event ID with materially changed authoritative content is rejected.
5. **Temporal-governance inconsistency** — each accepted event freezes `decision_basis_at` at receipt. Policy, audience, authorization and suppression evaluation use that frozen decision basis. Event schema eligibility is resolved against the event occurrence time so delayed historical events can still prove their original contract.
6. **Retired contract replay** — an event contract/policy may be used historically when it was effective at the appropriate frozen time even if it has since been retired.
7. **TypeScript-only policy authority** — PostgreSQL now independently re-derives the authoritative winning policy before a NOTIFY plan can commit.
8. **Ambiguous policy selection** — tied top-priority/top-specificity candidates fail closed.
9. **Policy freeze bypass** — direct INSERT-as-FROZEN is blocked; DRAFT → FROZEN requires exact channel/template bindings and acknowledgement invariants.
10. **Recipient/channel authority** — PostgreSQL independently verifies recipient/channel authorization before delivery creation. SMS must be subscribed at planning time; 10A/10C still recheck consent at send time.
11. **Suppression first-rule bug** — all matching suppression rules are evaluated. Global and channel-specific decisions are distinct.
12. **Suppression evidence gap** — both suppressed and non-suppressed evaluations are persisted, including channel scope.
13. **Suppression temporal bug** — suppression windows compare the frozen decision-basis times, not `decided_at` against `occurred_at`.
14. **Planner attempt bug** — the database returns the authoritative planning attempt number; exponential backoff now uses it instead of hardcoded `1`.
15. **Batch abandonment** — one nonretryable event failure no longer abandons the remainder of a claimed batch.
16. **Decision evidence mutability** — decisions are sealed. Candidate evidence cannot be appended after sealing; candidate-set hash and selected-winner invariants are verified before seal.
17. **Security-definer exposure** — PUBLIC execute rights are explicitly revoked and only dedicated roles receive controlled execution grants.
18. **Partial/unknown install risk** — read-only database preflight distinguishes fresh, expected upgrade, and unsafe partial-install states before mutation.
19. **Repository collision discipline** — a production-repository preflight checks the live repository before copying any 10B runtime file.

## 10A integration

10B extends reviewed 10A. It does not create a competing notification, delivery, consent, audit, incident, or provider schema. Its terminal transaction writes the 10A-authoritative notification request, recipient snapshot, delivery and notification outbox records.

10B does not call Microsoft Graph or Telnyx. Provider execution remains a 10C responsibility.

## Green Tier boundary

The code/contract is a Green Tier 1 **target** after this remediation. Final production certification still requires execution against a PostgreSQL clone and the current repository root build, plus a real multi-session concurrency test and representative producer replay.
