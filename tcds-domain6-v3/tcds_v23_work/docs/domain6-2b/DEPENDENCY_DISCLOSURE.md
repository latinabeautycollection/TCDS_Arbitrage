# Domain 6.2B — Dependency Disclosure

No runtime dependency is added by this slice. The Scandit packages stay at the approved version 8.5.3.

## Added development packages

All four come from the delivered package fragment and are needed to run the component and lifecycle tests.

| Package | Version | Licence | Purpose | Ships to production |
|---|---|---|---|---|
| `@testing-library/react` | 16.3.0 | MIT | render React components in the test environment | no |
| `@testing-library/user-event` | 14.6.1 | MIT | user interaction helpers for component tests | no |
| `jsdom` | 26.1.0 | MIT | DOM environment for the test runner | no |
| `@testing-library/dom` | 10.4.2 | MIT | peer dependency of the React testing library, installed automatically | no |

- Installation added 48 packages in total, including transitive dependencies, and changed the lockfile only.
- All four are development dependencies. The production build does not include them.
- Sources: the public npm registry, integrity pinned by the lockfile.

## Vulnerability status

`npm audit` reports 9 advisories in the repository: 6 high and 3 moderate.

- None of them comes from the four packages above.
- They belong to dependencies that already existed in the application: the router, the build tool, the test
  runner and the CSS toolchain.
- 7 of the 9 are also reported for the production dependency tree and pre-date this slice.

We did not change any of those versions: upgrading them is an application-wide decision and outside the
scope of this slice.

## Runtime assets

Unchanged from the runtime slice: the Scandit 8.5.3 runtime files are generated from the approved package
and served by the application. Version parity between the package, the lockfile, the generated manifest, the
built output and the offline cache is verified on every certification run.
