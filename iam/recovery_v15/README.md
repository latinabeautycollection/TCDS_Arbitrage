# IAM Recovery V1.5: item 3 (one-transaction consume), staging certification

Status: **certified on staging only** (`kqcdqtazcqaawdkmcfed`), 2026-11-05. **Not applied to production.**
Production stays on hold until all of Anthony's gates pass (items 1–5).

## What changed

### Database (staging), on top of vendor V1.5 604–617
| File | Owner | Purpose |
|---|---|---|
| `database/604…617` | vendor (Anthony) | V1.5 as delivered, unchanged (`VENDOR_SHA256.txt`) |
| `database/619_*` | vendor | V1.5 full staging rollback |
| `database/620_recovery_v15_privileged_interface.sql` (+ rollback) | TCDS | NULL-safe two-approver CHECK; epoch reasons `SIGN_OUT_EVERYWHERE`, `PASSKEY_REVOKED`; SECURITY DEFINER functions `recovery_consume_supplemental_proof_v15`, `iam_advance_session_epoch_v15` (+ security audit event), `iam_session_epoch_status_v15` |
| `database/621_recovery_v15_reset_guard.sql` (+ rollback) | TCDS | `recovery_reset_guard_v15(reset_request_id, proof_id)`: policy decision + supplemental proof inside the consume transaction |

Order: install 604…617, 620, 621. Rollback: 621 rollback, then 620 rollback, then 619.
All TCDS functions are owned by `tcds_identity_function_owner` with `search_path=pg_catalog`. Only
`tcds_login_api` / `tcds_login_orchestrator` can execute them; PUBLIC, anon, authenticated and service_role cannot.
`tcds_login_api` has no direct table access.

Policy (621): a reset needs a supplemental proof when the reset's user has a `VERIFIED`, unrevoked recovery contact
whose `recovery_eligible_at` has passed. Otherwise the decision is `NO_SUPPLEMENTAL`, which applies to every user today
because no contacts exist. The user is taken from the locked reset request, never from the caller.

### Login V2 6.1B (`loginv2-6.1B-item3.patch`)
- `PasswordResetService.consume`: the slow checks (policy, HIBP, history, Argon2id hash) still run first, outside
  the transaction. After them, one `tx()` runs:
  1. `recovery_reset_guard_v15`;
  2. `consume_password_reset_v5`, which must return `CONSUMED`;
  3. `iam_advance_session_epoch_v15('PASSWORD_RESET')`, which writes the audit event.

  Any failure rolls back all three.
- `/api/v1/auth/password-reset/consume` accepts an **optional** `proofId` (uuid). Nothing else in the routes changed.
- Password-rule rejections now raise `IdentityError(code, status)`. The codes are unchanged:
  - rules broken: 400;
  - HIBP unreachable: 503 `BREACHED_PASSWORD_SERVICE_UNAVAILABLE`;
  - `RESET_NOT_FOUND`: 404.

  Previously all of these returned 500 `INTERNAL_ERROR`.
- Build: `tsc` to a scratch directory. Only `dist/services/passwordResetService.js` and
  `dist/express/registerIdentityRoutes.js` are replaced. The deployed `dist` for both files was first verified to equal
  a compile of the unpatched source, and the rest of `dist` equals the source.

## HTTP certification (staging login-v2-api, synthetic users, final run 2026-11-05 12:50Z)
| Test | Case | Result |
|---|---|---|
| T1 | no recovery contact → `NO_SUPPLEMENTAL` | 200 `CONSUMED`; epoch +1; audit +1; request `COMPLETED` |
| T2 | verified contact, no `proofId` | 403 `SUPPLEMENTAL_PROOF_REQUIRED`; nothing changed |
| T3 | `proofId` + wrong claim token (guard consumes proof, v5 fails) | 403 `RESET_INVALID`; **proof consumption rolled back** |
| T4 | `proofId` + correct claim | 200 `CONSUMED`; proof consumed; epoch +1; audit +1 |
| T5 | replay of T4 | 403 `RESET_INVALID`; nothing changed |
| T6 | password too short | 400 `PASSWORD_POLICY_LENGTH` |
| T7 | password contains username | 400 `PASSWORD_CONTAINS_IDENTITY` |
| T8 | breached password (HIBP) | 400 `PASSWORD_BREACHED` |
| T9 | reuse of current password | 400 `PASSWORD_REUSE` |

The epoch moved exactly once per successful consume. T4 succeeding after T3 proves the transaction: had T3's proof
consumption survived v5's failure, T4 would have been rejected with `RESET_PROOF_INVALID_OR_CONSUMED`.

Latency: consume takes 1–3 s, mostly Argon2id verification against password history (about 200 ms per history entry,
12-entry cap). That is well inside the 2-minute claim.

## Tools (`tools/`, staging only; every script refuses to run against a non-staging host)
- `stg_recovery_install.sh` installs, verifies or uninstalls V1.5 + 620 against a catalog snapshot.
- `stg_item3.sh` handles 621 install/uninstall, applies or reverts the 6.1B patch, and runs the certification tests.
- `stg_testuser.sh` seeds the synthetic users and creates reset requests.

## Open (not part of item 3)
- Item 1: destination approval needs the purpose-bound passkey step-up ceremony.
- Item 2: verify-first codes need the Domain 10 recovery broker, plus a decision on pre-claim browser binding.
- Item 4: epoch increments for sign-out-everywhere, passkey revocation and suspension, plus the internal IAM
  verification API for EOC.
