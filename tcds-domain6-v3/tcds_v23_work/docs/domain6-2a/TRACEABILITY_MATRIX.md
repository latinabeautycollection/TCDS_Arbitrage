# Domain 6.2A — Traceability Matrix

Links each 6.2A requirement to code, tests and evidence.
Commits: `090f3a8eb192faea26c79b7688d346d60bbad03e` (6.2A code, including F-01/F-02),
`c337eb9c67c1edc640fb25a7ce7ab093c506a05c` (certification workflow),
`981a7ada55a3f8876dc1fe93e1102322770dc8cb` (Scandit 8.5.3)

Paths are relative to `tcds-domain6-v3/tcds_v23_work/`, except `.github/`, which is at the repository
root. Short names such as `contracts/…` and `runtime/…` are under `src/lib/scanning/`; `scandit*` files
are under `src/lib/scanning/providers/scandit/`. Evidence files are kept on the integration server.

Status: **Met** · **Partial** (implemented; one step outside the code remains) · **Open** ·
**N/A** (not applicable to 6.2A, by TCDS decision) · for findings: **Resolved**, **Accepted**, **Moved to 6.2B**

---

## A. 6.2A runtime foundation requirements (part of Milestone 1)

| ID | Requirement | Code | Tests | Evidence | Status |
|---|---|---|---|---|---|
| M1-01 | Scandit Web SDK integration | `package.json`; `src/lib/scanning/providers/scandit/` | architecture boundary | `scandit:verify-version` PASS; boundary PASS | Met |
| M1-02 | Runtime initialization | `scanditRuntime.ts`; `ScanditScannerProvider.initialize()` | single-flight; log level | `scandit:certify` exit 0 | Met |
| M1-03 | Licensing integration | `scanditConfig.ts`; `.env.example` | license required only for runtime; metadata without license | config tests | Met |
| M1-04 | SDK asset loading | `scripts/scandit/sync-*`, `generate-scandit-manifest.mjs`; `config/vite/scanditPwaPrecache.ts`; `vite.config.ts` | exact versioned path; remote rejected; non-root rejected | verify-runtime, verify-dist, verify-pwa-cache PASS | Met |
| M1-05 | Readiness | `contracts/ScannerRuntimeStatus.ts`; `runtime/scannerRuntimeAssertions.ts` | 4 runtime invariant tests | 54/54 | Met |
| M1-06 | Runtime diagnostics | `scanditContextObserver.ts`; `scanditContextStatusMapper.ts`; `runtime/scannerCapabilityDetector.ts` | observer; 6 mapper; capability detector | Unit tests pass. Real-browser diagnostic is N/A for 6.2A (TCDS, point 14) and belongs to 6.2B. | Met for 6.2A |
| M1-07 | Error handling | `contracts/ScannerProviderError.ts`; `scanditErrorCatalog.ts` | 3 error catalog; 15 cause sanitization; BLOCKED on license status; failure exposes no raw exception | Tests pass; raw exceptions no longer kept (CR-6.2A-06) | Met for 6.2A — F-06 accepted as-is by TCDS; F-03 is 6.2B scope |
| M1-08 | Lifecycle cleanup | `ScanditScannerProvider.initialize()`/`dispose()`; observer `removeListener`; `scanditLoadingObserver.ts` | disposes idempotently; observer unregisters; 5 loading-subscriber removal / no-stacking tests | Context listener and loading subscriber removed (CR-6.2A-05) | Met |
| M1-09 | Automated tests | `tests/scanning/` | 12 suites, 54 tests | `scandit:test` PASS; mutation checks prove the new tests fail on the previous code | Met |
| M1-10 | Documentation | `docs/`; this pack under `docs/domain6-2a/` | — | Committed with the 6.2A slice at TCDS request; referenced from PR #1 | Met — awaiting TCDS review |

---

## B. TCDS 20-point 6.2A certification list

| Pt | Requirement | Implementation / evidence | Status |
|---|---|---|---|
| 1 | Version fixed at 8.5.2 across core, barcode, lockfile, sdc-lib, manifest | Parity PASS. Moved to 8.5.3 on 2026-09-18 by TCDS decision (CR-6.2A-08); parity PASS on 8.5.3 across core, barcode, lockfile, `sdc-lib` and manifest | Met (8.5.3) |
| 2 | Keep `/sw.js` registration | `src/main.tsx` unchanged; `injectRegister: null` | Met |
| 3 | Replace placeholder `sw.js` only if needed | Removed; generated worker replaces it — CR-6.2A-03 | Met |
| 4 | `vite-plugin-pwa`; keep existing manifest | `manifest: false` | Met |
| 5 | Cache runtime and manifest under `/scandit/8.5.2/` | 45 precache entries; under `/scandit/8.5.3/` since 2026-09-18 | Met (8.5.3) |
| 6 | Max precache size ≥ largest runtime file, target 10 MB | 10 MiB; largest 7.17 MiB (8.5.2 and 8.5.3) | Met |
| 7 | No unrelated precache | `globPatterns: []`; 0 `/assets/`, 0 `index.html` | Met |
| 8 | No forced reload | `registerType: 'prompt'`; `skipWaiting` only on message | Met |
| 9 | `verify-pwa-cache` validates outcome | Already inspects built worker; no change needed | Met |
| 10 | Clean build from scratch | `rm -rf node_modules public/scandit dist`; `npm ci` | Met |
| 11 | Strict chain in order | `scandit:prepare` (sync → version → manifest) → preflight (verify-version → verify-runtime → boundary) → lint-boundary → tests → build (`tsc` + vite) → verify-dist → verify-pwa-cache. All TCDS-listed gates run; any failure stops the chain | Met |
| 12 | PWA cache certification | `scandit:verify-pwa-cache` PASS | Met |
| 13 | HTTPS asset smoke tests | TCDS added a static `location ^~ /scandit/` route (2026-09-15). HTTPS check: all 44 files return 200 with 0 redirects, correct type (`application/wasm` for all 4 WASM files), `content-length` matching the manifest, sha256 matching the manifest, `nosniff` and `immutable`. The manifest reports 8.5.2, both packages and 44 hashes, and is byte-identical to the certified build. Missing files return 404. Evidence: `6.2a-https-check.txt`. Re-run on 8.5.3 (2026-09-18, after TCDS staged it from our build): 44/44 pass with the same checks, `application/wasm` for all 4 WASM files, the served manifest byte-identical to our build (content fingerprint `0d620345…`), missing files 404 with no cache header; 8.5.2 still served (44/44) | Met (8.5.2 and 8.5.3) |
| 14 | Browser runtime diagnostic | 6.2A has no screens. TCDS decided on 2026-09-16 that this point does not apply to 6.2A; it runs in 6.2B, which adds the scanner screen | N/A |
| 15 | Domain 6 regression tests | TCDS decided on 2026-09-16 that, because 6.2A has no screens, its automated checks serve as its regression tests (54/54, verify-dist, verify-pwa-cache, build, upgrade/rollback). `check` and `verify` exit 0 on 8.5.2 and on 8.5.3 (2026-09-18); light HTTP smoke of the built app passed (2026-09-16, on 8.5.2) | Met |
| 16 | Architecture boundary intact | Boundary script, ESLint and test PASS | Met |
| 17 | Zero warehouse business operations | Source greps for camera, permission, capture, decode, network, storage, database all 0 | Met |
| 18 | Upgrade and rollback | Rehearsed 8.5.2 → 8.5.3 → 8.5.2 on 2026-09-11. Real upgrade to 8.5.3 on 2026-09-18 (CR-6.2A-08); rollback to 8.5.2 and forward again re-proven on the current code, certify exit 0 each time | Met |
| 19 | Final certify after all gates | Exit 0 from a clean install on `981a7ad` (8.5.3, 2026-09-18); earlier on `090f3a8` (8.5.2); point 13 passed on 8.5.2 (2026-09-15) and on 8.5.3 (2026-09-18); point 14 N/A; point 15 met; CI gate installed (`c337eb9`) and passed on 8.5.3 (run 35368516071) | Met |
| 20 | 6.2A corrections committed together, evidence in PR | `090f3a8` holds all 6.2A code corrections, including the approved F-01 and F-02 fixes. Follow-up commits add the CI workflow (`c337eb9`) and this pack (`027fcc6`), then move the SDK to 8.5.3 (`981a7ad`) and update this pack. Pushed; PR #1 open with the evidence summary | Met — awaiting TCDS review |

---

## C. Change records

| Record | Change | File | Requirement |
|---|---|---|---|
| CR-6.2A-01 | Exclude `.gitkeep` from runtime sync | `scripts/scandit/sync-scandit-runtime.mjs` | M1-04; runtime integrity |
| CR-6.2A-02 | Normalize `percentage` null → undefined | `src/lib/scanning/providers/scandit/scanditLoadingObserver.ts` | M1-02; strict build |
| CR-6.2A-03 | Precache Scandit runtime in service worker | `vite.config.ts`, `public/sw.js` | M1-04; points 2–8, 12 |
| CR-6.2A-04 | Gitignore generated runtime | `.gitignore` | TCDS decision on generated artifacts |
| CR-6.2A-05 | Remove loading subscriber with the same function (F-01) | `scanditLoadingObserver.ts`, `ScanditScannerProvider.ts`, provider tests | M1-08; checklist lifecycle item |
| CR-6.2A-06 | Keep only a redacted summary in `cause` (F-02) | `contracts/ScannerProviderError.ts`, new sanitization tests, catalog test, provider test | M1-07; checklist raw-exception item |
| CR-6.2A-07 | Install the certification workflow | `.github/workflows/domain6-2a-scandit-certification.yml` (repository root) | Checklist CI/CD item; TCDS request 2026-09-16 |
| CR-6.2A-08 | Move the Scandit Web SDK to 8.5.3 | `package.json`, `package-lock.json`, `scanditVersion.ts`, `docs/SCANDIT_VERSION_APPROVAL.md` | Points 1, 5, 6, 13, 18, 19; TCDS decision 2026-09-18 |

---

## D. Findings mapped to checklist items

| Finding | Checklist item affected | Requirement | Status |
|---|---|---|---|
| F-01 | Loading subscription is removed during completion/disposal | M1-08 | Resolved — CR-6.2A-05 |
| F-02 | Raw Scandit exceptions do not cross the provider boundary | M1-07 | Resolved — CR-6.2A-06 |
| F-03 | Status codes normalized through deterministic mappings — correct for 6.2A, not for camera errors in 6.2B | M1-07 | Open — before 6.2B |
| F-04 | Recovery back to Success is observable — confirm success code on real device | M1-06 | Moved to 6.2B with the browser diagnostic |
| F-05 | Automated testing — mock fidelity | M1-09 | Resolved — part of CR-6.2A-05 |
| F-06 | Error handling — `ContextStatus` message redaction | M1-07 | Accepted for 6.2A (TCDS, 2026-09-16); revisit only if QA raises it |
| F-07 | None in 6.2A (6.2B `BarcodeCaptureError.cause` raw errors) | 6.2B | Open — before 6.2B |

---

## E. Open item

| Item | Status | Owner |
|---|---|---|
| Checklist CI/CD item "Production promotion is impossible if any Scandit certification gate fails" | Partial — workflow installed; its runs on PR #1 passed (35116665242 and 35118247518 on 8.5.2, 35368516071 on 8.5.3); `certify` is not yet a required status check on `develop` and `main`. The workflow is path-filtered, so the `pull_request` path filter must be removed before the check can be made required without blocking other pull requests | TCDS repository administrator |
