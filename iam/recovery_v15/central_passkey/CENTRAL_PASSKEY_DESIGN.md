# Central laptop passkey ceremony (EOC_OIDC_LOGIN): design

Status: draft, 2026-11-18. Staging only. Approved by the dev team on 2026-11-18:
- **RP ID:** `login-stg.tcdsolutionsgroup.com`.
- **Origin:** `https://login-stg.tcdsolutionsgroup.com`.
- **Ceremony:** laptop/browser, issuer-bound, user-verified, single-use, independent of Warehouse device enrollment.

## What exists and why it can't be reused as is

The deployed 6.1C verifier (`@simplewebauthn/server`) is device-bound end to end:
- `issue_auth_challenge_v5` requires a user **and** a Warehouse device.
- `passkeys.enrolled_device_id` ties each passkey to an enrolled device.
- Registration needs an authenticated Warehouse session.
- It has one `RP_ID` / `EXPECTED_ORIGIN`, which is `warehouse-app`.

Acceptance point 11 requires Warehouse device authentication to keep working unchanged, so those tables and functions aren't touched.

## Design

1. **Separate central tables** (new migration 626, `warehouse_identity`, function owner `tcds_identity_function_owner`, no table grants):
   - **`central_passkeys`:** user, `rp_id`, credential id (unique), public key, algorithm, sign count, transports, backup flags, AAGUID, enrolling invite, revoked_at.
   - **`central_enrollment_invites`:** one named user, a single-use token stored only as a hash, the issuing admin, expiry, consumed_at.
   - **`central_challenges`:** purpose (`CENTRAL_PASSKEY_ENROLLMENT` | `EOC_OIDC_LOGIN`), `rp_id`, origin, challenge hash, issuer, interaction id, request id, expiry of 120 s or less, single atomic claim, attempts.
   - **`central_webauthn_evidence`:** append-only, one row per successful ceremony (hashes, counters, UV, auth_time, verifier instance).
   - **SECURITY DEFINER functions** issue, claim and finalize, with a monotonic counter check and the claim consumed exactly once. They're executable only by a new verifier role `tcds_identity_central_verifier`.
2. **Verifier: extend 6.1C rather than write a second one.** It gets new `/central/registration/{options,verify}` and `/central/authentication/{options,verify}` routes. Its own settings are `CENTRAL_RP_ID` / `CENTRAL_ORIGIN`, and it uses the new role's database login.
   - **Login is discoverable:** no username, `allowCredentials` empty. The user is found from the asserted credential id, then checked against the `userHandle`.
   - **Same library** as Warehouse (`@simplewebauthn/server`), with `userVerification: required`.
3. **Issuer-facing routes** in login-v2-api `internalIamApi`: `POST /internal/v1/iam/oidc/passkey/{begin,finish}`, the exact contract issuer r4 calls.
   - **Access:** reachable only through the 9443 mTLS proxy as caller `oidc-issuer`, with the issuer workload HMAC and nonces.
   - **Begin:** returns `{challengeId, options}`.
   - **Finish:** returns the proof `assertPasskeyProof` checks (verifier, action, binding, ACR/AMR, authTime, expiresAt of 45 s or less) after checking IAM status / epoch and the 623 binding.
4. **Opaque subject:** `sub = base64url(HMAC-SHA256(CENTRAL_SUBJECT_KEY, issuer + "\n" + userId))`. It's 43 characters and matches the issuer's subject pattern.
   - **623 stores** `subject_hash = sha256(sub)`.
   - **Binding:** made only through 624's two-approver writer, never by email.
5. **Enrollment:** an admin issues a single-use invite for one named, identity-verified leader. The leader opens `https://login-stg.tcdsolutionsgroup.com/enroll/<token>` on their laptop and registers a passkey.
   - **Routing:** nginx sends only `/enroll/` there; everything else goes to the issuer.
   - **No grants:** an enrolled passkey grants nothing until the 624 binding and the EOC grants exist.

## Staging facts (stg_central_inspect.sh, 2026-11-18)

- **Services:** 6.1C verifier 2.0.0 (`@simplewebauthn/server` 13.2.2) runs as `login-v2-verifier-staging` on :8191. 6.1B runs as `login-v2-api-staging` on :8195. The verifier serves one RP ID, `warehouse-app`.
- **Nullable columns:** `auth_challenges.user_id`, `auth_challenges.device_id` and `passkeys.enrolled_device_id`.
- **No RP column:** `passkeys` has no `rp_id`.
- **Data:** 0 passkeys, 0 challenges, 0 evidence; 3 users (test accounts); 623 has 0 bindings; 624/625 aren't installed.
- **People:** none of the four people named by the dev team has an IAM user on staging.

**Design adjustment:** central passkeys and enrollment invites go in new tables (`central_passkeys` has its own `rp_id`). The challenges and the evidence go in the **existing** `auth_challenges` (device NULL, `expected_rp_id` = login-stg) and `webauthn_verification_evidence` (passkey_id NULL, the central passkey id in `details`). A small `central_challenge_context` table binds purpose, issuer, interaction and request to each challenge. That way all WebAuthn evidence stays in the one table that 624 and the auditors read. Warehouse rows and functions are unchanged.

## Questions for the dev team

1. **IAM accounts:** the four named people have no IAM user on staging. Who creates and identity-verifies their accounts (identity admin), and by when?
2. **624 assumes Warehouse sign-in for approvers.** Each approval must reference an approver **AAL2 Warehouse session** (`auth_sessions`) plus fresh WebAuthn evidence, and the role must be assigned globally (facility and station NULL). Warehouse sessions are device-bound, so Yahaira and Robert would approve from the Warehouse PWA on an enrolled device, with a Warehouse passkey. Alternatively, 624 could accept the laptop ceremony (evidence purpose `EOC_BINDING_APPROVAL`, no Warehouse session). Which one?
3. **No approval screen or service** writes `eoc_binding_approvals_v13` (role `tcds_eoc_attestation_writer`) in either case. Who owns building it?

## Order

1. Run `stg_central_inspect.sh` (read only).
2. Build 626 and test it locally on PG17.
3. Extend 6.1C.
4. Add the internalIamApi routes and the enrollment page.
5. Run the local chain test: issuer r4 → proxy → bridge → 6.1C, with a software authenticator.
6. Do the staging rehearsal and install.
7. After DNS: nginx/TLS for login-stg, then real laptops.
