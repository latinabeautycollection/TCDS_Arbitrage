# IAM Recovery V1.5: item 4 (IAM session epoch + EOC verification API), staging certification

Status: **certified on staging only** (`kqcdqtazcqaawdkmcfed`), 2026-11-05. **Not applied to production.**
Builds on item 3 (`../README.md`): V1.5 + 620 + 621 must be installed first.

## What changed

### Database: `database/622_iam_session_epoch_events.sql` (+ rollback)
6.1B has no code path that suspends a user, ends employment, or ends sessions when a passkey is revoked. Only
`postgres` and `tcds_identity_function_owner` can write those tables. So the epoch is advanced by **AFTER triggers, in
the same transaction as the change**, whatever path makes it:

| Change | Epoch reason |
|---|---|
| `users.status` becomes SUSPENDED / DISABLED / ARCHIVED, or `archived_at` is set | `IDENTITY_SUSPENDED` |
| `employees.employment_status` leaves ACTIVE (LEAVE / SUSPENDED / TERMINATED) | `IDENTITY_SUSPENDED` |
| `passkeys.security_state` becomes SUSPENDED / RECOVERY / REVOKED, or `revoked_at` is set | `PASSKEY_REVOKED` |
| `session_revocation_commands` completes with scope USER / FACILITY / ALL (existing v3 path) | `GLOBAL_REVOCATION` |
| new `iam_sign_out_everywhere_v15(token_hash, request_id, correlation_id)` | `SIGN_OUT_EVERYWHERE` |

The following are deliberately **not** epoch events:
- **`LOCKED` (failed-login lockout).** Otherwise an attacker could log the real user out of EOC by guessing passwords.
  Login is still refused while `locked_until` is in the future.
- **A single-device logout.**
- **DEVICE-scope revocation commands.**

`iam_session_epoch_status_v15` is replaced to match. A lockout no longer reads as inactive, and an employee row that is
not ACTIVE now reads as inactive. The rollback restores 620's text exactly.

Order: install after 621. Rollback: 622 rollback, then 621 rollback, then 620 rollback, then 619.
The rollback was rehearsed inside one transaction and produced an identical catalog.

### Login V2 6.1B (`loginv2-6.1B-item4.patch`, on top of the item 3 patch)
- **`POST /api/v1/auth/sign-out-everywhere`:** requires the session cookie and CSRF, like every mutation. It revokes all
  of the user's Warehouse sessions, advances the epoch and clears the cookies.
- **`src/express/internalIamApi.ts`:** the internal IAM verification API. It runs on its **own `127.0.0.1` listener**
  and is never reachable under the public `/api/v1/auth` prefix. It starts only when `INTERNAL_IAM_API_SECRET` (at least
  32 characters) and `INTERNAL_IAM_API_PORT` are configured.
- **`env.ts` / `integration.ts`:** the two optional settings above, and the listener's start and stop.

## EOC contract (for the EOC BFF)
Call `POST /internal/v1/iam/session-status` with the body `{"userId":"<uuid>"}`.

**Request headers.** This is the same scheme 6.1B uses for its calls to 6.1C:

| Header | Value |
|---|---|
| `x-tcds-workload` | `eoc` |
| `x-tcds-timestamp` | Unix ms; must be within ±60 s |
| `x-tcds-nonce` | uuid; single use, replays are rejected |
| `x-tcds-body-sha256` | hex SHA-256 of the exact body bytes |
| `x-request-id` | uuid |
| `x-tcds-request-signature` | base64url HMAC-SHA256(secret, `${timestamp}.${nonce}.${bodySha256}.${requestId}`) |

**Response.** A 200 response is
`{"contractVersion":"1.0","requestId","userId","userActive","epoch","checkedAt"}`, with the header
`x-tcds-response-signature` = base64url HMAC-SHA256(secret, `${requestId}.${sha256(responseBody)}`).

**EOC must fail closed.** At EOC session issuance, store `epoch`. On every protected request, re-check and treat any of
the following as signed out:
- a non-200 status;
- a timeout or network error;
- a missing or invalid response signature;
- a `requestId` mismatch;
- `userActive !== true`;
- an `epoch` different from the stored one.

**Transport is open.** On staging the listener is `127.0.0.1:8196`. How EOC on the acquisition server reaches it in
production (a named Cloudflare tunnel with Access, or HTTPS with mTLS) is still to be decided. The Warehouse quick
tunnel (random hostname) is not suitable.

## Staging certification (2026-11-05, synthetic fixtures, removed afterwards)

**A. Internal API**

| Test | Case | Result |
|---|---|---|
| A1 | valid signed request | 200, `userActive=true`, current epoch, response signature valid |
| A2 | bad request signature | 401 `REQUEST_SIGNATURE_INVALID` |
| A3 | timestamp 5 min old | 401 (the same code; a caller is not told which check failed) |
| A4 | nonce replay | first 200, replay 401 `REQUEST_REPLAYED` |
| A5 | unknown user | 200, `userActive=false`, `epoch=0`, signed |

**T. Triggers**

| Test | Case | Result |
|---|---|---|
| T1 | passkey revoked | epoch +1 |
| T2 | employment ACTIVE → LEAVE | epoch +1, API `userActive=false`; back to ACTIVE: no epoch change, `userActive=true` |
| T3 | user SUSPENDED | epoch +1, `userActive=false` |
| T4 | lockout (`LOCKED`, `locked_until` +15 min) | no epoch change, `userActive=true` |
| T5 | USER-scope revocation command executed | epoch +1 |

**S. Sign-out-everywhere** (two sessions on a synthetic LV2TEST device)

| Test | Case | Result |
|---|---|---|
| S1 | no CSRF header | 403 `CSRF_REJECTED`; nothing changed |
| S2 | with CSRF | 200 `revokedSessions=2`; 0 of 2 sessions active; epoch +1 |
| S3 | replay with the revoked session | 403 `CSRF_REJECTED`; the session's CSRF token dies with it |
| S4 | internal API after sign-out | reports the new epoch |

**Item 3 regression:** with 622 and this patch applied, the item 3 tests T1–T9 still pass unchanged.

## Tools
`tools/stg_item4.sh` (staging only) provides `db-rehearse`, `db-install`, `db-uninstall`, `patch`, `test` and `revert`.
