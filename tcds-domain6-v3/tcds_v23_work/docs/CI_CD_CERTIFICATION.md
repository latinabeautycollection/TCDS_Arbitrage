# Domain 6.2A — CI/CD Certification Gate

The Scandit runtime must not reach production through an ordinary successful Vite build alone.

## Merge requirements

Merge the scripts and exact dependencies from `package-fragment.json` into the production PWA `package.json`.

If the PWA already has a `prebuild`, combine its current command with:

```bash
npm run scandit:prepare && npm run scandit:preflight
```

Do not overwrite an existing prebuild responsibility.

## Mandatory CI sequence

```bash
npm ci
npm run scandit:prepare
npm run scandit:preflight
npm run scandit:lint-boundary
npm run scandit:test
npm run build
npm run scandit:verify-dist
npm run scandit:verify-pwa-cache
```

Equivalent shortcut:

```bash
npm run scandit:certify
```

## Production promotion is blocked if any of these fail

- package or lockfile version parity;
- runtime file synchronization;
- manifest generation;
- SHA-256 verification;
- source architecture boundary;
- ESLint vendor-import boundary;
- TypeScript/Vite production build;
- provider contract tests;
- structured ContextStatus mapping tests;
- provider replacement registry tests;
- built-runtime hash parity;
- service-worker runtime cache verification.

## Existing Domain 6 tests

The production repository's existing `check`, `verify`, React integration tests, security tests, and other approved gates remain mandatory. 6.2A does not replace them.

The CI pipeline should execute both:

```text
existing Domain 6 certification
+
Domain 6.2A certification
```

before promotion.
