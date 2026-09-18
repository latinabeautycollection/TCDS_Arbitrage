# 6.2A Production Merge Guide

This ZIP is an overlay, not a replacement PWA.

## Preserve unchanged

Do not replace or rewrite:

- `features/receiving`
- `features/picking`
- `features/packShip`
- `features/inventory`
- `features/returns`
- `features/storage`
- existing Domain 6 APIs
- existing authentication/session ownership
- existing Warehouse Control
- existing PostgreSQL schemas

## Merge

- `src/lib/scanning/contracts`
- `src/lib/scanning/runtime`
- `src/lib/scanning/providers/scandit`
- `scripts/scandit`
- `config/eslint`
- `config/vitest`
- `config/vite`
- `config/nginx`
- `.env.example` keys
- dependency/script entries from `package-fragment.json`

## Package scripts

Do not replace the production `package.json`. Merge exact Scandit dependencies, test/lint tooling, and scripts.

If production already has `prebuild`, preserve it and append the 6.2A prebuild gates.

## Vite/PWA

Merge `config/vite/scanditPwaPrecache.ts` into the existing PWA service-worker strategy as documented in `PWA_CACHE_INTEGRATION.md`.

## Nginx

Include `config/nginx/scandit-runtime.conf` inside the existing HTTPS server block. Do not create a competing web server.

## License

`VITE_SCANDIT_LICENSE_KEY` is browser-visible by nature of the Web SDK. It must not be committed, logged, placed in PostgreSQL, or copied into telemetry/error details.

## 6.2A stop line

After merge and certification the provider may initialize its DataCaptureContext, but it must not:

- request camera permission;
- instantiate a Camera;
- instantiate BarcodeCapture;
- decode barcodes;
- produce WarehouseScanObservation;
- invoke Receiving/Picking/Packing/Return APIs.

Those begin in later 6.2 slices.
