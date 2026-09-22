# 6.2B Ownership Boundary

## 6.2B owns

Camera selection, camera permission state, camera on/off lifecycle, Scandit Barcode Capture creation, single barcode decode callback, capture pause/resume, DataCaptureView attachment, diagnostic scanner viewport, capture error mapping, browser lifecycle suspension, and the provider-neutral decode observation.

## Existing Domain 6 retains ownership

Receiving, putaway, inventory, picking, packing, shipping, returns, claims, barcode/entity resolution, barcode normalization, warehouse authorization, offline transaction replay, manual-entry exception policy, station readiness, PostgreSQL mutation, and arbitrage events.

## Core rule

`BarcodeDecodeObservation` means only:

> A configured capture provider observed these barcode primitives.

It never means:

- item accepted
- location valid
- pick successful
- package correct
- return matched
- warehouse mutation committed


## Warehouse Control/PostgreSQL authority

6.2B never owns scanner asset identity, scanner profile persistence, station readiness, barcode master data, scan telemetry persistence, or warehouse business outcomes. Browser/Scandit camera identifiers are diagnostics only.
