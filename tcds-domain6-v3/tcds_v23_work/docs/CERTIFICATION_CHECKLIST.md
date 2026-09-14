# Domain 6.2A Green Tier 1 Certification Checklist

## Ownership and collision protection

- [ ] Existing Domain 6 feature folders are unchanged.
- [ ] No warehouse business API contract is replaced.
- [ ] No warehouse schema/database migration exists for 6.2A.
- [ ] No Camera is instantiated.
- [ ] No camera permission is requested.
- [ ] No BarcodeCapture mode is instantiated.
- [ ] No barcode is decoded.
- [ ] No warehouse business mutation is performed.
- [ ] Scandit imports are restricted to `src/lib/scanning/providers/scandit/**`.
- [ ] Script boundary check passes.
- [ ] ESLint `no-restricted-imports` boundary check passes.

## Version and runtime integrity

- [ ] Exact Scandit SDK versions are pinned with no `^`, `~`, or `*`.
- [ ] Core and Barcode versions are identical.
- [ ] `package-lock.json` is frozen and identical to installed versions.
- [ ] Approved version record exists.
- [ ] Complete `sdc-lib` is copied recursively from all installed Scandit packages.
- [ ] Runtime is stored under `/scandit/<EXACT_VERSION>/sdc-lib/`.
- [ ] `runtime-manifest.json` contains SHA-256 for every runtime file.
- [ ] All source runtime hashes verify.
- [ ] At least one WASM and one JS runtime artifact exist.
- [ ] Built `dist/scandit/<VERSION>` exactly matches source manifest hashes.
- [ ] Nginx serves `.wasm` as `application/wasm`.
- [ ] Versioned runtime paths use immutable caching.
- [ ] No mutable `/latest` or `/current` runtime path is used.

## Scandit runtime and observability

- [ ] `DataCaptureContext` initializes without camera or capture-mode creation.
- [ ] `DataCaptureContextListener.didChangeStatus` is registered.
- [ ] Structured `ContextStatus.code/isValid/message` is observed.
- [ ] Scandit context status codes are normalized through deterministic mappings.
- [ ] Message-string matching is fallback-only before structured status exists.
- [ ] License/context failures produce provider-neutral error codes.
- [ ] Provider status code/category are available in runtime status/events.
- [ ] Provider recovery from invalid status back to Success is observable.
- [ ] Loading progress is observable.
- [ ] Configured Scandit `logLevel` is passed into context creation.
- [ ] Missing required browser primitives result in BLOCKED.
- [ ] Optional acceleration deficiencies result in DEGRADED, not silent READY.
- [ ] SharedArrayBuffer absence remains informational for 6.2A single-barcode scope.

## Provider abstraction and lifecycle

- [ ] `WarehouseScannerProvider` remains provider-neutral.
- [ ] Provider registry supports replacement/injection.
- [ ] Test provider satisfies the same contract.
- [ ] Domain 6 does not need a Scandit-specific type to compile.
- [ ] `initialize()` is single-flight/idempotent.
- [ ] Multiple concurrent initialize calls create one context.
- [ ] `dispose()` is safe/idempotent.
- [ ] Context listener is removed during disposal.
- [ ] Loading subscription is removed during completion/disposal.
- [ ] `getMetadata()` works before license configuration.
- [ ] Raw Scandit SDK objects do not cross the provider boundary.
- [ ] Raw Scandit exceptions do not cross the provider boundary.

## PWA deployment enforcement

- [ ] Scandit runtime is self-hosted.
- [ ] Scandit runtime manifest is included in PWA caching.
- [ ] Representative JS and WASM assets are included in PWA caching.
- [ ] Workbox maximum file size supports the runtime assets.
- [ ] `scandit:verify-pwa-cache` passes against the built service worker.
- [ ] Existing Domain 6 offline transaction ownership is unchanged.

## Automated testing

- [ ] Scanner provider contract tests pass.
- [ ] Capability detector tests pass.
- [ ] Runtime invariant tests pass.
- [ ] Scandit config tests pass.
- [ ] ContextStatus mapper tests pass.
- [ ] Context observer tests pass.
- [ ] Error catalog tests pass.
- [ ] Provider registry/replacement tests pass.
- [ ] Provider factory tests pass.
- [ ] Scandit provider single-flight tests pass.
- [ ] Scandit provider structured-status tests pass.
- [ ] Scandit provider recovery tests pass.
- [ ] Scandit provider degradation tests pass.
- [ ] Scandit provider disposal tests pass.
- [ ] Architecture-boundary test passes.

## CI/CD and certification

- [ ] Production `prebuild` executes Scandit prepare/preflight or equivalent combined gate.
- [ ] `npm run scandit:certify` passes.
- [ ] TypeScript production build passes.
- [ ] Existing Domain 6 `check`/`verify`/regression suite remains green.
- [ ] Upgrade rehearsal passes with side-by-side versioned runtime assets.
- [ ] Rollback rehearsal restores prior app+SDK+runtime version atomically.
- [ ] Production promotion is impossible if any Scandit certification gate fails.

**Certification rule:** any unchecked ownership, structured-status, runtime-integrity, provider-replacement, PWA-cache, or CI/CD item means 6.2A is not Green Tier 1.
