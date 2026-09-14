# Domain 6.2A — PWA Runtime Cache Integration

6.2A owns runtime-asset availability, but it does not own Domain 6 offline transaction replay.

The certified Scandit runtime must be precached by the existing Warehouse PWA service worker so the exact JS/WASM runtime remains available after a successful application installation/update.

## Required production merge

Install the pinned `vite-plugin-pwa` dev dependency from `package-fragment.json` if the production PWA does not already provide an equivalent Workbox integration.

Import:

```ts
import { VitePWA } from 'vite-plugin-pwa';
import {
  createScanditPrecacheEntries,
  SCANDIT_MAXIMUM_FILE_SIZE_TO_CACHE_BYTES,
} from './config/vite/scanditPwaPrecache';
```

Merge into the **existing** Vite config; do not replace existing PWA configuration:

```ts
VitePWA({
  registerType: 'prompt',
  workbox: {
    ...(existingWorkboxConfig ?? {}),
    additionalManifestEntries: [
      ...(existingWorkboxConfig?.additionalManifestEntries ?? []),
      ...createScanditPrecacheEntries(),
    ],
    maximumFileSizeToCacheInBytes: Math.max(
      existingWorkboxConfig?.maximumFileSizeToCacheInBytes ?? 0,
      SCANDIT_MAXIMUM_FILE_SIZE_TO_CACHE_BYTES,
    ),
  },
})
```

If the application already has a custom Workbox/service-worker implementation, use `createScanditPrecacheEntries()` as the canonical list of exact versioned runtime URLs and SHA-256 revisions.

## Certification

After the production build:

```bash
npm run scandit:verify-dist
npm run scandit:verify-pwa-cache
```

Certification fails if:

- the built runtime directory is missing;
- any built runtime hash differs from the certified source manifest;
- there is no service-worker/workbox artifact;
- the service worker does not reference the exact versioned Scandit `sdc-lib` path;
- the service worker does not reference the runtime manifest;
- representative JS and WASM runtime files are absent from the generated cache manifest.

This is runtime availability only. Domain 6 `IndexedDB`, sync batches, replay, idempotency, conflicts, and authoritative transaction recovery remain owned by the existing Domain 6 synchronization subsystem.
