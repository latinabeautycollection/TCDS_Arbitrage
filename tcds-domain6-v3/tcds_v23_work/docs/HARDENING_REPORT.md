# Domain 6.2A Hardening Report

## Objective

Raise the reviewed 8.5/10 6.2A package to a Green Tier 1 implementation while leaving areas already rated 9–10/10 structurally intact.

## Preserved

- ownership isolation;
- Domain 6 collision prevention;
- provider-neutral public contract;
- exact-version/self-host architecture;
- single-flight runtime lifecycle;
- zero database ownership;
- zero Tailwind/UI ownership;
- no camera or barcode capture in 6.2A.

## Hardened

### Scandit status observability

Added:

- `scanditContextObserver.ts`
- `scanditContextStatusMapper.ts`
- provider status/recovery event handling
- provider status code/category fields

The runtime now listens to `DataCaptureContextListener.didChangeStatus()` and evaluates `ContextStatus.code`, `isValid`, and sanitized `message`.

### Error governance

Structured status codes drive runtime classification. Message matching is used only for failures occurring before ContextStatus exists.

### PWA deployment enforcement

Added:

- `config/vite/scanditPwaPrecache.ts`
- `verify-scandit-dist.mjs`
- `verify-scandit-pwa-cache.mjs`
- Workbox/PWA merge guide

### Automated tests

Added/expanded tests for:

- provider contract;
- provider registry/replacement;
- provider factory;
- capability report;
- runtime invariants;
- static/runtime config;
- ContextStatus mapper;
- ContextStatus listener;
- error catalog;
- Scandit provider single-flight initialization;
- Scandit log-level propagation;
- license-independent metadata;
- blocked status transitions;
- recovery;
- degraded operation;
- disposal;
- architecture boundary.

### CI/CD enforcement

Added:

- pinned test/lint/PWA tooling;
- ESLint vendor-import boundary;
- `prebuild` Scandit prepare/preflight;
- `scandit:certify`;
- built-runtime hash verification;
- generated service-worker cache verification.

### Additional review closures

- `VITE_SCANDIT_LOG_LEVEL` now affects Scandit.
- `DEGRADED` is operational rather than dead state.
- provider registry makes replacement real.
- metadata can be read without a configured license.
- exact SDK approval is documented.

## Static package checks performed during hardening

- all `.mjs` governance scripts passed `node --check`;
- Scandit boundary verification passed;
- no `.sql` file exists;
- no Camera/BarcodeCapture construction exists in `src`;
- strict TypeScript structural compile of `src` passed using API declarations matching the official 8.5.2 interfaces used by this package.

## Remaining certification requirement

Final production certification still requires merging the overlay into the actual production PWA, running a real `npm ci` against the repository lockfile, executing the full Scandit + Domain 6 test suite, building the PWA, and validating the generated service worker and Nginx-hosted assets.
