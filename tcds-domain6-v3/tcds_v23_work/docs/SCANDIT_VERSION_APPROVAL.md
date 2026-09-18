# Scandit Version Approval Record

**Slice:** Domain 6.2A  
**Approval date:** 2026-08-13 (8.5.2); 2026-09-18 (8.5.3)  
**Approved Web SDK:** 8.5.3

## Packages

- `@scandit/web-datacapture-core`: `8.5.3`
- `@scandit/web-datacapture-barcode`: `8.5.3`

## Approval basis

The 6.2A hardening review was validated against Scandit's current official Web Data Capture SDK 8.5.2 documentation, including:

- DataCaptureContext
- DataCaptureContextListener
- ContextStatus
- ModuleLoaderOptions
- BrowserCompatibility
- installation/self-hosting guidance

## Required invariant

`core = barcode = package-lock = generated scanditVersion.ts = runtime-manifest = /public/scandit/<version>/ = built /dist/scandit/<version>/`

No semver ranges are permitted.

## Release governance

Every future Scandit update requires:

1. explicit target-version approval;
2. release-note/API review;
3. both packages upgraded together;
4. clean `npm ci`;
5. runtime assets regenerated from the installed packages;
6. SHA-256 manifest regenerated;
7. full 6.2A provider contract test suite;
8. boundary/lint enforcement;
9. PWA build and runtime-cache certification;
10. existing Domain 6 regression tests;
11. rollback proof using the prior versioned application/runtime pair.

The prior certified runtime directory must remain available until the rollback window closes.

## Update record: 8.5.2 to 8.5.3 (2026-09-18)

TCDS approved 8.5.3 for the whole of Milestone 1 (6.2A + 6.2B + 6.2C), because the 6.2B package's certification requires exactly 8.5.3.

| Step | Result |
|---|---|
| 1. Explicit target-version approval | Approved by TCDS on 2026-09-18 |
| 2. Release-note/API review | All 571 TypeScript declaration files in both packages are identical between 8.5.2 and 8.5.3. The runtime files that changed are the barcode engine (`sdc-lib` JS/WASM and its worker), the SDK version string, and three internal UI button modules that this code does not use. Scandit's 8.5.3 release notes list one change: enhanced low-resolution QR scanning is disabled for MatrixScan modes, which Domain 6.2 does not use |
| 3. Both packages together | `package.json` and `package-lock.json` pin both at exactly `8.5.3`; no other lockfile entry changed |
| 4. Clean `npm ci` | Passed |
| 5. Runtime assets regenerated | `scandit:prepare`: 44 files (4 WASM, 5 JS) under `/scandit/8.5.3/` |
| 6. SHA-256 manifest regenerated | Content fingerprint `0d62034520f2f6fe989e0cee61c1900269ab07fd90058ea96906b5142e36d675` (sha256 of the sorted `path:sha256` entries joined with `\|`) |
| 7. Provider contract tests | 54/54 passed |
| 8. Boundary/lint | Passed |
| 9. PWA build and runtime cache | `verify-dist` and `verify-pwa-cache` passed; 45 precache entries under `/scandit/8.5.3/`, none under `/scandit/8.5.2/` |
| 10. Existing Domain 6 regression | `npm run check` and `npm run verify` passed |
| 11. Rollback proof | Rolled back to the committed 8.5.2 `package.json`/`package-lock.json` pair: clean install, prepare and full certification passed (fingerprint `1da2966c16fc22399863783dd1ac0366f34ea35e5f34073ecb353946980be3fe`, 45 precache entries under `/scandit/8.5.2/`). Then forward to 8.5.3 again: passed |

The hosted 8.5.2 runtime stays available alongside 8.5.3 until the rollback window closes.
