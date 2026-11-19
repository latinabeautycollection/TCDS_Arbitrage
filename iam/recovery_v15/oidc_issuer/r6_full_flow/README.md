# Issuer full sign-in flow harness (r6 → r8)

Drives a complete EOC sign-in through the **real** issuer (`src/server.mjs` + oidc-provider), behaving like a browser:
`/auth` → interaction page → options → passkey form POST (Origin sent per the page's Referrer-Policy) → resume →
callback code (CSP `form-action` enforced on every redirect after the POST) → `/token` → ID token checked with the
EOC BFF's own `normalizeClaims` (amr must include webauthn).
`deny.mjs` checks what a person sees when sign-in is refused or a link is stale (readable page, JSON kept for API calls).

Local stand-ins only: a TLS Postgres container with the issuer schema (`sql/001..003`), and an mTLS IAM stub
(`iam_stub.mjs`) answering the issuer's IAM contract. It does not verify a real WebAuthn assertion.

Setup: a test CA + server/client certs in `certs/` (server SAN localhost/127.0.0.1, client EKU clientAuth); container
`oidcflowpg` on 127.0.0.1:55640 with ssl=on; load sql/001..003 (create roles anon/authenticated/service_role first).
Run: `NM=<bundle>/node_modules EOC_POLICY=<eoc>/server/policy.mjs bash run.sh <unpacked bundle dir>`
Refusals: `STUB_DENY=1 DRIVER=deny.mjs ... bash run.sh <bundle dir>`. Throwaway secrets are generated in `secrets/`.
