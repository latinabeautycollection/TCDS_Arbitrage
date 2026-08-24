# Slice 10C Green Tier 1 Certification Matrix

## Ownership / collision
- [x] no root package.json
- [x] no root tsconfig.json
- [x] no duplicate `operationsRuntime.ts`
- [x] no duplicate Graph provider
- [x] no duplicate Telnyx provider
- [x] no duplicate email delivery worker
- [x] no 10A authoritative table recreation
- [x] no 10B decision table recreation
- [x] all new SQL functions use `_10c` suffix
- [x] repo collision preflight included

## Provider execution
- [x] shared 10B runtime injection
- [x] exactly one provider call per attempt
- [x] Graph acceptance requires 202
- [x] Telnyx acceptance requires 2xx + provider message ID
- [x] provider acceptance persisted by reviewed 10A function
- [x] provider receipt evidence retained
- [x] business retry is outside provider adapter
- [x] Retry-After-aware worker delay contract
- [x] attempt ceiling DB enforced
- [x] channel kill switch rechecked
- [x] DB rate-limit permit
- [x] SMS current consent rechecked immediately before SENDING

## Ambiguity / failure safety
- [x] network/timeout unknown outcome is not retried
- [x] UNKNOWN_PROVIDER_OUTCOME quarantine
- [x] reconciliation task created
- [x] dead-letter on permanent/exhausted explicit failure
- [x] reconciliation role has no send privilege
- [x] no automatic dead-letter resend
- [x] no automatic Telnyx terminal-failure resend

## Receipt handling
- [x] 10C accepts only already-verified normalized Telnyx outbound webhooks
- [x] provider-event dedupe
- [x] provider-message correlation
- [x] out-of-order receipt protection
- [x] unmatched verified receipt preservation
- [x] `message.finalized delivered` → reviewed 10A final-delivery evidence
- [x] delivery failure → final/dead-letter
- [x] delivery_unconfirmed → reconciliation
- [x] Graph 202 never becomes DELIVERED

## Security
- [x] executor least-privilege role
- [x] receipt processor least-privilege role
- [x] reconciler least-privilege role
- [x] PUBLIC EXECUTE revoked on new controlled functions
- [x] no credentials in 10C schema
- [x] no provider API keys logged or persisted

## Static/code review passes
- [x] Pass 1: path/ownership collision review
- [x] Pass 2: SQL object collision/invariant review
- [x] Pass 3: TypeScript syntax/contract review

## Live gates before production enablement
- [ ] reviewed 10A certification passes on target PostgreSQL clone
- [ ] reviewed 10B certification passes
- [ ] migrations 516/517/518 apply cleanly
- [ ] two-session EMAIL `SKIP LOCKED` claim test
- [ ] two-session SMS `SKIP LOCKED` claim test
- [ ] STOP after 10B planning but before 10C send → SUPPRESSED
- [ ] channel emergency stop blocks send
- [ ] local DB rate permit blocks over-limit claims
- [ ] Graph real send returns 202
- [ ] Graph message appears in Sent Items
- [ ] Graph recipient receives certification email
- [ ] Graph timeout simulation → UNKNOWN, no second send
- [ ] Graph 429 fixture → explicit bounded retry
- [ ] Telnyx real send returns message ID
- [ ] Telnyx message.sent receipt recorded
- [ ] Telnyx message.finalized delivered → DELIVERED
- [ ] duplicate Telnyx webhook is idempotent
- [ ] stale Telnyx webhook does not regress state
- [ ] Telnyx delivery_failed produces dead-letter/review evidence
- [ ] production repo collision preflight passes at merge commit
- [ ] root `npm ci`, typecheck/build, Jest tests pass


## Review-remediation gates
- [x] current production Graph provider contract aligned
- [x] Graph explicit retry/error semantics preserved
- [x] provider-owned sender/profile configuration removed from 10C
- [x] exact-row SMS send-time suppression
- [x] acceptance commit validates worker + active lease
- [x] MANUAL_REVIEW_REQUIRED can later resolve/cancel
- [x] receipt processor cannot directly invoke final-delivery authority
- [x] contradictory Telnyx terminal evidence creates reconciliation
- [x] current production legacy email-worker scheduling collision guarded
