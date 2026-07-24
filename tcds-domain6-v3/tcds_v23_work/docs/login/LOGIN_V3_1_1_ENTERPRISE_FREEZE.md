# TCDS Domain 6 Login v3.1.1 — Enterprise UI Freeze

## Frozen visual foundation
The official TCDS logo, approved typography, fonts, spacing, white/black/gold palette, card geometry, mobile width, iOS safe-area behavior, and overall Version 3 layout are frozen.

## Phase 1 authentication scope
- Username or employee number + password
- Passkey authentication with required user verification (Face ID/Touch ID/device verification on supported Apple devices)
- Secure server-side opaque sessions through HttpOnly cookies

Excluded: Microsoft SSO, Okta, Ping, badge/RFID login, social login, magic links, guest access, and offline authentication.

## Enterprise behaviors included
- Generic credential errors to reduce account enumeration
- Registered-device and station readiness
- API/database/network readiness
- Offline notice
- Retry bootstrap
- Request timeout and user cancellation
- Session restoration and protected routes
- Passkey button shown only after the server reports availability
- Apple Keychain-compatible autocomplete
- 16px inputs to prevent iOS zoom
- Request IDs, correlation IDs, app version, and device installation ID headers
- No access or refresh token storage in browser storage

## Required backend endpoints
- GET /api/v1/auth/bootstrap
- GET /api/v1/auth/session
- POST /api/v1/auth/login
- POST /api/v1/auth/logout
- POST /api/v1/auth/passkeys/availability
- POST /api/v1/auth/passkeys/authentication/options
- POST /api/v1/auth/passkeys/authentication/verify

The passkey availability endpoint must return a generic response and must be protected against user enumeration through response shape, timing, rate limiting, and audit controls.
