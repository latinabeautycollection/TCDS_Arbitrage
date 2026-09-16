# Domain 6.2A Green Tier 1 Certification Checklist — Filled In (76 of 77)

This is a filled-in copy of the package's `docs/CERTIFICATION_CHECKLIST.md`, checked against the
merged code. Line numbers refer to `090f3a8`.

- Code commit: `090f3a8eb192faea26c79b7688d346d60bbad03e` on `scandit-integration` (includes the
  approved F-01 and F-02 fixes)
- Scandit Web SDK: 8.5.2
- Final certification run: 2026-09-15, from a completely clean install on `090f3a8`
- CI workflow commit: `c337eb9c67c1edc640fb25a7ce7ab093c506a05c`
- Evidence files on the integration server: `6.2a-certify.txt`, `6.2a-f01-f02-tests.txt`,
  `6.2a-https-check.txt`, `6.2a-ci-readiness.txt`, and the upgrade/rollback rehearsal folder

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

- [x] Exact Scandit SDK versions are pinned with no `^`, `~`, or `*`. — RUN: `package.json` 8.5.2 exact
- [x] Core and Barcode versions are identical. — RUN: parity PASS
- [x] `package-lock.json` is frozen and identical to installed versions. — RUN: `scandit:verify-version` PASS
- [x] Approved version record exists. — RUN: `docs/SCANDIT_VERSION_APPROVAL.md` present in the commit
- [x] Complete `sdc-lib` is copied recursively from all installed Scandit packages. — REVIEW: sync copies core and barcode; zero-byte `.gitkeep` excluded by name under approved change CR-6.2A-01
- [x] Runtime is stored under `/scandit/<EXACT_VERSION>/sdc-lib/`. — RUN: `public/scandit/8.5.2/sdc-lib/`
- [x] `runtime-manifest.json` contains SHA-256 for every runtime file. — RUN: 44 entries
- [x] All source runtime hashes verify. — RUN: `scandit:verify-runtime` PASS
- [x] At least one WASM and one JS runtime artifact exist. — RUN: 4 WASM, 5 JS
- [x] Built `dist/scandit/<VERSION>` exactly matches source manifest hashes. — RUN: `scandit:verify-dist` PASS
- [x] Nginx serves `.wasm` as `application/wasm`. — RUN (HTTPS check, 2026-09-15) against `https://warehouse-app.tcdsolutionsgroup.com/scandit/8.5.2/` after TCDS added the static `location ^~ /scandit/` route. All 4 `.wasm` files returned `200 application/wasm`, with 0 redirects and `content-length` equal to the manifest size. All 44 runtime files passed status, type, size, sha256 and `nosniff` checks. The served manifest is byte-identical to the certified build (sha256 `83ebcac5…`). Missing files return 404, not the app page. Evidence: `6.2a-https-check.txt`. Certification point 13.
- [x] Versioned runtime paths use immutable caching. — RUN 2026-09-15: every runtime file and the manifest return `cache-control: public, max-age=31536000, immutable`. The header applies to successful responses only: TCDS scoped it on 2026-09-16, and a re-check the same day showed that a missing file returns 404 with no cache header. Certification point 13.
- [x] No mutable `/latest` or `/current` runtime path is used. — RUN: 0 references in src, scripts, config

## Scandit runtime and observability

- [x] `DataCaptureContext` initializes without camera or capture-mode creation. — REVIEW `scanditRuntime.ts` calls only `DataCaptureContext.forLicenseKey`; RUN grep = 0. Certification point 14 (real-browser diagnostic) is not applicable to 6.2A by TCDS decision (2026-09-16): this slice has no UI, so the diagnostic runs in the consuming UI slice, 6.2B.
- [x] `DataCaptureContextListener.didChangeStatus` is registered. — REVIEW `scanditContextObserver.ts` lines 17–23; `addListener`/`removeListener` exist in the real 8.5.2 types; TEST observer
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
- [x] Context listener is removed during disposal. — TEST; real `removeListener` exists in 8.5.2
- [x] Loading subscription is removed during completion/disposal. — CR-6.2A-05 (F-01 fix, TCDS-approved). The observer removes its subscriber with `loadingStatus.unsubscribe(sameFn)`, matching the real 8.5.2 API, and the provider subscribes inside `try`, so `finally` always removes it. TEST: removal with the same function; no stacking across 4 init/dispose cycles; removal on failure; no stacking on retry; no subscriber left when a listener throws. Mutation checks: these tests fail on the previous code.
- [x] `getMetadata()` works before license configuration. — TEST
- [x] Raw Scandit SDK objects do not cross the provider boundary. — REVIEW: context is private; compatibility mapped to strings in `scanditCapabilities.ts` line 8; status and capabilities returned as copies
- [x] Raw Scandit exceptions do not cross the provider boundary. — CR-6.2A-06 (F-02 fix, TCDS decision "sanitize"). `ScannerProviderError` stores only a frozen, non-writable `{ name, message }` with redaction; the raw object, stack and fields are never kept. TEST: 15 sanitization tests, a catalog test and a provider failure test; these fail on the previous code. Related: F-06 (`ContextStatus` message path, low), accepted as-is for 6.2A by TCDS on 2026-09-16.

## PWA deployment enforcement

- [x] Scandit runtime is self-hosted. — REVIEW `scanditConfig.ts` lines 22–27 reject remote locations; TEST
- [x] Scandit runtime manifest is included in PWA caching. — RUN `scandit:verify-pwa-cache` PASS
- [x] Representative JS and WASM assets are included in PWA caching. — RUN: 45 precache entries, all `/scandit/8.5.2/`
- [x] Workbox maximum file size supports the runtime assets. — RUN: 10 MB limit, largest file 7.17 MB
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
- [x] Existing Domain 6 `check`/`verify`/regression suite remains green. — RUN: `npm run check` exit 0 and `npm run verify` exit 0. The repository has no screen regression suite. TCDS decision (2026-09-16, certification point 15): for this no-UI slice the automated suite is the regression surface (54/54 tests, verify-dist, verify-pwa-cache, build, upgrade/rollback), and formal screen regression applies at the UI slice. RUN: light HTTP smoke of the built app: `/`, `/login`, `/receiving`, `/sw.js`, `/manifest.webmanifest`, the runtime manifest and the main bundle all 200; the service worker precaches 45 `/scandit/8.5.2/` entries and no app assets.
- [x] Upgrade rehearsal passes with side-by-side versioned runtime assets. — RUN: 8.5.3 in its own directory, certify exit 0, 8.5.2 tree hash unchanged (rehearsed 2026-09-11; later changes touched no dependencies)
- [x] Rollback rehearsal restores prior app+SDK+runtime version atomically. — RUN: `package.json` and lockfile restored as a pair, certify exit 0, service worker back on 8.5.2. Integrity compared per runtime file (sha256). Rehearsed 2026-09-11; later changes touched no dependencies.
- [ ] Production promotion is impossible if any Scandit certification gate fails. — PARTIAL. The gate is installed at `.github/workflows/domain6-2a-scandit-certification.yml` (CR-6.2A-07, commit `c337eb9`). RUN: the first workflow run on PR #1 passed (run 35116665242: `npm ci`, `npm run verify`, `npm run scandit:certify`). `certify` is not yet a required status check on `develop` and `main`, so a failing run would not yet stop a merge. To close: a repository administrator makes it required. The workflow is path-filtered, so a path-scoped rule avoids blocking unrelated pull requests.

---

**Certification rule:** any unchecked ownership, structured-status, runtime-integrity,
provider-replacement, PWA-cache, or CI/CD item means 6.2A is not Green Tier 1.

| Unchecked item | Section | Owner |
|---|---|---|
| Promotion blocked on failure | CI/CD | TCDS administrator — make `certify` a required status check on `develop` and `main` |

Closed on 2026-09-15: Nginx `application/wasm` and immutable caching (TCDS static route,
HTTPS check 44/44), loading-subscription removal (CR-6.2A-05), raw exceptions (CR-6.2A-06).
Closed on 2026-09-16: regression suite (TCDS decision on point 15, plus light HTTP smoke).
Also on 2026-09-16, TCDS limited the immutable cache header to successful responses.
