# TCDS Domain 6 Warehouse PWA Shell Acceptance Criteria
## Green Tier 1 v2.1

The shell is accepted only if all criteria below are satisfied.

## Build Criteria

- `npm install` completes successfully.
- `npm run build` completes successfully.
- Dependency versions are pinned, not floating on `latest`.
- `package-lock.json` is included.
- TypeScript strict mode remains enabled.

## Route Criteria

- All 12 approved routes exist.
- No unauthorized production routes exist.
- Unknown routes redirect safely.
- Shell-phase protected route wrapper exists and is clearly marked for replacement during authentication implementation.

## Approved 12 Routes

1. `/` Login
2. `/dashboard` Dashboard
3. `/receive` Receive Item
4. `/photos` Capture Photos
5. `/verify` Verify Item
6. `/storage` Assign Storage
7. `/inventory` Inventory List
8. `/inventory/detail` Inventory Detail
9. `/pick` Pick in Progress
10. `/pack-ship` Pack & Ship
11. `/returns` Returns
12. `/settings` Settings / Exception Queue

## Forbidden Screens

The shell must not include standalone pages for:

- Receive Complete
- Shipment Complete
- Inventory Overview
- Inventory Move
- Create Pick / Listing

## UI Criteria

- App is mobile-first and usable on iPhone viewport.
- Login removes Forgot Password.
- Login removes Remember Me.
- Login shows Need Help / Contact Warehouse Administrator.
- Login shows Online, Server Connected, Printer Connected, Scanner Ready.
- Dashboard acts as the operational command center.
- Receive screen is scanner-first.
- Receive screen does not show Recent Scans.
- Bottom navigation includes only approved operational routes.
- Status strip is visible throughout the application.
- TCDS black/gold/white design language is used consistently.

## Shell Boundary Criteria

- No real business logic is implemented.
- No real PostgreSQL writes are implemented.
- Scandit, API, and offline queues are placeholders only.
- Domain 4 listing work is represented only as a handoff placeholder.
- Domain 3 shipping work is represented only as a future integration placeholder.
