# EOC ↔ Warehouse IAM bridge: mTLS proxy, staging

Status: **deployed and certified on staging only.** Not used in production.

## What this is
Anthony's EOC backend runs on the acquisition server (23.239.12.166). It reaches the Warehouse IAM bridge through
`eocMtlsProxy.cjs` on the Warehouse server, at `https://iam-bridge-stg.tcds.internal:9443`. The EOC host maps that name
to 139.177.200.80 in `/etc/hosts`. The proxy runs under PM2 as `eoc-mtls-proxy-staging`, without root.

TLS terminates at the proxy. Only `GET`/`POST` under `/internal/v1/iam/eoc/` go through, unchanged, to the private internal
IAM listener on `127.0.0.1:8196`, and the bridge there still checks its own HMAC and nonce.

## Who gets in
A client must pass every one of these checks:
1. Its source IP is allowlisted: `23.239.12.166`, plus `127.0.0.1` for the selftest.
2. TLS 1.3, and its certificate chains to our private staging CA, checked in the handshake.
3. EKU `clientAuth`, exact CN `tcds-eoc-acquisition-staging`, and a single SAN `URI:urn:tcds:workload:eoc:staging:acquisition`.
4. Its SHA-256 fingerprint is listed in `allowed_clients.txt`. The file is re-read on every request, so removing a line
   revokes the certificate without a restart.

The proxy forwards only these headers: `content-type`, `content-length`, `accept`, `x-request-id` and the three
`x-eoc-workload-*` HMAC headers. Request bodies are capped at 4096 bytes.

## Keys and certificates
Everything lives in `~/stg_login/mtls` on the Warehouse server, mode 700, and **none of it is in the repo**:

| File | Contents |
|---|---|
| `ca.key` / `ca.crt` | CN "TCDS EOC IAM Bridge Staging CA", 730 days, pathlen 0 |
| `server.key` / `server.crt` | Server certificate: DNS name and IP above, 365 days |
| `issued/` | Signed client certificates |
| `allowed_clients.txt` | Allowlisted client fingerprints |

The client private key is generated on the acquisition server and never leaves it. We only sign the CSR, and `sign`
applies our own extensions instead of the ones the CSR asks for.

Host firewall: `ufw allow from 23.239.12.166 to any port 9443 proto tcp`. No Linode Cloud Firewall is assigned.

## Staging certification (2026-11-07)
- `selftest`: 9/9 PASS, checks M1–M9.
  - Refused: no certificate, foreign CA, wrong CN, not allowlisted, a path outside the bridge, a bad bridge signature, the public-IP source.
  - Accepted: a valid signed `ready`, which returns 200.
- From the acquisition server:
  - TCP is reachable.
  - Without a client certificate: `TLS_REJECTED ERR_SSL_PEER_DID_NOT_RETURN_A_CERTIFICATE`.
  - With the issued certificate but no HMAC: 401 `UNAUTHORIZED`.
  - Anthony's signed readiness check as `tcds-eoc`: 200 `{ready, epochAuthority, federationAuthority}` all true.
- Client certificate issued: fingerprint `5E:3C:3B:F5:…:EC:60:C1:D9`, valid until 2027-02-05.

## Still open
- Production CA owner and placement: Anthony and governance decide at release.
- The client certificate lasts 90 days. Renew it before 2027-02-05 with a new CSR, then `sign`, then `revoke` the old fingerprint.

## Usage (on the Warehouse server)
```bash
bash /tmp/recov15/mtls/stg_mtls.sh status
bash /tmp/recov15/mtls/stg_mtls.sh sign /tmp/<client>.csr   # prints the two PUBLIC files to send back
bash /tmp/recov15/mtls/stg_mtls.sh revoke <fingerprint>
bash /tmp/recov15/mtls/stg_mtls.sh selftest
```
