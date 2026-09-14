# 6.2A Hardening Remediation Matrix

This rewrite preserves the previously approved 9–10/10 architecture and remediates only the weak areas identified in the certification review.

| Area | Prior | Hardened control | Target |
|---|---:|---|---:|
| Scandit status observability | 6/10 | `DataCaptureContextListener`, structured `ContextStatus` mapping, provider status/recovery events | 10/10 |
| Error governance | 6/10 | code-first deterministic catalog; message matching fallback-only; credential redaction | 10/10 |
| PWA deployment enforcement | 7/10 | manifest-driven Workbox precache helper, `verify-dist`, `verify-pwa-cache`, immutable versioned runtime | 10/10 |
| Automated tests | 5/10 | expanded provider, config, status, registry, lifecycle, error, degradation, boundary tests; Vitest pinned | 10/10 |
| CI/CD certification | 6/10 | `prebuild` prepare/preflight, ESLint gate, `scandit:certify`, post-build dist/cache verification | 10/10 |

Additional findings from the review were also closed without changing business ownership:

- `VITE_SCANDIT_LOG_LEVEL` is now actually mapped to `Logger.Level`.
- `DEGRADED` is now reachable for optional acceleration deficiencies.
- `getMetadata()` is license-independent.
- provider replacement is implemented with a provider registry.
- import isolation is enforced through both source verification and ESLint.
- exact version approval is recorded.

No database schema, Tailwind UI, camera, capture mode, scan workflow, or Domain 6 business owner was added or changed.
