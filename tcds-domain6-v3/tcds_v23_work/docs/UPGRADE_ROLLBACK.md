# Domain 6.2A Upgrade / Rollback Runbook

## Upgrade

1. Open a dedicated upgrade branch.
2. Select and document the exact approved Scandit Web SDK version.
3. Review current Scandit release notes/API documentation.
4. Update Core and Barcode packages to the same exact version.
5. Run `npm ci`.
6. Run `npm run scandit:prepare`.
7. Confirm `/public/scandit/<NEW_VERSION>/` is newly generated; never overwrite another certified version.
8. Generate and verify the SHA-256 runtime manifest.
9. Run `npm run scandit:preflight`.
10. Run `npm run scandit:lint-boundary`.
11. Run `npm run scandit:test`.
12. Run the production TypeScript/Vite build.
13. Run `npm run scandit:verify-dist`.
14. Run `npm run scandit:verify-pwa-cache`.
15. Run the existing Domain 6 regression/security suite.
16. Perform browser/PWA runtime initialization certification.
17. Deploy the new application while retaining the prior versioned Scandit runtime assets.
18. Record certification.
19. Keep the previous application/runtime pair until the rollback window closes.

## Rollback

Rollback is atomic at the application/runtime contract level:

```text
application build
=
Scandit package versions
=
lockfile
=
generated scanditVersion.ts
=
runtime-manifest.json
=
/scandit/<VERSION>/ runtime
```

Never:

- use `/latest`;
- overwrite a certified runtime directory;
- roll back only WASM while retaining a newer app bundle;
- roll back only npm dependencies while serving newer runtime assets.

The prior application release and matching versioned runtime must be restored together.

## Rollback proof

Before production approval, rehearse:

1. deploy candidate version;
2. verify initialization;
3. switch back to prior application release;
4. confirm it references the prior versioned runtime;
5. verify prior runtime manifest/hash integrity;
6. verify service-worker cache points at the prior runtime;
7. verify existing Domain 6 behavior is unchanged.
