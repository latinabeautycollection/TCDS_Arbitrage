# EOC 6.4 V1.2 IAM bridge (our corrected port), staging certification

Status: **certified on staging only** (`kqcdqtazcqaawdkmcfed`), 2026-11-06. **Not applied to production.**
Builds on items 3 and 4 (`../README.md`, `../item4/README.md`): V1.5 + 620 + 621 + 622 and the item 4 6.1B patch must be
installed first.
Source reviewed: `TCDS_PHASE3_DOMAIN6_SLICE6_4_V1_2_FINAL_FREEZE_INTEGRATION_CANDIDATE.zip`
(sha256 `4ce6a6f79170641c0820332cd24850cda29f987231cc0e3a199d5ae68c9aeb1b`). This replaces **only the IAM side** of that package:
`server/iam-bridge/067`, `070` and `authorityRouter.mjs`. The EOC application side (064/071/072, the EOC BFF and the
frontend) is unchanged and still to be integrated on the acquisition server.

## Defects found in the vendor IAM bridge (confirmed on staging)

| # | Vendor behaviour | Impact | Fix in this package |
|---|---|---|---|
| 1 | `eoc_subject_snapshot_v12` **INNER JOINs** `iam_session_epochs_v15`. 617 creates no rows up front. | Any user who has never had a reset or revocation gets 404 `UNKNOWN_SUBJECT`, so EOC refuses them. On staging, 2 of 3 users were affected. | The snapshot reads status and epoch from `iam_session_epoch_status_v15` (622). A missing row counts as epoch 0. |
| 2 | `active` means `status='ACTIVE'` and not locked. Employment status is ignored. | Anyone guessing an executive's password can lock them out of EOC. An employee on leave or terminated still reads as active. | Same 622 function: a lockout stays active, and a non-ACTIVE employment reads as inactive. |
| 3 | `ALTER FUNCTION … OWNER TO iam_eoc_bridge_fn_owner`, a role that 070 creates. | Fails on Supabase PG17. `postgres` is not a superuser, and `createrole_self_grant` is empty, so `postgres` gets ADMIN on the new role but not SET. | The functions are owned by `tcds_identity_function_owner`, using the same temporary-membership step as 620–622. No new roles. |
| 4 | Every request inserts a nonce row, and nothing deletes them. | The table grows without limit on the central IAM database. | Expired nonces are deleted on every admission, using an index on `expires_at`. |
| 5 | Express router with its own bridge database login. | `login-v2-api` doesn't depend on Express itself, and the bridge must not sit on the public app. | The three endpoints are ported into the existing private `127.0.0.1` internal IAM listener (`internalIamApi.ts`). The wire contract is unchanged, and `tcds_login_api` gets EXECUTE only. |

## What changed

### Database: `database/623_eoc_iam_bridge.sql` (+ rollback)
- **Tables.** The three tables keep 070's definitions: `eoc_federated_subject_bindings_v12`, `eoc_bridge_nonces_v12` and
  `eoc_bridge_audit_v12`. Row security is forced on all three. Only the function owner is granted access, and PUBLIC,
  anon, authenticated and service_role have none.
- **Leadership read.** The function owner gets SELECT on exactly the leadership columns 070 used, plus one SELECT policy
  per table.
- **The four bridge operations,** each one security-definer call:
  - `eoc_bridge_admit_nonce_v623(text)`: prunes expired nonces, then admits the new one.
  - `eoc_bridge_ready_v623(uuid)`: the health check, audited.
  - `eoc_subject_snapshot_v623(uuid,uuid)`: returns 070's JSON shape and writes the audit row in the same call.
  - `eoc_resolve_federation_v623(text,text,uuid)`: resolves only VERIFIED, unrevoked bindings of active users; every
    lookup is audited.
- **Order.** Install after 622. Roll back 623 first, then 622 and the rest. The rollback refuses to run while any
  federated binding exists. The rollback was rehearsed in one transaction and produced an identical catalog.

### Login V2 6.1B (`loginv2-6.1B-eoc64-bridge.patch`, on top of the item 4 patch)
- **`internalIamApi.ts`** now also serves Anthony's bridge contract, but only when `EOC_IAM_SERVICE_TOKEN` (at least 32
  characters) is set:
  - `GET /internal/v1/iam/eoc/ready`
  - `GET /internal/v1/iam/eoc/subject/<uuid>`
  - `POST /internal/v1/iam/eoc/federation/resolve`
- **Request authentication** is exactly what `authorityClient.mjs` sends: `x-eoc-workload-timestamp` in Unix seconds
  (within ±60 s), `x-eoc-workload-nonce` (single use; admitted in the database, so replays are caught across workers),
  and `x-eoc-workload-signature`, a hex HMAC-SHA256 of `method\npath\ntimestamp\nnonce\nsha256(body)`. The signature
  covers the raw body bytes.
- **The item 4 `POST /internal/v1/iam/session-status` route is unchanged.**
- **`env.ts` / `integration.ts`:** the optional `EOC_IAM_SERVICE_TOKEN` setting, passed through to the listener.

## Staging certification (2026-11-06, synthetic fixtures, removed afterwards)
The test client signs requests exactly as `authorityClient.mjs` does. The appointment checks run Anthony's own
`policy.mjs` → `activeAppointment()`, the rule his EOC BFF uses to admit a user.

**B. Request authentication**

| Test | Case | Result |
|---|---|---|
| B1 | ready | 200 `{ready, epochAuthority, federationAuthority}` |
| B2 | wrong key | 401 `UNAUTHORIZED` |
| B3 | timestamp 5 min old | 401 `UNAUTHORIZED` |
| B4 | signature made for another path | 401 `UNAUTHORIZED` |
| B5 | nonce replay | first 200, replay 401 `REPLAY_REJECTED` |

**C. Subject snapshot**

| Test | Case | Result |
|---|---|---|
| C1 | user without an epoch row | 200, active, `epoch=0` (vendor 070: 404) |
| C2 | user with an epoch row | 200, current epoch |
| C3 | unknown user | 404 `UNKNOWN_SUBJECT` |
| C4 | failed-login lockout | still active, epoch unchanged (vendor 070: inactive) |
| C5 | SUSPENDED | inactive, epoch +1; back to ACTIVE reads active |

**F. Federation**

| Test | Case | Result |
|---|---|---|
| F1 | no binding | 403 `FEDERATION_BINDING_DENIED` |
| F2 | VERIFIED dual-approved binding | 200, resolves to the test user |
| F3 | wrong subject | 403 |
| F4 | bound user suspended | 403 |
| F5 | binding revoked | 403 |

**L. Leadership appointment** (synthetic CEO linked to the test user)

| Test | Case | Result |
|---|---|---|
| L1 | no appointment | `activeAppointment=none` |
| L2 | ACTIVE, approved CEO appointment | `activeAppointment=CEO → CEO` |
| L3 | appointment ON_LEAVE | `activeAppointment=none` |

**H. Housekeeping**

| Test | Case | Result |
|---|---|---|
| H1 | expired nonce | pruned on the next request |
| H2 | audit | 17 audit rows for 17 disclosures and denials |
| H3 | direct table access | `tcds_login_api` cannot read the bindings table |

## Still open (not ours to close)
1. **Real OIDC issuer** for EOC sign-in, plus an approved IAM-side writer for subject bindings. The bindings need dual
   approval and must never be created by matching email or name.
2. **Private mTLS route** from the acquisition server to this listener: private CA, EOC client certificate and key, a
   proxy in front of `127.0.0.1:8196`, a source allowlist, and key rotation.
3. **WebAuthn attestation writer** for the two-approver EOC grants. That's Anthony's team, and it's the same ceremony as
   item 1.
4. **EOC application side** on the acquisition server: its own database (064 → 071 → 072), the BFF, and npm lockfiles.
5. **Audit retention:** every EOC request writes one audit row on the central IAM database. A retention policy is
   needed before production.

## Tools
`tools/stg_eoc64.sh` (staging only) provides `inspect-leadership`, `db-rehearse`, `db-install`, `db-uninstall`, `patch`,
`test` and `revert`. `tools/eoc64_policy.mjs` is Anthony's unmodified `server/policy.mjs`, which the test uses.
