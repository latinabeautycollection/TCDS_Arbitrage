# TCDS Domain 6 Warehouse PWA Shell
## Final Green Tier 1 Enterprise Shell Baseline v2.2

This package is the final shell-only implementation baseline for the TCDS Domain 6 Warehouse Execution PWA.

The purpose of this package is to give the implementation developer a polished, production-ready visual and routing shell before business logic is added. It preserves the approved 12-screen warehouse architecture, applies the TCDS black/gold/white enterprise design language, and includes the guardrails required to prevent screen creep or domain drift.

## What This Package Is

This is the application shell:

- React 18
- TypeScript
- Vite
- Tailwind CSS
- TCDS Green Tier 1 design system
- 12 approved production routes
- Mobile-first iPhone layout
- Bottom navigation
- Persistent system status strip
- PWA manifest and service worker foundation
- Scandit placeholder adapter
- API client placeholder
- Offline queue placeholder
- Empty/loading/error/offline state patterns
- Toast/success pattern previews
- Bottom-sheet interaction pattern previews
- Docker, Nginx, and docker-compose deployment foundation
- Developer guardrail documentation

## What This Package Is Not

This package intentionally does not implement the real business logic yet.

Do not add yet:

- Real inventory writes
- Real PostgreSQL implementation
- Real Scandit SDK key wiring
- Real photo upload pipeline
- Real authentication / RBAC
- Real shipping label purchase
- Real offline sync conflict resolution
- Real printer bridge
- Real Domain 3 / Domain 4 integration

Those belong to the next build phase.

## Approved 12 Screens

1. Login
2. Dashboard
3. Receive Item
4. Capture Photos
5. Verify Item
6. Assign Storage
7. Inventory List
8. Inventory Detail
9. Pick in Progress
10. Pack & Ship
11. Returns
12. Settings & Exception Queue

## Forbidden Standalone Screens

Do not reintroduce standalone pages for:

- Receive Complete
- Shipment Complete
- Inventory Overview
- Inventory Move
- Create Pick / Listing

Use toasts, modals, bottom sheets, expandable sections, dashboard widgets, or Domain 4 queue handoff actions instead.

## Developer Run Commands

```bash
npm install
npm run dev
```

## Build Command

```bash
npm run build
```

## Docker Command

```bash
docker compose up --build
```

## Final Handoff Acceptance Criteria

The shell is acceptable only if:

- `npm install` succeeds.
- `npm run build` succeeds.
- All 12 approved routes render.
- No forbidden standalone screens exist.
- Login has no Forgot Password and no Remember Me.
- Login includes Need Help / Contact Warehouse Administrator.
- Login includes online/server/printer/scanner readiness.
- Receive Item is scan-first and has no Recent Scans panel.
- Dashboard functions as the command center.
- Inventory Detail contains warehouse-only information.
- Move Item is represented as a bottom-sheet pattern, not a route.
- Pack & Ship shows the online-required error-state pattern.
- Empty, loading, error, offline, and success-state patterns exist.
- PWA manifest and service worker files exist.
- Docker/Nginx deployment files exist.

## Constitutional Guardrails

The developer must not:

- Add screens without approval.
- Move business logic into React components.
- Replace PostgreSQL as the source of truth.
- Replace Scandit with browser barcode libraries.
- Add marketplace pricing/listing logic to Domain 6.
- Reintroduce generic blue SaaS styling.
- Remove audit/event placeholders from future business logic.
- Bypass the approved warehouse workflow.

## Verified in This Build Environment

- `npm install`
- `npm run build`

Docker must be verified on Linode or another Docker-enabled workstation.
