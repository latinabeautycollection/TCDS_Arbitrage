# TCDS Domain 6 Warehouse PWA Shell
## Green Tier 1 v2.1 Preflight Review Findings

## Review Result

The v2.1 shell is approved as a shell-only foundation after correcting one deployment-blocking TypeScript configuration issue found during holistic review.

## Issues Found and Corrected

### 1. TypeScript build failure

Finding:
- The prior shell used `moduleResolution: Node` while dependency versions were floating on `latest`.
- With newer TypeScript versions, this caused `npm run build` to fail.

Correction:
- Pinned package versions.
- Changed `moduleResolution` to `Bundler`.
- Regenerated `package-lock.json`.
- Verified `npm run build` completes successfully.

### 2. Floating dependency risk

Finding:
- The previous package used `latest` dependency versions, which creates risk for the developer because installs can behave differently over time.

Correction:
- Replaced all `latest` versions with explicit versions.
- Added `package-lock.json` to stabilize installs.

### 3. PWA icon gap

Finding:
- The prior manifest had an empty icons array.

Correction:
- Added `/icon.svg`.
- Added `/tcds-logo.svg`.
- Updated manifest icon definition.

### 4. Service worker registration gap

Finding:
- The prior shell shipped a service worker file but did not register it.

Correction:
- Added production-only service worker registration in `src/main.tsx`.

### 5. Route protection ambiguity

Finding:
- The prior shell marked routes as protected in configuration but had no placeholder guard.

Correction:
- Added a shell-phase `ProtectedShellRoute` wrapper with explicit comments stating that the business-logic phase must replace it with real authentication, session, role, and device checks.

## Verified Checks

- `npm install` completed successfully.
- `npm run build` completed successfully.
- All 12 approved routes exist.
- Login removes Forgot Password.
- Login removes Remember Me.
- Login includes Need Help / Contact Warehouse Administrator.
- Login includes Online / Server / Printer / Scanner readiness.
- Receive screen is scanner-first.
- Recent Scans were removed.
- Dashboard acts as command center.
- No standalone Receive Complete screen exists.
- No standalone Shipment Complete screen exists.
- No standalone Inventory Overview screen exists.
- No standalone Inventory Move screen exists.
- No standalone Create Pick / Listing screen exists.
- Inventory Detail uses Queue for Listing as a Domain 4 handoff placeholder only.

## Check Not Performed in This Environment

Docker image build was not verified because Docker is not available in the current execution environment. The Dockerfile remains standard multi-stage Node build plus Nginx static hosting and should be verified by the developer on Linode or a Docker-enabled workstation.

## Current Approval

Approved for developer handoff as a shell-only package.

Not approved yet for business logic, PostgreSQL writes, Scandit production wiring, authentication, photo upload, printer bridge, or shipping label purchase.
