# Scandit Version Approval Record

**Slice:** Domain 6.2A  
**Approval date:** 2026-08-13  
**Approved Web SDK:** 8.5.2

## Packages

- `@scandit/web-datacapture-core`: `8.5.2`
- `@scandit/web-datacapture-barcode`: `8.5.2`

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
