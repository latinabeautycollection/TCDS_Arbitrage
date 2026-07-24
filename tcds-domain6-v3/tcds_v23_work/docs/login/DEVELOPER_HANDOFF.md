# Developer Handoff — Do Not Rewrite the PWA Shell

Apply this package as a login-only change. The protected-route preview bypass has been removed. Until the backend endpoints exist, secured routes will correctly remain unavailable.

Production values:
- `VITE_API_BASE_URL=` (blank for same-origin)
- `WEBAUTHN_RP_ID=warehouse-app.tcdsolutionsgroup.com` (backend)
- `WEBAUTHN_EXPECTED_ORIGIN=https://warehouse-app.tcdsolutionsgroup.com` (backend)

The browser stores only a non-secret installation ID. Passwords, session tokens and WebAuthn challenges are never persisted by the PWA. The backend session cookie must be `Secure`, `HttpOnly`, `SameSite=Strict`, `Path=/`, and preferably named `__Host-tcds_wh_session`.
