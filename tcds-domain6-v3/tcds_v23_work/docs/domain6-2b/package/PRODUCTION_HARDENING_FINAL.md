# Domain 6.2B — Production Hardening Final

This revision implements the final pre-production recommendations.

## Permanent ownership contract

### 6.2A owns
- Scandit SDK/runtime installation
- provider/runtime initialization
- context health
- version/self-host/integrity controls

### 6.2B owns
- camera lifecycle
- Barcode Capture lifecycle
- DataCaptureView lifecycle
- physical decode
- capture-state machine
- pause/resume/stop
- background/foreground recovery
- provider error translation
- capture feedback execution
- application of an already-validated provider-neutral capture policy

### 6.2C will own
- obtaining/reconciling authoritative scanner configuration
- validating it against the certified policy envelope
- translating Warehouse Control configuration into BarcodeCaptureExecutionPolicy
- choosing which approved capture profile applies

6.2C must not implement camera/BarcodeCapture mechanics.

### Warehouse Control/PostgreSQL retains
- authoritative scanner/device configuration
- symbology enablement truth
- scanner asset identity
- health/readiness
- station readiness

### Domain 6 retains
- business validation
- expected entity/barcode
- acceptance/rejection
- item/location/package status
- workflow progression
- idempotency
- offline business replay
- supervisor authorization

### warehouse_telemetry retains
- authoritative persisted scan events/health telemetry

6.2B does not write PostgreSQL.

## Device identity doctrine

Browser/Scandit camera IDs are diagnostic only.

They are never interchangeable with:
- warehouse.devices.device_id
- warehouse.device_sessions.session_id
- warehouse_control.assets.asset_id

## Certification is read-only

The old `src/lib/scanditAdapter.ts` placeholder must be removed in a reviewed
implementation commit. The certification command only verifies its absence.
It never deletes or rewrites source.

## Fail-closed Git ownership gate

Production certification requires:

```bash
export DOMAIN6_2B_BASELINE_SHA=<full-40-char-sha-before-6.2B>
```

If the SHA is absent, malformed, unavailable, or the Git diff cannot be
computed, certification fails.

## Exact Scandit SDK

Production target:

```text
@scandit/web-datacapture-core    8.5.3
@scandit/web-datacapture-barcode 8.5.3
```

Both package.json and package-lock.json must pin/resolve exactly 8.5.3 and the
installed node_modules package versions must match.

6.2A still owns the self-hosted runtime version/integrity invariant.

## 6.2C seam

6.2B exposes `BarcodeCaptureExecutionPolicy`.

It contains capture execution values only:
- symbologies
- duplicateFilterSeconds
- selection
- scan area
- feedback
- policy lineage

There are no item/location/package/task IDs and no warehouse outcomes.

The immutable 6.2B certification policy remains Code128 + EAN13/UPCA + QR.
