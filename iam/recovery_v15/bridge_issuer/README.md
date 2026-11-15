# OIDC issuer access to the 623 IAM bridge (staging)

Gives the central OIDC issuer its **own** route to the 623 bridge, separate from the EOC BFF, as the dev team's
issuer handoff requires (separate certificate identities and audience-scoped HMAC keys).

| Layer | Change |
|---|---|
| Transport (`../mtls_bridge/eocMtlsProxy.cjs`, updated in place) | Accepts a list of identities (`identities` in its config), each an exact CN + its own SAN URI + a caller name. A certificate must match one identity completely. The proxy sends the matched caller upstream in `x-tcds-workload-caller`; clients cannot set that header |
| Request auth (`loginv2-6.1B-bridge-issuer.patch` on 6.1B `internalIamApi.ts`, `env.ts`, `integration.ts`) | The bridge accepts the issuer's own key `EOC_IAM_ISSUER_TOKEN` besides the BFF's `EOC_IAM_SERVICE_TOKEN`, and, through the proxy, requires the key to belong to the caller whose certificate was verified. It also accepts 32–128-hex-character nonces (see below). Every call is logged with its caller |
| Issuer identity | Client certificate CN `tcds-oidc-issuer-staging`, URI `urn:tcds:workload:oidc-issuer:staging`, from the staging CA, 90 days; key generated in `/etc/tcds-issuer` and never moved |
| Name resolution | `127.0.0.1 iam-bridge-stg.tcds.internal` in the Warehouse server's `/etc/hosts` (loopback route, matches the proxy certificate's DNS name) |

The EOC BFF's identity, key and behaviour are unchanged.

**Vendor finding:** the issuer's `iam-verifier-client.mjs` sends `x-eoc-workload-nonce` as 20 random bytes in hex,
while the 623 contract (and the dev team's own EOC `authorityClient`) uses a UUID, so every issuer call was refused.
The bridge now accepts both; a nonce is single-use either way (admitted by hash in the database).

## Staging certification, 2026-11-15

- `stg_bridge_issuer.sh test`: **6/6**: issuer readiness through proxy + bridge; unbound subject refused; issuer
  certificate + BFF key refused; random key refused; issuer `/internal/health/ready` ready (`iamBridge: true`); calls
  attributed to `oidc-issuer` via `oidc-issuer`.
- Regression, EOC BFF path: `stg_mtls.sh selftest` 9/9; `stg_eoc64.sh test` all expected (bridge auth, replay,
  subject snapshot, lockout/suspension, federation, leadership, housekeeping).
- Local chain test before deployment (the issuer's real client → patched proxy → patched bridge, stand-in database):
  8/8, including cross-key refusal in both directions.

`stg_bridge_issuer.sh revert` restores the bridge and proxy from the backups taken during the patch.
