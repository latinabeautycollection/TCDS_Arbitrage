# TCDS Domain 6 Warehouse PWA Shell v3.0

Controlled Fortune 500 visual enhancement of the approved v2.2 shell.

## Local verification

```bash
./scripts/preflight-shell.sh
npm run dev
```

## Docker verification

```bash
./scripts/smoke-docker.sh
```

## Coolify

Use the repository root as the build context and the included `Dockerfile`. Do not remove `package-lock.json`. No custom npm registry environment variable is required; the project `.npmrc` uses `https://registry.npmjs.org/`.

Health endpoint: `/health`

See `docs/V3_CONTROLLED_ENHANCEMENT_HANDOFF.md` for the full implementation contract.
