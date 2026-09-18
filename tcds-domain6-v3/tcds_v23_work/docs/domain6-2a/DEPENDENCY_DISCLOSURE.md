# Domain 6.2A — Dependency Disclosure

Commits: `090f3a8eb192faea26c79b7688d346d60bbad03e` (6.2A code; the F-01/F-02 fixes added no
dependency), `c337eb9c67c1edc640fb25a7ce7ab093c506a05c` (certification workflow) and
`981a7ada55a3f8876dc1fe93e1102322770dc8cb` (Scandit 8.5.2 → 8.5.3; no package added)

This lists every package added to `tcds-domain6-v3/tcds_v23_work/package.json` by the 6.2A merge.
No other package was added.

---

## Added packages

| Package | Version | Type | License | Where it came from | Why it is needed |
|---|---|---|---|---|---|
| `@scandit/web-datacapture-core` | 8.5.3 | dependency | Proprietary — Scandit AG. "The use of this software is governed by the Scandit Terms and Conditions" (https://ssl.scandit.com/terms/terms.pdf) | 6.2A package fragment | Scandit runtime, `DataCaptureContext`, status and loading APIs |
| `@scandit/web-datacapture-barcode` | 8.5.3 | dependency | Proprietary — Scandit AG, same terms | 6.2A package fragment | Barcode module loader registered with the context |
| `vite-plugin-pwa` | 1.3.0 | devDependency | MIT | 6.2A package fragment | Generates the service worker that precaches the Scandit runtime |
| `vitest` | 3.2.7 | devDependency | MIT | 6.2A package fragment | Runs the 6.2A test suite |
| `eslint` | 10.8.1 | devDependency | MIT | 6.2A package fragment | Enforces the Scandit import boundary |
| `@typescript-eslint/parser` | 8.67.0 | devDependency | MIT | 6.2A package fragment | TypeScript parsing for the boundary lint |
| `@types/node` | 20.19.43 | devDependency | MIT | **Added during integration — not in the 6.2A fragment.** Approved by TCDS in writing on 2026-09-18 | See below |

All versions are pinned exactly. No semver ranges were introduced. The Scandit packages moved from
8.5.2 to 8.5.3 on 2026-09-18 by TCDS decision (CR-6.2A-08); their license terms are unchanged.

No package with a copyleft or reciprocal license (GPL, AGPL, LGPL, SSPL, OSL, RPL) was added.

## CI actions used by the certification workflow

The workflow `.github/workflows/domain6-2a-scandit-certification.yml` was supplied with the 6.2A
package and installed unchanged. It uses these third-party GitHub Actions:

| Action | Reference | Owner | License | Purpose |
|---|---|---|---|---|
| `actions/checkout` | `v4` (major-version tag) | GitHub | MIT | Check out the repository |
| `actions/setup-node` | `v4` (major-version tag) | GitHub | MIT | Install Node.js 22 and cache npm |

Both are referenced by a moving major-version tag, not a fixed commit SHA. Pinning them to commit
SHAs would make the pipeline fully reproducible. That is a TCDS policy choice, so the supplied
file was not changed.

The workflow reads no secrets. `scandit:certify` and `npm run verify` pass with
`VITE_SCANDIT_LICENSE_KEY` empty, and the resulting build contains no license key.

---

## `@types/node` — added outside the package fragment

**Why it was added.** Two files committed as part of 6.2A import Node.js built-in modules:

- `config/vite/scanditPwaPrecache.ts` — `node:fs`, `node:path`; loaded by `vite.config.ts`
- `tests/scanning/architectureBoundary.test.ts` — `node:fs`, `node:path`

Declaring `@types/node` makes the Node type definitions these files rely on an explicit, pinned
dependency of the application.

**What testing showed.** We removed the explicit entry and ran the checks again. `tsc --noEmit`, a
direct type check of `vite.config.ts` and the helper, and `scandit:certify` all still passed.
However, the package remained resolvable because other dependencies already install it:

```
├── @types/node@20.19.43
├─┬ vite@5.4.11
│ └── @types/node@20.19.43 deduped
└─┬ vitest@3.2.7
  └── @types/node@20.19.43 deduped
```

So that test does **not** prove the explicit entry is unnecessary — it shows the types are
currently also present indirectly. Relying on an indirect copy would make the build depend on
another package's internal choices. The explicit, pinned entry was kept.

**Decision:** TCDS approved the explicit entry in writing on 2026-09-18 (development-only, and
it matches their Node 20 runtime).

| Disclosure item | `@types/node` 20.19.43 |
|---|---|
| Material | Node.js type definitions (`.d.ts` files only) |
| Owner / licensor | Published by the DefinitelyTyped project (`https://github.com/DefinitelyTyped/DefinitelyTyped`); license notice: "Copyright (c) Microsoft Corporation" |
| License | MIT |
| Restrictions and attribution | MIT: keep the license notice, which ships inside the package. No copyleft, source-disclosure or distribution obligation |
| Fees or ongoing costs | None |
| Impact | Development and type checking only. Type definitions are removed at compile time, so nothing from this package is in the built application. No effect on ownership, licensing, deployment or operational rights |

---

## Runtime assets served from the application

The Scandit runtime (`sdc-lib`: WASM, JavaScript, model files) is copied from the installed npm
packages into `public/scandit/8.5.3/` at build time and served from the application's own origin,
as Scandit's self-hosting installation model describes. It is not committed to git
(change record CR-6.2A-04). Use remains subject to the Scandit terms above and to the TCDS
Scandit license.

The license key is supplied through `VITE_SCANDIT_LICENSE_KEY`. It is visible in the browser by
the nature of the Web SDK; TCDS has confirmed it is a domain-locked Scandit web key. It is not committed, logged, stored in
PostgreSQL, or placed in telemetry.

---

## Known vulnerabilities (`npm audit`)

| Scope | Before 6.2A (`9846d0c`) | After 6.2A (audited 2026-09-14; re-audited 2026-09-18 on Scandit 8.5.3: same result) |
|---|---|---|
| Production | 9 (7 high, 2 moderate) | 7 (6 high, 1 moderate) |
| All, including dev | 9 (7 high, 2 moderate) | 9 (6 high, 3 moderate) |

| Package | Severity | Scope | Introduced by 6.2A? |
|---|---|---|---|
| `vitest`, `@vitest/mocker` | moderate | dev only | **Yes** — pinned by the 6.2A fragment |
| `react-router-dom`, `react-router`, `@remix-run/router` | high | production | No — pre-existing |
| `vite` | high | production | No — pre-existing |
| `postcss` | high | production | No — pre-existing |
| `nanoid` | high | production | No — pre-existing |
| `esbuild` | moderate | production | No — pre-existing |

The `vitest` advisory has a fix available upstream. No vulnerability was introduced into the
production dependency set by 6.2A. Both Scandit packages
report no advisories. `browserslist` (high) and `baseline-browser-mapping` (moderate) are no
longer reported after the install.

Upgrading pre-existing application dependencies is outside 6.2A scope and was not done.
