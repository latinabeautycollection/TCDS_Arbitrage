# TCDS Domain 6 Warehouse PWA Shell v3.0

## Controlled enhancement baseline

This release is built directly from the approved v2.2 shell. It preserves the existing 12-screen routing, component composition, mobile-centered layout, workflow boundaries, and shell-only responsibility. It is not a replacement architecture.

## Approved visual enhancements

- TCDS Enterprise Design System v1.0 tokens for primary and neutral scales.
- Exactly six typography roles: display, page, section, card, body, caption.
- Four elevation levels: surface, card, modal, floating.
- One enterprise border-radius token across cards, inputs, controls, and dialogs.
- Lucide iconography only.
- Subtle motion capped at 250 ms with reduced-motion support.
- Branded TCDS logo in the login and every application header.
- Gold page-title divider and restrained shield watermark.
- Dashboard command cards with action labels, counts, descriptions, and freshness metadata.
- System Status card for API, PostgreSQL, scanner, printer, Cloudflare R2, and sync.
- Desktop-only supervisor rails while preserving the centered mobile shell.
- Skeleton, empty, error, offline, and success presentation patterns.
- Digital Twin identity treatment on warehouse item screens.

## Docker and npm correction

The v2.2 lockfile contained internal OpenAI artifact-registry URLs. v3.0 replaces those URLs with the public npm registry, commits the corrected lockfile, supplies a project `.npmrc`, validates the repository before build, and uses `npm ci` for deterministic installation.

The Dockerfile performs:

1. Public-registry validation.
2. Deterministic `npm ci` installation.
3. TypeScript and Vite production build.
4. Nginx SPA hosting.
5. Runtime health check at `/health`.

Do not delete `package-lock.json` in Coolify or production. The corrected lockfile is part of the deployment contract.

## Verification completed

- Registry verification: passed.
- `npm ci`: passed.
- TypeScript `tsc --noEmit`: passed.
- Vite production build: passed.
- Docker runtime smoke test: included for Linode/Coolify; Docker was not available in the artifact-generation environment.
