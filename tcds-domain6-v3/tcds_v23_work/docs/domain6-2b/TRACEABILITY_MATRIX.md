# Domain 6.2B — Traceability Matrix

## A. Requested corrections

| Requested | Change record | Evidence |
|---|---|---|
| TypeScript fixes, including the selection-mode import | CR-6.2B-02 | strict TypeScript PASS |
| Keep the capture-policy identifier exception narrow | CR-6.2B-03 | boundary check PASS; probe shows real advanced modes still rejected |
| Re-apply the approved runtime provider fix where the package replaces that file | CR-6.2B-02 | runtime suite 54/54; a mutation check fails without it |
| Scanner must not capture because the camera became available | CR-6.2B-04 | `captureLifecycle` |
| A barcode visible during startup must not decode early or break Start | CR-6.2B-04 | `captureLifecycle` |
| Disable the SDK feedback when the capture policy disables feedback | CR-6.2B-04 | `captureLifecycle` |
| Full teardown before another Start after a timeout or failure | CR-6.2B-05 | `captureLifecycle` |
| Cancel a pending startup when the page is left | CR-6.2B-06 | `scannerHookLifecycle` |
| Background and foreground must not turn a failed scanner into ready | CR-6.2B-07 | `captureLifecycle` |
| A camera or runtime error must never map to ready | CR-6.2B-08 | `runtimeErrorMapping` |
| Raw exceptions must not cross the provider boundary | CR-6.2B-09 | `captureLifecycle` |
| Diagnostic page stays behind the existing sign-in, no new role | — | route definition; no navigation entry |
| Read-only diagnostic status section with the seven requested groups | CR-6.2B-10 | `diagnosticStatusSurface` |
| Fix the repository path handling of the protected-feature check | CR-6.2B-11 | `protectedFeatureBoundary`, plus the before-and-after probe |
| One positive and one negative protected-feature test | CR-6.2B-11 | `protectedFeatureBoundary` |
| Install and enable the capture certification workflow | CR-6.2B-12 | workflow file; same chain as the local run |
| Tests for the issues found | CR-6.2B-13 | 16 tests; 12 fail against the code as delivered |

## B. Requested tests

| Case | Test |
|---|---|
| barcode visible during startup | `captureLifecycle` |
| feedback disabled by policy | `captureLifecycle` |
| retry after timeout | `captureLifecycle` |
| retry after error | `captureLifecycle` |
| navigation or unmount while starting | `scannerHookLifecycle` (two cases) |
| background and resume after a failed or blocked state | `captureLifecycle` |
| camera or runtime error cannot map to ready | `runtimeErrorMapping` |
| raw provider error cannot escape the boundary | `captureLifecycle` |
| diagnostic status shows safe failure information | `diagnosticStatusSurface` |
| repeated Start leaves no stale camera session | `captureLifecycle` |
| repeated failure and retry leak no listeners or resources | `captureLifecycle` |
| stale decode or session rejection | `captureLifecycle` |

## C. Requested evidence

| Evidence | Result |
|---|---|
| runtime slice still 54/54 | PASS |
| updated capture suite fully passing | PASS — 52/52 |
| strict TypeScript | PASS, with library checking enabled |
| production build | PASS, offline cache regenerated |
| runtime, cache and version parity | PASS — 8.5.3, 44 runtime files, built output and cache match the manifest |
| provider and boundary checks | PASS |
| protected-feature check | PASS |
| continuous integration | PASS — both workflows green on the pull request |
| zero unauthorized warehouse business mutations | no database client, query or migration in the slice; no SQL in the diff |
| zero unauthorized warehouse feature changes | no changed file under a business feature; every changed file belongs to the scanner subsystem, its tests, the certification scripts, the workflow or these documents |

## D. Findings

| Finding | Status |
|---|---|
| B-01 … B-09 | Closed, each with a change record and at least one test |
| B-10, B-11, B-12 | Closed in the follow-up: CR-6.2B-14, CR-6.2B-15, CR-6.2B-16 |
| B-13, B-14 | Deferred to 6.2C by agreement |

## D2. Follow-up requests

| Requested | Change record | Evidence |
|---|---|---|
| A capture timeout must fully release the camera and capture context | CR-6.2B-14 | `captureLifecycle` |
| A hidden, auth-gated entry point for the installed PWA | CR-6.2B-15, CR-6.2B-17 | `diagnosticsEntry`, five cases |
| Lazy-load the diagnostic route so the SDK leaves the main chunk | CR-6.2B-16 | build output: 865 kB to 539 kB, 241 kB to 146 kB gzipped |

## E. Device evidence

The real-device matrix is complete: iPhone 17 on iOS 27.0, in Safari, the installed Home Screen web app and
Chrome for iOS. **39 checks, 0 failures.** Full record and the seven observations: `DEVICE_TEST_EVIDENCE.md`.

## F. Open items

1. A decision on the device observations, in particular D-1 (platform permission behaviour in the installed
   web app) and D-3 (safe areas in the application shell).
2. Returning the shared deployment to its secure posture once the evidence is accepted.
3. Mid-session camera loss and the detailed capture-policy definitions, both deferred to 6.2C.
