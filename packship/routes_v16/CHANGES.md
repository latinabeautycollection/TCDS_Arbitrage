# Pack/Ship route layer: in-house V1.6 (based on the dev team's V1.5 backend candidate)

Built on `TCDS_Domain6_2D_FINAL_FREEZE_V1_5_EVIDENCE_BOUND_CANDIDATE.zip`
(sha256 8302006e…aad8), `backend_candidate/src`. The dev team's V1.2 tests are included.

## Changes
1. **The mapper reads no tables.** `PackShipTaskResponseMapper` takes no pool and builds the PWA task from the
   V0.2.1 snapshot alone (`warehouse.packship__snapshot`, applied to production 2026-11-17). Its six direct queries
   would have failed under `tcds_packship_api`, which has no table access by design. Mount with
   `new PackShipTaskResponseMapper()` (no argument).
2. **Old snapshots are refused.** A snapshot without `snapshotVersion: "0.2.1"` gets 502
   `PACKSHIP_SNAPSHOT_VERSION_UNSUPPORTED`; nothing is guessed. Production had 0 stored operation results at apply time.
3. **The OUTBOUND gate can pass.** In V1.5 it was always PENDING or FAIL. PR #13 (`packShipScanPlan.ts`) offers the
   `PACK_OUTBOUND_LOCATION` step only when `carrierLabel.status === "SCAN_VERIFIED"` and every blocking gate is PASS,
   so no task could ever have been staged. It now mirrors `packship_stage_outbound_v2`'s own precondition: status
   LABEL_VERIFIED, claim held by this session, no blockers (or already OUTBOUND_STAGED). The database still enforces
   it on the call.
4. **Label state from the print gateway**, using PR #13's `CarrierLabelState` values: print job PRINTED /
   VERIFICATION_PENDING / VERIFIED → `PRINTED`; PRINTING → `PRINTING`; CREATED / QUEUED / CLAIMED / SPOOLING →
   `PRINT_QUEUED`; FAILED / CANCELLED / DEAD_LETTER → `LABEL_PURCHASED` (reprint needed). A queued job is not printed
   paper. `SCAN_VERIFIED` only from the task status, after a verified physical label pair.
5. **EVIDENCE mirrors `packship__blockers`.** With requirements: every one accepted and integrity-verified; any
   rejection is FAIL. With none: PASS once the task has reached the evidence step (the database lets such a task
   complete), never before. V1.5 kept it PENDING forever for tasks with no requirements, which would also have blocked
   staging.
6. `packageId` / `packageRowVersion` kept as in V1.5.
7. Types: `V02TaskSnapshot` gains the V0.2.1 fields and item `title`.

Removed from the mapper: the 60-second station-readiness check. Station readiness was only used in the OUTBOUND gate,
which the database does not condition on readiness; `stationReadiness` is in the snapshot for later use.

8. **Wrong scans are 422 with PR #13 catalog codes, not 500.** V0.2 returns `ok:false` for a wrong scan (already
   stored as evidence). V1.5 turned that into an unmapped code, i.e. a host 500, and PR #13 treats every 5xx as
   UNCERTAIN (reconcile). Now: WRONG_ITEM→`PACK_WRONG_SERIALIZED_ITEM`, ITEM_ALREADY_VERIFIED→`PACK_DUPLICATE_SCAN`,
   TRACKING_MISMATCH→`SHIP_TRACKING_MISMATCH`, and three **new catalog codes for Sourabh**: WRONG_SOURCE→
   `PACK_WRONG_SOURCE`, PACKAGE_MISMATCH→`SHIP_PACKAGE_LABEL_MISMATCH`, WRONG_LOCATION→`PACK_WRONG_OUTBOUND_LOCATION`.
   422 = PR #13 REJECTED (scan again).
9. **Five route codes V1.5 never mapped** (CSRF_VALIDATION_REQUIRED, X_REQUEST_ID_INVALID, X_CORRELATION_ID_INVALID,
   PACKSHIP_SNAPSHOT_VERSION_UNSUPPORTED, PACKSHIP_ROUTE_ACTION_UNKNOWN) and AUTH_SECURITY_DEPENDENCY_UNAVAILABLE (503).
10. **Mount on the Login V2 host** (`src/mount/loginV2PackShipMount.ts`). The PWA's session lives in the Login V2
    process (PM2 `login-v2-api`, :8095), not arb-api. Pack/Ship reuses the deployed 6.1B guards (requestIds,
    securityHeaders, noStore, exactOrigin, fetchMetadataGuard, requireCsrf → validate_session_csrf_v2) and reads the
    session with `runtime_session_envelope_by_token_v1(HMAC(cookie), NULL)` exactly like 6.1B's admin guard: no row →
    401, no PACKSHIP_PACK → 403, restricted → 403, identity DB down → 503. Pack/Ship SQL runs on its own pool as
    `tcds_login_packship` (member of `tcds_packship_api` only). On Pack/Ship paths, 6.1B's `{error:{code}}` bodies are
    re-emitted as `{code}` (what PR #13 reads); `/api/v1/auth` is untouched.
11. `packship_login.sh`: creates `tcds_login_packship` (SCRAM verifier only; URL written to Login V2 `config.json`).
    Created on production 2026-11-17; network test 6/6 as the role (operator functions yes; create, tables, identity,
    helpers denied).
12. **Session touch.** A valid Pack/Ship request extends the session's idle timer with
    `touch_auth_session_if_due_v3(session, 90)`, best-effort, exactly as 6.1B's `GET /api/v1/auth/session` does.
13. `host/identity-api-host.cjs` = the deployed host (sha16 1264a0a0a203919c) + one block that mounts Pack/Ship only
    when `config.json` has `packship.DATABASE_URL`, and closes its pool on shutdown.
14. `deploy_packship_routes.sh`: preflight (candidate host on 127.0.0.1:8097 with production config, 9 probes),
    apply (auto-restore on any failed probe), nginx (`/api/v1/packing/`, `/api/v1/shipments/` → :8095 with the
    `/api/v1/auth/` block's proxy settings; any other `/api/` → JSON 404), rollback, nginx-rollback, status.

15. **Gate states (after the first live read, 2026-11-17).** A fresh task showed CONTENTS and OUTBOUND as FAIL
    because every `packship__blockers` code counted as a failure. Now only real problems are FAIL (ITEM_ON_HOLD,
    ITEM_NOT_PACKABLE, EXCEPTION_OPEN, rejected evidence, and any blocker code not known to the mapper); the six
    "not done yet" codes (SOURCE_UNVERIFIED, ITEMS_UNVERIFIED, PACKAGE_MISSING, WEIGHT_MISSING, DIMENSIONS_MISSING,
    EVIDENCE_PENDING) show PENDING. PASS rules are unchanged. Deploy script: preflight/apply accept the original or
    this package's host (routes-only update); a failed apply and `rollback` restore host AND routes from before the
    last apply.

16. **Capture snapshot endpoint** (ours per the dev team's note to Sourabh, 2026-11-17):
    `GET /api/v1/warehouse-control/scanner/capture-snapshot` on the same host. Database: `930`
    `warehouse_control.get_capture_authority_snapshot_v1(device, facility)` implements scanner contract v1.0 §4
    (device-bound profile first, then the facility default; unusable device asset → 404 with no fallback; two
    facility defaults → 409; never a guess), executable only by new role `tcds_scanner_snapshot_api`, granted to
    `tcds_login_packship`. Response in PR #13's shape (`scannerProfile` + `symbologies` at the top level) plus `meta`
    (contractVersion 2.0, asset, binding, contentHash = ETag, If-None-Match → 304). Device and facility come from the
    session envelope only. Any valid unrestricted session (not PACKSHIP_PACK: it serves every scanner workflow).
    Proven against PR #13's own decoder + validator (verbatim copies) with the real 930 output.

## Verification
- `tsc 5.8.3 --strict` against real `express@5.1.0` / `@types/express@5.0.3` / `pg@8.16.3` types: clean.
- Jest: 60/60. Mount 24 (new: real Express 5 app + byte copy of the deployed 6.1B `security.ts`, fake pools),
  mapper 18 (new, including "a fully verified LABEL_VERIFIED task passes every blocking gate"), capture evidence 7 (the V1.2 fixture updated to V1.5's camera rule, plus 3 new
  refusals), validation, response binding, route service and route ownership unchanged.
- Not done here: mounting in `src/server.ts`, the identity adapter, a role-bound runtime test, the PWA build.

## Still placeholders (no authority exists yet)
`employeeName`, `sourceBarcode`, `itemLabelStatus`, `address`, `protection`, `rates`, `readiness.*`,
`localPendingCount`. Address, rates, risk, label purchase and print are ours (Anthony, 2026-11-17), to be wired to
the Domain 3/5 shipping services.
