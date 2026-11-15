# Central OIDC issuer (Domain 6.4 V1.2): staging deployment

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
- `OIDC_PRODUCTION_ENABLED` must be `true` for the process to start at all (`policy.mjs`); "disabled" on staging means
  loopback-only with no public site.
- The DB URL deliberately has no `sslmode`: with it, node-postgres would override the explicit `ssl.ca` and drop CA pinning.
- PM2 only reads a config file whose name ends in `.config.cjs`; hence `ecosystem.issuer.config.cjs`.
