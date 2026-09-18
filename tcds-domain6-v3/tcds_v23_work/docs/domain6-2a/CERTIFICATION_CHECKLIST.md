# Domain 6.2A Green Tier 1 Certification Checklist — Filled In (76 of 77)

This is a filled-in copy of the package's `docs/CERTIFICATION_CHECKLIST.md`, checked against the
merged code. Line numbers refer to `090f3a8`.

- Code commit: `090f3a8eb192faea26c79b7688d346d60bbad03e` on `scandit-integration` (includes the
  approved F-01 and F-02 fixes)
- SDK upgrade commit: `981a7ada55a3f8876dc1fe93e1102322770dc8cb` (Scandit 8.5.2 → 8.5.3, CR-6.2A-08)
- Scandit Web SDK: 8.5.3 (certified on 8.5.2 first; moved to 8.5.3 on 2026-09-18 by TCDS decision)
- Final certification run: 2026-09-18, from a completely clean install on `981a7ad` (8.5.3). Earlier run: 2026-09-15 on `090f3a8` (8.5.2)
- Runtime content fingerprint (sha256 of the manifest's `path:sha256` entries, sorted and joined with `|`): 8.5.3 `0d62034520f2f6fe989e0cee61c1900269ab07fd90058ea96906b5142e36d675`; 8.5.2 `1da2966c16fc22399863783dd1ac0366f34ea35e5f34073ecb353946980be3fe`
- CI workflow commit: `c337eb9c67c1edc640fb25a7ce7ab093c506a05c`
- Certification pack commit: `027fcc666afc110568d92743f85eafd3f2ad42e0` (first version of this pack; the last commit on 8.5.2)
- Evidence files on the integration server: `6.2a-certify.txt`, `6.2a-f01-f02-tests.txt`,
  `6.2a-https-check.txt`, `6.2a-ci-readiness.txt`, the upgrade/rollback rehearsal folder, and the 8.5.3 upgrade folder

**Evidence types**

| Tag | Meaning |
|---|---|
| RUN | A command was executed and its output observed |
| TEST | A named automated test exists and passed (54/54) |
| REVIEW | Source code was read and the behaviour confirmed at the cited lines |
| PARTIAL | Implemented and run; one setting outside the code is still needed |

**Result: 76 of 77 items met. 6.2A is not yet Green Tier 1.**
Under the checklist's own rule, the 1 unchecked item below must be closed first. It needs a
repository administrator setting, not a code change.

Certification point 14 (browser runtime diagnostic) is not a checklist item. TCDS marked it not
applicable to 6.2A on 2026-09-16 because this slice has no UI. It runs in 6.2B.

---

## Ownership and collision protection

- [x] Existing Domain 6 feature folders are unchanged. — RUN: commit touches 0 paths under `src/features/`
- [x] No warehouse business API contract is replaced. — RUN: commit changes no source outside `src/lib/scanning/`; 0 `/api/` references
- [x] No warehouse schema/database migration exists for 6.2A. — RUN: 0 `.sql` or migration files in commit
- [x] No Camera is instantiated. — RUN: source grep for Camera construction = 0
- [x] No camera permission is requested. — RUN: `getUserMedia(` = 0, permissions API = 0
- [x] No BarcodeCapture mode is instantiated. — RUN: grep = 0; REVIEW `scanditModuleLoader.ts` only registers `barcodeCaptureLoader()`
- [x] No barcode is decoded. — RUN: `didScan` = 0
- [x] No warehouse business mutation is performed. — RUN: `fetch(`/axios/XHR = 0, storage APIs = 0, database references = 0
- [x] Scandit imports are restricted to `src/lib/scanning/providers/scandit/**`. — RUN `verify-scandit-boundary.mjs` PASS; TEST architecture boundary
- [x] Script boundary check passes. — RUN: PASS
- [x] ESLint `no-restricted-imports` boundary check passes. — RUN: `scandit:lint-boundary` exit 0

## Version and runtime integrity

- [x] Exact Scandit SDK versions are pinned with no `^`, `~`, or `*`. — RUN: `package.json` 8.5.3 exact, both packages
- [x] Core and Barcode versions are identical. — RUN: parity PASS
- [x] `package-lock.json` is frozen and identical to installed versions. — RUN: `scandit:verify-version` PASS
- [x] Approved version record exists. — RUN: `docs/SCANDIT_VERSION_APPROVAL.md` present; updated for 8.5.3 in `981a7ad` with the 11-step update record
- [x] Complete `sdc-lib` is copied recursively from all installed Scandit packages. — REVIEW: sync copies core and barcode; zero-byte `.gitkeep` excluded by name under approved change CR-6.2A-01
- [x] Runtime is stored under `/scandit/<EXACT_VERSION>/sdc-lib/`. — RUN: `public/scandit/8.5.3/sdc-lib/`
- [x] `runtime-manifest.json` contains SHA-256 for every runtime file. — RUN: 44 entries. Their content fingerprint is listed at the top of this checklist
- [x] All source runtime hashes verify. — RUN: `scandit:verify-runtime` PASS
- [x] At least one WASM and one JS runtime artifact exist. — RUN: 4 WASM, 5 JS
- [x] Built `dist/scandit/<VERSION>` exactly matches source manifest hashes. — RUN: `scandit:verify-dist` PASS
- [x] Nginx serves `.wasm` as `application/wasm`. — RUN 2026-09-18 on 8.5.3 (after TCDS staged it from our build): all 44 runtime files passed status 200, 0 redirects, size, `content-length`, type, `nosniff`, sha256 against our build, and the immutable cache header; the 4 `.wasm` files returned `application/wasm`. The served manifest is byte-identical to our build (content fingerprint `0d620345…`). Missing files and the folder URL return 404 with no cache header. 8.5.2 is still served (44/44). Evidence: the 8.5.3 upgrade folder. Earlier: RUN (HTTPS check, 2026-09-15) against `https://warehouse-app.tcdsolutionsgroup.com/scandit/8.5.2/` after TCDS added the static `location ^~ /scandit/` route. All 4 `.wasm` files returned `200 application/wasm`, with 0 redirects and `content-length` equal to the manifest size. All 44 runtime files passed status, type, size, sha256 and `nosniff` checks. The served manifest is byte-identical to the certified build (sha256 `83ebcac5…`). Missing files return 404, not the app page. Evidence: `6.2a-https-check.txt`. Certification point 13.
- [x] Versioned runtime paths use immutable caching. — RUN 2026-09-18 on 8.5.3: all 44 runtime files and the manifest return `cache-control: public, max-age=31536000, immutable`; missing files return 404 with no cache header. Earlier: RUN 2026-09-15: every runtime file and the manifest return `cache-control: public, max-age=31536000, immutable`. The header applies to successful responses only: TCDS scoped it on 2026-09-16, and a re-check the same day showed that a missing file returns 404 with no cache header. Certification point 13.
- [x] No mutable `/latest` or `/current` runtime path is used. — RUN: 0 references in src, scripts, config

## Scandit runtime and observability

- [x] `DataCaptureContext` initializes without camera or capture-mode creation. — REVIEW `scanditRuntime.ts` calls only `DataCaptureContext.forLicenseKey`; RUN grep = 0. Certification point 14 (real-browser diagnostic) is not applicable to 6.2A by TCDS decision (2026-09-16): this slice has no UI, so the diagnostic runs in the consuming UI slice, 6.2B.
- [x] `DataCaptureContextListener.didChangeStatus` is registered. — REVIEW `scanditContextObserver.ts` lines 17–23; `addListener`/`removeListener` exist in the real 8.5.2 types (identical in 8.5.3); TEST observer
- [x] Structured `ContextStatus.code/isValid/message` is observed. — REVIEW mapper; TEST "moves to BLOCKED on structured license status"
- [x] Scandit context status codes are normalized through deterministic mappings. — TEST 6 mapper tests. Note F-03 (6.2B scope).
- [x] Message-string matching is fallback-only before structured status exists. — REVIEW `scanditErrorCatalog.ts` lines 17–30; TEST
- [x] License/context failures produce provider-neutral error codes. — TEST mapper and provider BLOCKED test
- [x] Provider status code/category are available in runtime status/events. — REVIEW `ScanditScannerProvider.ts` lines 341–407 and 238–242
- [x] Provider recovery from invalid status back to Success is observable. — TEST code 6 then code 1 → ready; `RECOVERED` event at line 376. See F-04: the success code is confirmed on a real device in 6.2B.
- [x] Loading progress is observable. — REVIEW `ScanditScannerProvider.ts` lines 176–187 emit `LOAD_PROGRESS`; TEST progress event with `percentage: null` arrives as `undefined`
- [x] Configured Scandit `logLevel` is passed into context creation. — REVIEW `scanditRuntime.ts` line 10; TEST
- [x] Missing required browser primitives result in BLOCKED. — REVIEW detector lines 28–43; provider lines 71–85 and 428–435
- [x] Optional acceleration deficiencies result in DEGRADED, not silent READY. — TEST
- [x] SharedArrayBuffer absence remains informational for 6.2A single-barcode scope. — REVIEW detector lines 41 and 47; provider lines 410–412

## Provider abstraction and lifecycle

- [x] `WarehouseScannerProvider` remains provider-neutral. — TEST contract
- [x] Provider registry supports replacement/injection. — TEST registry
- [x] Test provider satisfies the same contract. — TEST contract (`TestScannerProvider`)
- [x] Domain 6 does not need a Scandit-specific type to compile. — TEST architecture boundary
- [x] `initialize()` is single-flight/idempotent. — TEST
- [x] Multiple concurrent initialize calls create one context. — TEST: three concurrent calls, one `forLicenseKey`
- [x] `dispose()` is safe/idempotent. — TEST: two calls, one dispose
- [x] Context listener is removed during disposal. — TEST; real `removeListener` exists in 8.5.2 (identical in 8.5.3)
- [x] Loading subscription is removed during completion/disposal. — CR-6.2A-05 (F-01 fix, TCDS-approved). The observer removes its subscriber with `loadingStatus.unsubscribe(sameFn)`, matching the real 8.5.2 API (identical in 8.5.3), and the provider subscribes inside `try`, so `finally` always removes it. TEST: removal with the same function; no stacking across 4 init/dispose cycles; removal on failure; no stacking on retry; no subscriber left when a listener throws. Mutation checks: these tests fail on the previous code.
- [x] `getMetadata()` works before license configuration. — TEST
- [x] Raw Scandit SDK objects do not cross the provider boundary. — REVIEW: context is private; compatibility mapped to strings in `scanditCapabilities.ts` line 8; status and capabilities returned as copies
- [x] Raw Scandit exceptions do not cross the provider boundary. — CR-6.2A-06 (F-02 fix, TCDS decision "sanitize"). `ScannerProviderError` stores only a frozen, non-writable `{ name, message }` with redaction; the raw object, stack and fields are never kept. TEST: 15 sanitization tests, a catalog test and a provider failure test; these fail on the previous code. Related: F-06 (`ContextStatus` message path, low), accepted as-is for 6.2A by TCDS on 2026-09-16.

## PWA deployment enforcement

- [x] Scandit runtime is self-hosted. — REVIEW `scanditConfig.ts` lines 22–27 reject remote locations; TEST
- [x] Scandit runtime manifest is included in PWA caching. — RUN `scandit:verify-pwa-cache` PASS
- [x] Representative JS and WASM assets are included in PWA caching. — RUN: 45 precache entries, all `/scandit/8.5.3/` (2026-09-18)
- [x] Workbox maximum file size supports the runtime assets. — RUN: 10 MiB limit; largest file 7.17 MiB (7,520,894 bytes on 8.5.3; 7,520,838 bytes on 8.5.2)
- [x] `scandit:verify-pwa-cache` passes against the built service worker. — RUN: PASS
- [x] Existing Domain 6 offline transaction ownership is unchanged. — RUN: `globPatterns: []`, 0 app assets precached, 0 storage references, no source outside `src/lib/scanning/` changed

## Automated testing

- [x] Scanner provider contract tests pass. — TEST
- [x] Capability detector tests pass. — TEST
- [x] Runtime invariant tests pass. — TEST (4)
- [x] Scandit config tests pass. — TEST (5)
- [x] ContextStatus mapper tests pass. — TEST (6)
- [x] Context observer tests pass. — TEST
- [x] Error catalog tests pass. — TEST (3), plus 15 `ScannerProviderError` cause-sanitization tests
- [x] Provider registry/replacement tests pass. — TEST (3)
- [x] Provider factory tests pass. — TEST (2)
- [x] Scandit provider single-flight tests pass. — TEST
- [x] Scandit provider structured-status tests pass. — TEST
- [x] Scandit provider recovery tests pass. — TEST
- [x] Scandit provider degradation tests pass. — TEST
- [x] Scandit provider disposal tests pass. — TEST
- [x] Architecture-boundary test passes. — TEST

## CI/CD and certification

- [x] Production `prebuild` executes Scandit prepare/preflight or equivalent combined gate. — RUN: observed before every build
- [x] `npm run scandit:certify` passes. — RUN: exit 0 from a clean install
- [x] TypeScript production build passes. — RUN: `tsc --noEmit` clean; `vite build` PASS
- [x] Existing Domain 6 `check`/`verify`/regression suite remains green. — RUN: `npm run check` exit 0 and `npm run verify` exit 0. The repository has no screen regression suite. TCDS decided on 2026-09-16 (certification point 15) that, because 6.2A has no screens, its automated checks serve as its regression tests (54/54 tests, verify-dist, verify-pwa-cache, build, upgrade/rollback); screen regression testing happens in the slice that adds screens. RUN: light HTTP smoke of the built app: `/`, `/login`, `/receiving`, `/sw.js`, `/manifest.webmanifest`, the runtime manifest and the main bundle all 200; the service worker precaches 45 `/scandit/8.5.2/` entries and no app assets (2026-09-16, on 8.5.2). On 8.5.3 (2026-09-18): `npm run check` and `npm run verify` exit 0.
- [x] Upgrade rehearsal passes with side-by-side versioned runtime assets. — RUN: real upgrade to 8.5.3 on 2026-09-18 (CR-6.2A-08): new runtime in its own `/scandit/8.5.3/` directory, full clean certification exit 0 with no code changes. Side by side: rehearsed on 2026-09-11 (8.5.2 tree hash unchanged next to 8.5.3). On the hosted route, TCDS stages 8.5.3 from our pushed build and keeps 8.5.2 beside it: RUN 2026-09-18, both `/scandit/8.5.2/` and `/scandit/8.5.3/` pass the HTTPS check (44/44 each).
- [x] Rollback rehearsal restores prior app+SDK+runtime version atomically. — RUN 2026-09-18 on the current code: the 8.5.2 `package.json` and lockfile restored as a pair from `027fcc6` (the last commit on 8.5.2), clean install, full certification exit 0, fingerprint `1da2966c…` (unchanged), service worker back on `/scandit/8.5.2/` (45 entries); then forward to 8.5.3 again, exit 0. Integrity compared per runtime file (sha256). First rehearsed 2026-09-11.
- [ ] Production promotion is impossible if any Scandit certification gate fails. — PARTIAL. The gate is installed at `.github/workflows/domain6-2a-scandit-certification.yml` (CR-6.2A-07, commit `c337eb9`). RUN: the first workflow run on PR #1 passed (run 35116665242: `npm ci`, `npm run verify`, `npm run scandit:certify`). RUN 2026-09-18: run 35368516071 on `981a7ad` (8.5.3) passed in 49 s: `npm ci`, `npm run verify`, `npm run scandit:certify`. `certify` is not yet a required status check on `develop` and `main`, so a failing run would not yet stop a merge. To close: a repository administrator makes it required. The workflow is path-filtered. GitHub keeps a required check "pending" when a path filter skips the workflow, and that blocks the merge. So the path filter must be removed from the `pull_request` trigger before `certify` is made required (a change to the workflow file, with TCDS approval). While the filter stays, the check cannot be made required without blocking other pull requests, so this item stays open. (An earlier version of this pack said a path-scoped rule avoids this. That was wrong.)

---

**Certification rule:** any unchecked ownership, structured-status, runtime-integrity,
provider-replacement, PWA-cache, or CI/CD item means 6.2A is not Green Tier 1.

| Unchecked item | Section | Owner |
|---|---|---|
| Promotion blocked on failure | CI/CD | TCDS administrator — make `certify` a required status check on `develop` and `main` (see the path-filter note above) |

Closed on 2026-09-15: Nginx `application/wasm` and immutable caching (TCDS static route,
HTTPS check 44/44), loading-subscription removal (CR-6.2A-05), raw exceptions (CR-6.2A-06).
Closed on 2026-09-16: regression suite (TCDS decision on point 15, plus light HTTP smoke).
Also on 2026-09-16, TCDS limited the immutable cache header to successful responses.
On 2026-09-18: Scandit moved to 8.5.3 and 6.2A re-certified from a clean install, with rollback proven (CR-6.2A-08). CI on 8.5.3 passed (run 35368516071 on `981a7ad` (8.5.3)). HTTPS check of `/scandit/8.5.3/` passed 44/44 after TCDS staged it from our build, and 8.5.2 is still served.
