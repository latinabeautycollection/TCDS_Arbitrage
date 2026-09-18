# Production Merge Guide — Domain 6.2B

1. Require the hardened 6.2A branch/commit to be merged and certified first.
2. Extract this package outside the repository.
3. Overlay:
   - `src/lib/scanning/capture/**`
   - provider-specific Scandit 6.2B files
   - replacement `ScanditScannerProvider.ts`
   - `src/hooks/useBarcodeScanner.ts`
   - `src/components/scanning/**`
   - `src/pages/diagnostics/ScannerCaptureDiagnosticPage.tsx`
   - `tests/scanning-6.2b/**`
   - `config/vitest/scandit-6.2b.vitest.config.ts`
   - `scripts/scandit/verify-domain6-2b-boundary.mjs`
4. Merge `package-fragment.json`; do not replace the production `package.json`.
5. Add the diagnostic page to the **existing protected diagnostic/admin routing system**. Do not create a public unauthenticated route. Adapt to the production `ProtectedRoute`/permission API instead of inventing another authorization layer.
6. Do not edit `src/features/receiving`, `picking`, `packShip`, `returns`, `storage`, or `inventory`.
7. Run:
   - `npm ci`
   - `npm run scandit:certify`
   - `npm run scandit:capture:architecture`
   - `npm run scandit:capture:test`
   - `npm run build`
   - existing Domain 6 `check` / `verify`
8. Deploy to staging HTTPS.
9. Test the diagnostic route on the actual warehouse iPhone in Safari and as an installed Home Screen PWA.
10. Do not begin 6.2C until the real-device certification matrix is complete.

## Camera permission

Do not request permission at login/bootstrap. Permission must be triggered from an intentional Start Scanner action.

## Stop order

The controller follows the documented safe shutdown sequence:

1. `BarcodeCapture.setEnabled(false)`
2. camera `FrameSourceState.Off`
3. remove listener
4. detach `DataCaptureView`
5. `context.setFrameSource(null)`
6. remove Barcode Capture mode

## Diagnostic semantics

The diagnostic page may show:
- decoded value
- symbology
- capture timing
- permission state
- camera/capture state

It must never show:
- ITEM ACCEPTED
- PICK SUCCESS
- LOCATION VALID
- RETURN MATCHED
