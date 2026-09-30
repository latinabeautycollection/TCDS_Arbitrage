# 6.2C Ownership

## Warehouse Control/PostgreSQL owns
- scanner asset identity
- scanner profile persistence
- supported symbologies
- enabled barcode symbology truth
- auto/continuous scan configuration
- beep/vibration configuration
- duplicate_suppression_ms
- scanner health/readiness

## 6.2B owns
- Camera
- BarcodeCapture
- BarcodeCaptureSettings
- SelectionMode mapping
- DataCaptureView
- scan-area execution
- capture feedback execution
- pause/resume/stop
- decode observation
- Scandit imports

## 6.2C owns
- capture-context identifiers
- certified safety envelopes
- read-only Warehouse Control DTOs
- config validation
- symbology reconciliation
- unit translation
- policy lineage
- output of BarcodeCaptureExecutionPolicy

## Domain 6 owns
- expected barcode/entity
- receiving/picking/packing/return decisions
- permissions
- inventory mutation
- business idempotency
- offline business replay
- supervisor overrides

## warehouse_telemetry owns
- persisted barcode scan events
- scanner health telemetry

6.2C writes none of those tables.
