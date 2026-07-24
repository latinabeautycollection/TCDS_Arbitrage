# TCDS Domain 6 — Phase 1 Login-Only Patch

This package preserves the controlled Version 3 PWA shell and changes only the login/authentication boundary.

## Phase 1 enabled
- Username or employee number + password
- iPhone Face ID / Touch ID through WebAuthn passkeys after enrollment
- Server-side session validation and protected routes
- Registered-device, facility, station, role, readiness and audit contract
- iOS safe areas, 16px inputs, Apple Keychain autocomplete, standalone PWA start at login

## Explicitly disabled
Microsoft SSO, Okta, Ping, badge login, RFID login, social login, magic links, guest access and offline authentication.

## Modified existing files
- `src/screens/Login.tsx`
- `src/routes/AppRouter.tsx`
- `src/main.tsx`
- `public/manifest.webmanifest`
- `.env.example`

## Added login-only files
- `src/features/auth/**`
- `database/migrations/601_domain6_identity_phase1.sql`
- `docs/login/**`

No dashboard, receiving, photography, verification, storage, inventory, pick, pack/ship, returns, settings, design-system, Docker or Nginx feature code was redesigned.
