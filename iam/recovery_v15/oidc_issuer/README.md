# Central OIDC issuer (Domain 6.4 V1.2): staging deployment

**Current bundle: `issuer-v1.2-r4.tgz`** = r3 + two stricter points taken from the dev team's V1.4
(`issuer-v1.2-r4-fixes.patch`, apply with `git apply -p2`):
1. While login is disabled, discovery, JWKS and the two health checks are served to **GET only**; any other method on
   them gets 503 `LOGIN_DISABLED` like every other route.
2. An `OIDC_LOGIN_ENABLED` value other than exactly `true` / `false` **refuses to start** (`OIDC_LOGIN_FLAG_INVALID`).
   A missing value still starts with login disabled and a warning.

V1.4's own `policy.mjs`/`server.mjs`/`login-gate.mjs` were not adopted: r3 already met the three fixes, and V1.4 drops
r3's defence in depth (no account lookup and no passkey begin/complete while disabled) and reports
`/internal/health/ready` as not ready while login is disabled. `iam-verifier-client.mjs` and `package.json` are
byte-identical in both. Tests 203/203 (r3's 154 + 49). Staging 2026-11-17: `issuer_deploy.sh upgrade-r4`, verify 23/23.
`rollback-r4` returns to r3.

---

Previous: **`issuer-v1.2-r3.tgz`** = r2 + the dev team's three fixes (`issuer-v1.2-r3-fixes.patch`):
1. `OIDC_PRODUCTION_ENABLED` replaced by `OIDC_RUNTIME_ENABLED` (process start) and `OIDC_LOGIN_ENABLED` (authentication,
   fail closed: only the exact string `true` enables it). While disabled, only discovery, JWKS and the two health checks
   are served; authorization, token, interaction/passkey, userinfo and every other route get 503 `LOGIN_DISABLED`, and
   `findAccount` returns no account, so no code or token can be issued or exchanged.
2. `provider.proxy = true` (oidc-provider 9.13.3; `provider.app` is deprecated). `oidc-provider` pinned to 9.13.3.
3. The IAM bridge/passkey client sends `randomUUID()` nonces (was 20 random bytes in hex), signed exactly as sent.

Tests: 154/154 (their 130, one extra startup refusal, 23 new for the fixes). `issuer_deploy.sh upgrade` moves a running
r2 to r3 (env backed up); `rollback` returns to r2.

---

Original r2 notes:

Runs the dev team's issuer **unchanged** (`issuer-v1.2-r2.tgz` = their `src/`, `deploy/`, `tests/`, `sql/`,
`eoc-bff-overlay/`, `scripts/provision-private-secrets.mjs`, verified against their `SHA256SUMS`) with our
`package.json` / `package-lock.json`:

- `oidc-provider` **9.13.3** instead of their 9.5.0. 9.5.0 fails `npm audit` (`@koa/router` 14,
  GHSA-47p6-69vm-vw6v, access-control bypass). 9.15.0 also fixes it but was too new (released 2026-11-13).
  0 vulnerabilities, all 130 of their tests pass, every package from registry.npmjs.org.

`issuer_deploy.sh` on the Warehouse server (139.177.200.80):

| Step | What it does |
|---|---|
| `install-runtime` | Own Node v22.23.4 under `/srv/arb-system/oidc_issuer/runtime` (pinned sha256). System Node 20 untouched |
| `install-app` | sha-pinned bundle, `npm ci --ignore-scripts`, audit, syntax check, 130 tests |
| `secrets` | `/etc/tcds-issuer` (0700): their generator (RS256-3072 JWKS, client id/secret, cookie + CSRF keys), our IAM keys (a NEW issuer-only 623 bridge key), Supabase root CA, `issuer.env` (0600). Nothing printed |
| `start` | PM2 `oidc-issuer-staging` from a clean environment, `127.0.0.1:8401` only |
| `verify` | 13 checks: discovery, public-only JWKS, refusals, loopback only, no inherited secrets |

Staging result 2026-11-15: running, verify 13/13. Readiness refuses until the IAM side (bridge key, passkey service) exists.
No nginx site until the `login-stg` DNS record exists.

Notes:
- (r2 only) `OIDC_PRODUCTION_ENABLED` had to be `true` for the process to start at all; fixed in r3.
- The DB URL deliberately has no `sslmode`: with it, node-postgres would override the explicit `ssl.ca` and drop CA pinning.
- PM2 only reads a config file whose name ends in `.config.cjs`; hence `ecosystem.issuer.config.cjs`.
