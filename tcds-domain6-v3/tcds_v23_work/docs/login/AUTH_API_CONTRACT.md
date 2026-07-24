# Phase 1 Authentication API Contract

The PWA expects same-origin routes under `/api/v1/auth` and Secure, HttpOnly session cookies.

- `GET /bootstrap`
- `GET /session`
- `POST /login`
- `POST /logout`
- `POST /passkeys/registration/options`
- `POST /passkeys/registration/verify`
- `POST /passkeys/authentication/options`
- `POST /passkeys/authentication/verify`
- `GET /passkeys`
- `DELETE /passkeys/:passkeyId`

The backend—not React—owns password verification, Argon2id, lockout, rate limiting, device trust, facility/station authorization, RBAC, challenge generation/consumption, WebAuthn verification, session creation and audit writes.

## Phase 1.1 addition: passkey availability

`POST /api/v1/auth/passkeys/availability`

Request:
```json
{ "identifier": "EMP-0001" }
```

Response:
```json
{ "available": true }
```

Security requirements: authenticated device context, identical response shape, bounded timing, rate limiting, generic failure behavior, audit logging, and no disclosure of employee status or credential metadata.
