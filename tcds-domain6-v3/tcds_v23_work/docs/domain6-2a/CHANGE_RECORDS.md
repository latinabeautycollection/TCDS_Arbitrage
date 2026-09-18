# Domain 6.2A — Change Records

Record fields: purpose, component, requirement, slice, dependencies, change, risks, compatibility,
API, tests, configuration, recovery, effect on other components, approval.
Slice: 6.2A Scandit Runtime Foundation
Code commit: `090f3a8eb192faea26c79b7688d346d60bbad03e` on branch `scandit-integration`
(it replaced an earlier local commit, never pushed, to include the approved F-01 and F-02 fixes)
Follow-up commit: `c337eb9c67c1edc640fb25a7ce7ab093c506a05c` (certification workflow, CR-6.2A-07)
Certification pack commit: `027fcc666afc110568d92743f85eafd3f2ad42e0` (first version of this pack; the last commit on 8.5.2)
SDK upgrade commit: `981a7ada55a3f8876dc1fe93e1102322770dc8cb` (Scandit 8.5.3, CR-6.2A-08)
Parent: `9846d0c`
Final certification: `scandit:certify` exit 0 from a clean install on `981a7ad` (Scandit 8.5.3,
2026-09-18); `npm run check` and `npm run verify` exit 0; 54/54 tests.

Each record below covers one material change made while merging the 6.2A package into the
Warehouse PWA. Each change was either found during certification or requested by TCDS, and TCDS approved
each one before it was applied. Line numbers, where given, refer to `090f3a8`.

---

## CR-6.2A-01 — Exclude `.gitkeep` from the Scandit runtime sync

| Field | Record |
|---|---|
| Purpose | Allow `scandit:certify` to pass on a clean install without weakening the zero-byte runtime check. |
| Affected component | `scripts/scandit/sync-scandit-runtime.mjs` |
| Requirement or defect | Defect found during certification. `@scandit/web-datacapture-core` 8.5.2 ships a zero-byte `sdc-lib/.gitkeep`. The sync script copied it, the manifest generator listed it, and `verify-scandit-runtime.mjs` rejected it with `Zero-byte runtime file: .gitkeep`. |
| Affected slice | 6.2A |
| Dependencies | None added. |
| Change | `fs.cpSync` now passes `filter: (source) => path.basename(source) !== '.gitkeep'`. |
| Risks | Low. The exclusion is by exact file name. Any other zero-byte artifact is still copied, still listed in the manifest, and still fails verification. |
| Compatibility impact | Runtime manifest file count changes from 45 to 44. `.gitkeep` is packaging metadata, not a runtime asset. |
| API impact | None. |
| Tests performed | Clean install; `scandit:prepare` produced 44 files; `.gitkeep` absent from `public/scandit/8.5.2/sdc-lib/` and from `runtime-manifest.json`; `scandit:verify-runtime` PASS; full `scandit:certify` exit 0 once CR-6.2A-01 to -03 were all applied. |
| Configuration impact | None. |
| Recovery considerations | Remove the `filter` option and re-run `scandit:prepare`. Certification will fail again on the zero-byte file. |
| Effect on other Domain 6 components | None. |
| Approval | Approved by the TCDS development team. The strict zero-byte validation was explicitly kept unchanged. |

---

## CR-6.2A-02 — Normalize `ProgressInfo.percentage` at the adapter boundary

| Field | Record |
|---|---|
| Purpose | Fix the strict TypeScript build failure `TS2322`. |
| Affected component | `src/lib/scanning/providers/scandit/scanditLoadingObserver.ts` |
| Requirement or defect | Defect found during certification. Scandit 8.5.2 types `ProgressInfo.percentage` as `number \| null`. The package declared `ScanditLoadProgress.percentage` as `number \| undefined` and assigned the value directly. `npm run build` failed. It was the only type error in the project. |
| Affected slice | 6.2A |
| Dependencies | None. |
| Change | `percentage: info.percentage ?? undefined` |
| Risks | Low. An unknown percentage is already represented by an absent value. |
| Compatibility impact | `ScanditLoadProgress` and `ScannerRuntimeStatus` are unchanged. The Scandit-specific `null` does not leave the adapter. |
| API impact | None. The provider-neutral contract is unchanged. |
| Tests performed | `tsc --noEmit` clean; 33/33 tests passed at the time (the suite is now 54/54); full `scandit:certify` exit 0 once CR-6.2A-01 to -03 were all applied. |
| Configuration impact | None. |
| Recovery considerations | Revert the single line. The build will fail with `TS2322`. |
| Effect on other Domain 6 components | None. |
| Approval | Approved by the TCDS development team on 2026-09-08 and 2026-09-09. Widening the interface to `number \| null` was explicitly rejected. |

---

## CR-6.2A-03 — Precache the Scandit runtime through the PWA service worker

| Field | Record |
|---|---|
| Purpose | Satisfy `scandit:verify-pwa-cache` so the exact Scandit runtime stays available to the installed PWA. |
| Affected components | `vite.config.ts` (plugin added); `public/sw.js` (placeholder removed). |
| Requirement or defect | 6.2A `docs/PWA_CACHE_INTEGRATION.md`, and the TCDS 20-point certification list, points 2 to 8 and 12. The previous `public/sw.js` contained only `skipWaiting` and `clients.claim` and cached nothing. |
| Affected slice | 6.2A |
| Dependencies | `vite-plugin-pwa` 1.3.0, supplied by the 6.2A package fragment. |
| Change | `VitePWA` with `injectRegister: null`, `registerType: 'prompt'`, `manifest: false`, `workbox.globPatterns: []`, `additionalManifestEntries: createScanditPrecacheEntries()`, `maximumFileSizeToCacheInBytes: SCANDIT_MAXIMUM_FILE_SIZE_TO_CACHE_BYTES`. |
| Risks | The service worker is app-wide. Mitigated: only the Scandit runtime is precached; no application assets, no `index.html`; no forced activation. |
| Compatibility impact | `/sw.js` registration path unchanged. `src/main.tsx` unchanged. `index.html` unchanged. `public/manifest.webmanifest` remains authoritative. |
| Update behaviour | The generated worker calls `skipWaiting()` only when the page posts a `SKIP_WAITING` message. A new worker waits for a controlled reload and never refreshes a running session. |
| API impact | None. |
| Tests performed | Build emitted `dist/sw.js` and `dist/workbox-*.js`; `scandit:verify-pwa-cache` PASS; 45 precache entries, all under `/scandit/8.5.2/`; 0 under `/assets/`; 0 for `index.html`; largest runtime file 7.17 MB against the 10 MB limit. |
| Configuration impact | `vite build` now requires `public/scandit/<version>/runtime-manifest.json` to exist. `prebuild` creates it before every build. |
| Recovery considerations | Restore `vite.config.ts` and `public/sw.js` from `9846d0c`. Browsers that already installed the new worker keep it until the next reload picks up the replacement. |
| Effect on other Domain 6 components | Offline transaction behaviour unchanged. No IndexedDB, sync, or replay code touched. |
| Approval | Required by the TCDS 20-point 6.2A certification list (points 2 to 8 and 12). |

---

## CR-6.2A-04 — Exclude the generated Scandit runtime from git

| Field | Record |
|---|---|
| Purpose | Avoid committing about 37 MB of generated WASM and JS for every Scandit version. |
| Affected component | `.gitignore` |
| Requirement or defect | TCDS decision received 2026-09-12: generated artifacts are not committed. |
| Affected slice | 6.2A |
| Dependencies | None. |
| Change | Added `public/scandit/`. |
| Risks | A deployment that skips the full build would ship without the runtime. The deploy pipeline must run `npm run build` (its `prebuild` step runs `scandit:prepare` and `scandit:preflight`), then `npm run scandit:verify-dist`. That pipeline is owned by TCDS. |
| Compatibility impact | None. |
| API impact | None. |
| Tests performed | `git check-ignore` confirms both runtime files and the manifest are ignored; the commit contains 0 files under `public/scandit/`; final certification from a clean install exit 0. |
| Configuration impact | Deployment requirement described above. |
| Recovery considerations | Remove the line. |
| Effect on other Domain 6 components | None. |
| Approval | TCDS decision received 2026-09-12. `scanditVersion.ts` stays committed, as instructed. |

---

## CR-6.2A-05 — Remove the Scandit loading subscriber with the same function (F-01)

| Field | Record |
|---|---|
| Purpose | Make sure the loading-progress subscriber is actually removed when initialization completes, fails, or the provider is disposed. |
| Affected components | `src/lib/scanning/providers/scandit/scanditLoadingObserver.ts`; `src/lib/scanning/providers/scandit/ScanditScannerProvider.ts`; `tests/scanning/ScanditScannerProvider.test.ts` |
| Requirement or defect | Finding F-01 (high). In the real Scandit 8.5.2 SDK, `loadingStatus.subscribe(subscriber)` returns `void`, and removal requires `loadingStatus.unsubscribe(subscriber)` with the same function. The previous cleanup called `unsubscribe` on the `undefined` return value, which did nothing, so one more subscriber stayed registered on every initialization. Checklist item: "Loading subscription is removed during completion/disposal." |
| Affected slice | 6.2A |
| Dependencies | None. |
| Change | The observer keeps a reference to its subscriber function, registers it with `loadingStatus.subscribe(subscriber)`, and the returned cleanup calls `loadingStatus.unsubscribe(subscriber)`. The `percentage ?? undefined` normalization from CR-6.2A-02 is unchanged. In `ScanditScannerProvider.initializeOnce`, the `INITIALIZING` status is now set before subscribing. The subscription is the first statement inside the `try` block, after a defensive removal of any previous subscriber, so the existing `finally` always removes it. Before this change, a runtime listener that threw on the `INITIALIZING` event skipped the `finally` and left a subscriber behind, which then stacked on the next attempt. The test mock now mirrors the real `LoadingStatus`: subscribers are kept in a `Set`, `subscribe` and `unsubscribe` return `void`, and removal needs the same function. Finding F-05 is resolved by this mock change. |
| Risks | Low. The observer's exported function signature is unchanged. The provider emits the same events in the same order: no progress event can occur between `INITIALIZING` and context creation. |
| Compatibility impact | 6.2B and 6.2C do not ship the observer, so that part survives. **6.2B replaces `ScanditScannerProvider.ts`**, and its copy has the same subscribe-outside-`try` structure (6.2B lines 183–204). When 6.2B is merged, the same provider change must be applied to the 6.2B copy, with TCDS approval, or the throwing-listener leak path returns. Recorded as a 6.2B prerequisite in `CERTIFICATION_FINDINGS.md`. |
| API impact | None. |
| Tests performed | Five new tests. (1) After initialization, `unsubscribe` is called once with the exact function passed to `subscribe`, and no subscriber remains; progress with `percentage: null` arrives as `undefined`. (2) No stacking across re-initialization: over four initialize/dispose cycles there is exactly 1 subscriber at each context creation and 0 afterwards, and a later progress notification changes no status and emits no event. (3) The subscriber is removed when initialization fails. (4) No stacking when initialization is retried after a failure, without dispose. (5) No subscriber is left when a runtime listener throws on `INITIALIZING` or on `LOAD_PROGRESS`, and a later retry and dispose leave 0. Mutation checks: with the previous observer, all 5 tests fail; with the previous provider placement, test 5 fails. The 6.2A code was also exercised against the real shipped Scandit 8.5.2 `LoadingStatus` singleton for success, failure, retry, concurrent initialize, dispose during init, and re-init after dispose: 0 subscribers left in every case. Our follow-up review found the throwing-listener path; it is fixed here. `npm run check` exit 0; `scandit:test` 54/54. |
| Configuration impact | None. |
| Recovery considerations | Revert the observer, the provider change and the test file. The leak returns. With only the observer reverted, all five new tests fail; with only the provider placement reverted, test 5 fails. |
| Effect on other Domain 6 components | None. |
| Approval | Approved by TCDS on 2026-09-15, including the mock correction and a test proving the listener is removed with no stacking across re-initialization. |

---

## CR-6.2A-06 — Keep only a redacted summary of provider errors (F-02)

| Field | Record |
|---|---|
| Purpose | Stop raw Scandit exceptions from travelling with `ScannerProviderError`, so no raw provider payload travels with errors. |
| Affected components | `src/lib/scanning/contracts/ScannerProviderError.ts`; new `tests/scanning/scannerProviderError.test.ts`; `tests/scanning/scanditErrorCatalog.test.ts`; `tests/scanning/ScanditScannerProvider.test.ts` (one test shared with CR-6.2A-05) |
| Requirement or defect | Finding F-02 (medium). The raw thrown error was attached as `ScannerProviderError.cause` in `scanditErrorCatalog.ts` and in three places in `ScanditScannerProvider.ts`. Checklist item: "Raw Scandit exceptions do not cross the provider boundary." |
| Affected slice | 6.2A |
| Dependencies | None. |
| Change | The constructor still accepts `cause?: unknown`, but it stores only `sanitizeProviderErrorCause(cause)`: a frozen `{ name, message }` object. It is defined once as a non-writable, non-configurable property, so it cannot be replaced later. The raw object, its stack, and any other fields are never kept. The sanitizer reads `name` and `message` once each, guarded, and never throws, even for hostile getters or proxies. **Name:** kept only if it matches `^[A-Z][A-Za-z]{0,63}$` (for example `TypeError`, `NotAllowedError`), otherwise `Error`. **Message:** cut to 1,000 characters before any matching, with the partial last word dropped. Percent-escapes decoded twice; NFKC normalized; zero-width, bidi and BOM characters removed; C0/C1 control characters replaced with spaces. Then replaced with `[redacted]`: authorization headers and their scheme credentials, bare bearer/basic credentials, key/value secrets (plain, compound such as `clientSecret`/`refresh_token`, quoted, or JSON style), JWTs, URLs, `blob:`/`data:`/`file:`/`mailto:` URIs, e-mail addresses, IPv6, absolute, home, relative and Windows paths, IPv4 (dotted and hex), host names (including digit-first), `host:port`, and token-like runs of 16+ characters containing a digit or 32+ characters. Whitespace is collapsed and the result cut to 160 characters. |
| Risks | Low. Some harmless detail, such as file names, API names or `and/or`, is also redacted. This trade-off is intentional; TCDS can ask for more diagnostic detail. Error classification is unaffected because `mapScanditError` and the provider still classify from the original message before the error is constructed. |
| Compatibility impact | The sanitizer lives in the provider-neutral contract, so every current and future call site is covered, including the 6.2B provider, which replaces `ScanditScannerProvider.ts` and still passes the raw error. 6.2B and 6.2C do not ship this file. The public `cause` type narrows from `unknown` to `ScannerProviderErrorCause \| undefined`, and no code reads `.cause`. |
| API impact | Additive exports: `ScannerProviderErrorCause`, `sanitizeProviderErrorCause`, `PROVIDER_ERROR_CAUSE_MESSAGE_MAX_LENGTH`, `PROVIDER_ERROR_CAUSE_INPUT_MAX_LENGTH`. Constructor signature unchanged. |
| Tests performed | 15 sanitizer tests: raw exception never kept, and output frozen with only `name` and `message`; cause cannot be reassigned; no cause when none given; URLs, hosts, IPs, e-mail addresses, paths, key values, bearer tokens and long tokens redacted; quoted, compound, JSON and percent-encoded secrets; authorization schemes and bare credentials, while plain words such as "basic barcode" are kept; IPv6, `host:port`, digit-first hosts, encoded URLs and hex IPv4, while times such as `12:34:56` are kept; absolute, home, relative and Windows paths including spaces; JWTs and shorter or letter-only tokens; invisible and control characters; length cap; a 100,000-character adversarial input finishes well under 1.5 s and leaks nothing past the input limit (the earlier version took 27.7 s); unsafe names; hostile getters and proxies never throw; non-Error values. One catalog test: the mapped error carries only `{ name: 'Error', message: 'Could not load [redacted]' }` and is still classified `RUNTIME_ASSET_NOT_FOUND`. One provider test (shared with CR-6.2A-05): an initialization failure exposes no URL or secret. Mutation checks: with the pre-fix error class, 17 tests fail; with the first sanitizer version, 10 of the 15 sanitizer tests fail. Our follow-up adversarial test pass (inputs designed to leak, timing checks, runtime property checks) found the gaps closed here, including an intermediate draft that did not fully redact `Authorization: Bearer` values. `npm run check` exit 0; `scandit:test` 54/54. |
| Configuration impact | None. |
| Recovery considerations | Revert the file. Raw exceptions will be attached again and the new tests fail. |
| Effect on other Domain 6 components | None. Nothing outside the scanning provider reads `cause`. |
| Approval | Decided by TCDS on 2026-09-15: remove the raw Scandit error and keep only a redacted name and short message. The exact redaction rule applied is recorded above for TCDS review. |

---

## CR-6.2A-07 — Install the 6.2A certification workflow

| Field | Record |
|---|---|
| Purpose | Run the 6.2A certification gate automatically on pull requests, so a failing gate is visible before merge and can block release. |
| Affected component | `.github/workflows/domain6-2a-scandit-certification.yml` (repository root, new). Commit `c337eb9`. |
| Requirement or defect | TCDS request (2026-09-16). 6.2A `docs/CI_CD_CERTIFICATION.md`. Checklist item "Production promotion is impossible if any Scandit certification gate fails". |
| Affected slice | 6.2A |
| Dependencies | GitHub Actions `actions/checkout@v4` and `actions/setup-node@v4`, and a Node.js 22 runner. See `DEPENDENCY_DISCLOSURE.md`. |
| Change | The supplied `config/ci/domain6-2a-scandit-certification.yml` was copied, byte-identical, to `.github/workflows/`. It runs `npm ci`, `npm run verify` and `npm run scandit:certify` in `tcds-domain6-v3/tcds_v23_work`. It triggers on pull requests and on pushes to `main`, in both cases only when the 6.2A paths change. |
| Risks | (1) A failing run blocks a merge only once `certify` is a required status check on `develop` and `main`, which a repository administrator must enable. Because the workflow is path-filtered, GitHub would keep a required `certify` check pending on pull requests that do not touch the 6.2A paths, and that blocks their merge. So the path filter must be removed from the `pull_request` trigger before the check is made required (a change to the workflow file, with TCDS approval); while the filter stays, the check cannot be made required without blocking other pull requests. (An earlier version of this record said a path-scoped rule avoids this. That was wrong.) (2) The path filter leaves out `tests/**` and the workflow file itself, so a test-only change does not trigger the gate. (3) Actions are referenced by major-version tags, not commit SHAs. (4) CI uses Node 22; local certification used Node 20. |
| Compatibility impact | None on the application. No application file changed. |
| API impact | None. |
| Tests performed | The YAML parses (one job, `certify`; triggers `pull_request` and `push`). The workflow references no secrets. Locally, `scandit:certify` and `npm run verify` pass with `VITE_SCANDIT_LICENSE_KEY` empty, and that build contains no license key. On GitHub, the first run on PR #1 (run 35116665242, head `c337eb9`) finished **success** in 51 s: `npm ci`, `npm run verify` and `npm run scandit:certify` all passed. |
| Configuration impact | No secret is required. A `VITE_SCANDIT_LICENSE_KEY` Actions secret, if added, is not read by this workflow. |
| Recovery considerations | Delete the workflow file. The gate stops running; nothing else changes. |
| Effect on other Domain 6 components | None. The 6.2B and 6.2C workflow templates are separate and not installed. |
| Approval | Requested by TCDS on 2026-09-16 for this pull request. |

---

## CR-6.2A-08 — Move the Scandit Web SDK to 8.5.3

| Field | Record |
|---|---|
| Purpose | Run the whole of Milestone 1 (6.2A, 6.2B, 6.2C) on one Scandit version. The 6.2B package's certification requires exactly 8.5.3. |
| Affected components | `package.json`, `package-lock.json`, `src/lib/scanning/providers/scandit/scanditVersion.ts` (generated), `docs/SCANDIT_VERSION_APPROVAL.md`. Commit `981a7ad`. |
| Requirement or defect | TCDS decision (2026-09-18): upgrade to 8.5.3 as its own commit in this pull request and repeat the complete 6.2A certification. The 6.2B package pins 8.5.3: `scripts/scandit/verify-domain6-2b-sdk-version.mjs` (`EXPECTED = "8.5.3"`) and `PACKAGE_MANIFEST.json` (`scanditWebTarget`). What in 6.2B needs 8.5.3 is recorded in `CERTIFICATION_FINDINGS.md`, section "Scandit 8.5.3 and 6.2B". |
| Affected slice | 6.2A. 6.2B and 6.2C use the same Scandit version. |
| Dependencies | `@scandit/web-datacapture-core` and `@scandit/web-datacapture-barcode` 8.5.3. See `DEPENDENCY_DISCLOSURE.md`. |
| Change | Both packages moved from 8.5.2 to exactly 8.5.3 together (`npm install --save-exact`). Only the two Scandit entries changed in the lockfile. `scanditVersion.ts` was regenerated by `scandit:version`. The approval record gained an 11-step update record. No hand-written source or test file changed; only the generated `scanditVersion.ts` was rebuilt. |
| Risks | (1) The deployed app loads the runtime from `/scandit/8.5.3/`, so the hosted route needs that folder before the new build is deployed. TCDS staged it from our build on 2026-09-18 and keeps 8.5.2 beside it. (2) Some test fixtures still use `8.5.2` as sample values (a mocked version constant, sample URLs, sample provider metadata, a comment). They do not read the installed version, so they are unaffected. (3) The runtime content fingerprint changes, because the barcode engine build changed. |
| Compatibility impact | No API change: all 571 TypeScript declaration files in both packages are identical between 8.5.2 and 8.5.3. The barcode engine and worker files changed. The only behaviour change in Scandit's 8.5.3 release notes applies to MatrixScan modes; 6.2A creates no capture mode, and the 6.2B boundary script forbids MatrixScan. |
| API impact | None. |
| Tests performed | From a clean install on 2026-09-18: `npm ci` and `scandit:prepare` exit 0; `scandit:certify` exit 0 (version parity PASS, runtime PASS with 44 files, 4 WASM, 5 JS, boundary PASS, 54/54 tests, build, verify-dist PASS, verify-pwa-cache PASS); `dist/sw.js` has 45 entries under `/scandit/8.5.3/` and none under `/scandit/8.5.2/`; `npm run check` and `npm run verify` exit 0. Rollback: the 8.5.2 `package.json` and `package-lock.json` restored from `027fcc6` (the last commit on 8.5.2), clean install and full certification exit 0 (fingerprint unchanged), then forward to 8.5.3 again, exit 0. `npm audit` unchanged. Runtime content fingerprint (8.5.3): `0d62034520f2f6fe989e0cee61c1900269ab07fd90058ea96906b5142e36d675`. CI: run 35368516071 on `981a7ad` (8.5.3) passed in 49 s: `npm ci`, `npm run verify`, `npm run scandit:certify`. HTTPS check of the hosted `/scandit/8.5.3/` (2026-09-18): 44/44 files pass (status, size, type, `nosniff`, sha256 against our build, immutable cache; `.wasm` served as `application/wasm`); the served manifest is byte-identical to our build; missing files return 404 with no cache header. |
| Configuration impact | The runtime path becomes `/scandit/8.5.3/`, and the service worker precaches 45 entries there. No new environment variable. |
| Recovery considerations | Restore the 8.5.2 `package.json`/`package-lock.json` pair (or revert `981a7ad`), then `npm ci`, `scandit:prepare` and `scandit:certify`. Proven on 2026-09-18. The hosted 8.5.2 runtime stays available (HTTPS check 44/44 on 2026-09-18). |
| Effect on other Domain 6 components | None outside the Scandit runtime. |
| Approval | Decided by TCDS on 2026-09-18: all of Milestone 1 (6.2A, 6.2B, 6.2C) uses Scandit 8.5.3. |

