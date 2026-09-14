# 6.2A Ownership Contract

6.2A owns runtime/package/version/deployment/provider abstraction only.

It MUST NOT own Camera, BarcodeCapture, symbologies, scan profiles, workflow validation, employee authorization, station readiness, telemetry persistence, inventory mutation, receiving, picking, packing, shipping, returns, claims, offline replay, or manual-entry policy.

A successful barcode decode is not possible in 6.2A by design.
