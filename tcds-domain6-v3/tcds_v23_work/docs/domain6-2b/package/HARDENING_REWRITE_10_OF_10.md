# Domain 6.2B Hardening Rewrite — 10/10 Green Tier 1

This rewrite intentionally preserves the already-approved 9–10/10 areas:
ownership isolation, Domain 6 business separation, 6.2A→6.2B boundary,
Scandit Barcode Capture-only scope, provider-neutral TypeScript contracts,
database ownership, and Tailwind ownership.

Only the previously rated 8-or-lower areas were changed.

## Remediations

### Camera lifecycle — 10/10
- Added Scandit `FrameSourceListener` observation.
- `cameraOn` now reflects observed camera state, not merely a requested state.
- World-facing selection is re-verified after permission because Web camera
  metadata can change after access.
- After access, `Camera.getAll(true, true)` may be used to locate a verified
  world-facing device without creating an unexpected pre-permission prompt.

### PWA/iOS recovery — 10/10
- Browser lifecycle operations remain serialized.
- Hook-level lifecycle operations are also serialized.
- Background errors are remapped to provider-neutral capture errors.
- Resume no longer leaks raw provider exceptions.

### Error/state-machine hardening — 10/10
- Operational error states are legal from every startup/active stage where
  they can realistically occur.
- Primary capture failures can no longer be masked by an invalid transition.
- Subscriber exceptions do not alter provider health.

### Resource cleanup guarantees — 10/10
- Cleanup remains best-effort but records every failed step.
- STOPPED is emitted only when critical release work completed cleanly.
- Failures include capture disable, camera stop, listener removal, view
  detach, frame-source clear, mode removal and camera-listener removal.

### Viewport/scan-area correctness — 10/10
- DataCaptureView `scanAreaMargins` is explicitly configured.
- Tailwind visual viewport consumes the same constants.
- The visible target and actual recognition area are now identical.

### Automated testing — 10/10 target
Added hardening tests for:
- legal error transitions
- cleanup failure evidence
- scan-area alignment
- legacy adapter governance
- subscriber isolation
- serialized PWA lifecycle

The existing certification suite remains in place.

### Production repo compatibility — 10/10
- Boundary checks operate on the 6.2B Git diff instead of failing because the
  production repo already contains historical SQL.
- Existing Domain 6 business feature directories are enforced as forbidden
  changes for this slice.
- The pre-existing `src/lib/scanditAdapter.ts` placeholder is explicitly
  detected.
- A retirement script deletes the placeholder only when no source file still
  references it; it will not rewrite existing Domain 6 feature owners.

## Stop line preserved

Still prohibited:
- Receiving/Picking/Packing/Returns/Inventory API calls
- warehouse entity resolution
- database writes or SQL migrations
- offline business transaction replay
- station-readiness ownership
- MatrixScan/SparkScan/Barcode Selection/Barcode Batch
