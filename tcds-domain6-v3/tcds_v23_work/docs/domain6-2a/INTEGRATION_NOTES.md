# Domain 6.2A — Integration Notes

This document describes the work as implemented in commits
`090f3a8eb192faea26c79b7688d346d60bbad03e` (6.2A code) and
`c337eb9c67c1edc640fb25a7ce7ab093c506a05c` (certification workflow), not planned behaviour.

The package's own design documents remain the primary reference and are committed under
`tcds-domain6-v3/tcds_v23_work/docs/`: `OWNERSHIP.md`, `PRODUCTION_MERGE_GUIDE.md`,
`PWA_CACHE_INTEGRATION.md`, `CI_CD_CERTIFICATION.md`, `UPGRADE_ROLLBACK.md`,
`SCANDIT_VERSION_APPROVAL.md`, `HARDENING_REPORT.md`, `REMEDIATION_MATRIX.md`, and the blank
`CERTIFICATION_CHECKLIST.md` template (the filled-in copy is in `docs/domain6-2a/`).

---

## 1. Scope

**Delivered in 6.2A:** Scandit Web SDK 8.5.2 runtime, provider-neutral scanner contracts, provider
registry and factory, runtime status and events, self-hosted runtime asset pipeline, PWA runtime
cache, boundary enforcement, automated tests.

**Not in 6.2A, by design:** camera, camera permission, `BarcodeCapture`, barcode decoding,
`WarehouseScanObservation`, warehouse workflows, API calls, database access. A barcode cannot be
decoded in 6.2A.

## 2. What was merged

All paths are relative to `tcds-domain6-v3/tcds_v23_work/`.

| Path | Contents |
|---|---|
| `src/lib/scanning/contracts/` | 6 provider-neutral contracts |
| `src/lib/scanning/runtime/` | 6 files: provider and runtime registries, built-in provider registration, factory, capability detector, runtime assertions |
| `src/lib/scanning/providers/scandit/` | 12 files: the only code allowed to import `@scandit/*` |
| `scripts/scandit/` | 9 sync, manifest and verification scripts |
| `config/` | ESLint boundary, Vitest, Vite precache helper, Nginx snippet, CI workflow |
| `tests/scanning/` | 13 files: 12 test suites and one test provider |
| `docs/` | 9 package documents |
| `docs/domain6-2a/` | This certification pack |

Existing application files changed: `package.json`, `package-lock.json`, `.env.example`,
`.gitignore`, `vite.config.ts`. Removed: `public/sw.js`. Added at the repository root:
`.github/workflows/domain6-2a-scandit-certification.yml`. Package files that differ from the
delivered 6.2A package are listed in `CERTIFICATION_FINDINGS.md`. See also `CHANGE_RECORDS.md`.

## 3. Configuration

| Variable | Default | Behaviour |
|---|---|---|
| `VITE_SCANNER_PROVIDER` | `scandit` | Selects the built-in scanner provider |
| `VITE_SCANDIT_LICENSE_KEY` | — | Required only when the runtime is enabled. Missing key → `FAILED` with `LICENSE_CONFIGURATION_MISSING`. Browser-visible by nature of the Web SDK. Never committed; `.env` is gitignored. |
| `VITE_SCANDIT_LIBRARY_BASE` | `/scandit` | Must be same-origin and root-relative. `http://` or `https://` values are rejected. Runtime resolves to `<base>/<version>/sdc-lib/`. |
| `VITE_SCANDIT_LOG_LEVEL` | `warn` | `off`, `error`, `warn`, `info`, `debug`. Any other value falls back to `warn`. `off` maps to Scandit `Logger.Level.Quiet`. |
| `VITE_SCANDIT_RUNTIME_ENABLED` | `true` | Only the exact value `false` disables the runtime → `BLOCKED` with `PROVIDER_DISABLED`. |

Provider metadata (`getMetadata()`) works without a license key, so diagnostics can read provider,
version and runtime location before licensing is configured.

## 4. Build and certification

Run everything from `tcds-domain6-v3/tcds_v23_work/`. All scripts use the current directory.

```bash
npm ci
npm run scandit:prepare     # sync runtime, generate version contract, generate manifest
npm run scandit:certify     # preflight, boundary lint, tests, build, verify-dist, verify-pwa-cache
```

`prebuild` runs `scandit:prepare` and `scandit:preflight` automatically before every `npm run build`.

`scandit:certify` begins with preflight, which checks the runtime. On a completely clean checkout,
run `scandit:prepare` first.

**Generated runtime.** `public/scandit/` is produced by `scandit:sync` from the pinned packages
and is gitignored. `src/lib/scanning/providers/scandit/scanditVersion.ts` is also generated, but
is committed; its generator is deterministic and writes identical bytes on every run.

**Deployment requirement.** Any environment that deploys the application must run `npm run build`
(its `prebuild` step runs `scandit:prepare` and `scandit:preflight`) and then
`npm run scandit:verify-dist`, otherwise the runtime will be missing.

**CI gate.** `.github/workflows/domain6-2a-scandit-certification.yml` runs `npm ci`,
`npm run verify` and `npm run scandit:certify` on Node 22 for pull requests that change the 6.2A
paths, and on pushes to `main` that change the same paths. `npm run verify` builds first, and `prebuild` generates the
runtime, so `scandit:certify` finds it on a clean runner. The workflow reads no secrets.

- A failing run blocks a merge only when `certify` is a **required** status check on `develop`
  and `main`, which a repository administrator must enable. Because the workflow is
  path-filtered, a path-scoped rule avoids leaving unrelated pull requests waiting on it.
- The path filter does not include `tests/**` or the workflow file itself. A pull request that
  changes only tests does not trigger the gate.
- Local certification ran on Node 20; the CI runner uses Node 22.

## 5. Runtime lifecycle

```
UNINITIALIZED → CHECKING_CAPABILITIES → LOADING → INITIALIZING → READY | DEGRADED
                        │                                  │
                        └→ BLOCKED                         └→ FAILED
READY | DEGRADED | BLOCKED | FAILED → DISPOSING → DISPOSED
READY | DEGRADED ⇄ BLOCKED | FAILED   (structured Scandit status; RECOVERED on return)
```

- `initialize()` is single-flight: concurrent calls share one initialization and create one context.
- `dispose()` is idempotent.
- The Scandit loading-progress subscriber exists only while the context is being created. It is
  removed with the same function when initialization completes, fails, or a listener throws, so
  subscribers never stack across re-initialization (CR-6.2A-05).
- A structured Scandit status can move an operational provider to `BLOCKED` or `FAILED`, and a
  later valid status moves it back to `READY` or `DEGRADED` with a `RECOVERED` event.

**Events** (`subscribe(listener)`): `STATUS_CHANGED`, `LOAD_PROGRESS`, `PROVIDER_STATUS`,
`INITIALIZED`, `RECOVERED`, `DEGRADED`, `BLOCKED`, `ERROR`, `DISPOSED`. Each carries a copy of the
status, the provider code and category where relevant, and a timestamp.

**Runtime invariants** are asserted on every status change: `ready` requires `READY` or
`DEGRADED`; operational states require matching provider and runtime versions; a blocked runtime
cannot be ready.

## 6. PWA service worker

| Setting | Value | Effect |
|---|---|---|
| Plugin | `vite-plugin-pwa` 1.3.0, `generateSW` | Emits `dist/sw.js` and a Workbox runtime file |
| `injectRegister` | `null` | `src/main.tsx` keeps registering `/sw.js` itself |
| `registerType` | `prompt` | New worker waits; `skipWaiting()` runs only on an explicit `SKIP_WAITING` message |
| `manifest` | `false` | `public/manifest.webmanifest` remains authoritative |
| `globPatterns` | `[]` | No application assets are precached |
| `additionalManifestEntries` | `createScanditPrecacheEntries()` | 45 entries: 44 runtime files and the runtime manifest, each with its SHA-256 revision |
| `maximumFileSizeToCacheInBytes` | 10 MB | Largest runtime file is 7.17 MB |

Existing offline transaction behaviour (IndexedDB, sync, replay) is unchanged.

**HTTPS hosting (verified 2026-09-15).** On `warehouse-app.tcdsolutionsgroup.com`, TCDS serves the
runtime through a static `location ^~ /scandit/` route placed above the app proxy. It serves from
a dedicated web root with `try_files $uri =404`, correct content types, `nosniff` and
`immutable` caching. Over HTTPS, every served 8.5.2 file matches the certified build's sha256.

- Each new Scandit version must be staged into that web root **as well as** built into the app,
  in its own versioned folder. Existing version folders must never be overwritten.
- The `immutable` cache header applies to successful responses only. TCDS scoped it on 2026-09-16,
  and it was re-checked the same day: a real file returns `immutable`, and a missing file returns
  404 with no cache header.

## 7. Browser requirements

| Capability | If missing |
|---|---|
| Secure context (HTTPS) | `BLOCKED` — `SECURE_CONTEXT_REQUIRED` |
| WebAssembly | `BLOCKED` — `WEBASSEMBLY_UNAVAILABLE` |
| Web Workers | `BLOCKED` — `WEB_WORKERS_UNAVAILABLE` |
| Blob | `BLOCKED` — `BLOB_UNAVAILABLE` |
| `URL.createObjectURL` | `BLOCKED` — `OBJECT_URL_UNAVAILABLE` |
| Scandit `BrowserHelper` reports neither full nor scanner support | `BLOCKED` — `UNSUPPORTED_BROWSER` |
| WebGL | `DEGRADED` — `WEBGL_UNAVAILABLE` |
| OffscreenCanvas | `DEGRADED` — `OFFSCREEN_CANVAS_UNAVAILABLE` |
| SharedArrayBuffer | Informational only; does not cause `DEGRADED` in 6.2A |

## 8. Error handling

Errors leaving the provider are `ScannerProviderError` with `code`, generic `message`,
`retryable`, `provider`, an optional `providerStatusCode`, and an optional `cause`.

`cause` is never the raw provider exception. It is a frozen, non-writable `{ name, message }`.
The name is kept only if it is a plain class name such as `TypeError`. The message has
credentials, URLs, hosts, IP addresses, e-mail addresses, paths and token-like strings replaced
with `[redacted]`, and is capped at 160 characters (CR-6.2A-06). Error classification still uses
the original message internally, before the error is built.

- Structured Scandit `ContextStatus` codes are mapped deterministically to provider-neutral
  categories: license, network, resource, application, camera, subscription, internal.
- Message-text matching is used only for errors thrown before any `ContextStatus` exists.
- `ContextStatus` messages are trimmed, license-key values are redacted, and the text is capped at
  1,000 characters before it is placed on the status object (see F-06, accepted for 6.2A).

See `CERTIFICATION_FINDINGS.md` F-06 regarding `ContextStatus` message redaction, F-03 regarding
camera-error status codes in 6.2B, and F-07 regarding raw errors in the 6.2B capture error.

## 9. Testing

```bash
npm run scandit:test
```

12 suites, 54 tests. All Scandit modules are mocked, so tests need no license key, no camera and
no WebAssembly. They cover provider contract and replacement, registry, factory, capability
detection, runtime invariants, configuration, status mapping, status observation, error catalog,
single-flight initialization, log-level propagation, license-independent metadata, blocking,
recovery, degradation, disposal, loading-subscriber removal and no stacking, error-cause
sanitization, and the architecture boundary.

The loading mock mirrors the real Scandit 8.5.2 `LoadingStatus` (F-05 resolved). The new F-01 and
F-02 tests were proven by mutation checks: they fail when the previous code is restored. Other
Scandit mocks remain simplified stand-ins, so real SDK behaviour is confirmed by the browser
diagnostic (point 14), which runs in 6.2B.

## 10. Upgrade and rollback

Rehearsed on 2026-09-11 following `docs/UPGRADE_ROLLBACK.md`:

- Upgrade 8.5.2 → 8.5.3: new runtime in its own `public/scandit/8.5.3/` directory; full
  certification passed with no code changes; the 8.5.2 directory was not modified.
- Rollback 8.5.3 → 8.5.2: `package.json` and `package-lock.json` restored together; full
  certification passed; the service worker precache pointed back at `/scandit/8.5.2/`.

**Integrity check.** `runtime-manifest.json` contains a `generatedAt` timestamp, so the file's own
hash changes on every build. Compare runtime integrity using the per-file SHA-256 entries in the
manifest instead; the 44 file hashes for 8.5.2 were identical in every build and rehearsal.

## 11. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `Error: Runtime or manifest missing.` from `scandit:certify` | Runtime not generated yet | Run `npm run scandit:prepare` first |
| `Zero-byte runtime file: <name>` | A zero-byte file entered the runtime | Resolved for `.gitkeep` by CR-6.2A-01. Any other name is a genuine failure — investigate, do not bypass |
| `Built service worker does not reference certified Scandit runtime path` | PWA plugin missing or not configured | Check `vite.config.ts` against section 6 |
| `Scandit runtime enabled but license configuration is missing.` | `VITE_SCANDIT_LICENSE_KEY` empty | Set it in `.env` |
| `Remote Scandit runtime locations are prohibited by 6.2A governance.` | `VITE_SCANDIT_LIBRARY_BASE` set to a URL | Use a root-relative path such as `/scandit` |
| `/scandit/…` returns `200` with `text/html` on a deployed host | The request reached the app proxy, which falls back to the app page | Make sure the static `location ^~ /scandit/` route sits above the app proxy and the version folder is staged in the web root |
| `/scandit/<new version>/…` returns 404 after an upgrade | New runtime built into the app but not staged into the nginx web root | Copy `dist/scandit/<version>/` into the web root, then check that every manifest file returns 200 with the right content type, size and sha256, and no redirects (as in certification point 13) |
| `TS2322` in `scanditLoadingObserver.ts` | Scandit `percentage` is `number \| null` | Resolved by CR-6.2A-02 |

## 12. Known limitations

- **Code findings** in `CERTIFICATION_FINDINGS.md`: F-01, F-02 and F-05 resolved (CR-6.2A-05,
  CR-6.2A-06). F-06 was accepted as-is for 6.2A by TCDS. Open for 6.2B: F-03, F-04 and F-07.
- **6.2B prerequisite:** 6.2B replaces `ScanditScannerProvider.ts`. Its copy must receive the same
  subscribe-inside-`try` change as CR-6.2A-05.
- **Point 14 (browser runtime diagnostic): not applicable to 6.2A**, by TCDS decision on
  2026-09-16. This slice has no UI; the diagnostic belongs to the consuming UI slice (6.2B).
- **Point 15 (regression):** by TCDS decision on 2026-09-16, the automated suite is the regression
  surface for this no-UI slice: 54/54 tests, verify-dist, verify-pwa-cache, build, and the
  upgrade/rollback rehearsal. Formal screen regression applies at the UI slice. A light HTTP smoke
  of the built app was also run: `/`, `/login`, `/receiving`, `/sw.js`, `/manifest.webmanifest`,
  the runtime manifest and the main bundle all returned 200.
- **CI** is installed (`c337eb9`). Merge blocking needs the check to be marked required (see
  section 4).
- `runtime-manifest.json` is not byte-reproducible because of `generatedAt`; runtime content is.
- One development-only moderate advisory introduced (`vitest`); see `DEPENDENCY_DISCLOSURE.md`.

## 13. Handoff

| Item | Value |
|---|---|
| Branch | `scandit-integration` |
| 6.2A commits | `090f3a8eb192faea26c79b7688d346d60bbad03e` (code, including F-01/F-02), `c337eb9c67c1edc640fb25a7ce7ab093c506a05c` (CI workflow), then the commit that adds this pack |
| Parent | `9846d0c` |
| Pull request | https://github.com/latinabeautycollection/TCDS_Arbitrage/pull/1 |
| Baseline for 6.2B | `DOMAIN6_2B_BASELINE_SHA` = the last 6.2A commit on the branch (the commit that adds this pack) |
| Evidence (integration server) | `6.2a-certify.txt`, `6.2a-f01-f02-tests.txt`, `6.2a-https-check.txt`, `6.2a-ci-readiness.txt`, upgrade/rollback rehearsal folder |

Companion documents: `CERTIFICATION_CHECKLIST.md`, `CERTIFICATION_FINDINGS.md`,
`CHANGE_RECORDS.md`, `DEPENDENCY_DISCLOSURE.md`, `TRACEABILITY_MATRIX.md`.
