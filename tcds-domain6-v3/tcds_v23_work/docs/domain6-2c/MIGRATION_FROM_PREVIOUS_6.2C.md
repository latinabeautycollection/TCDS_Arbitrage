# Previous 6.2C Replacement

The earlier 6.2C package must not be layered over production.

It incorrectly crossed into 6.2B implementation by including/modifying files
such as:

- BarcodeCaptureCapability.ts
- WarehouseSymbology.ts
- scanditBarcodeCapture.ts
- ScanditBarcodeCaptureController.ts
- scanditDataCaptureView.ts
- captureFeedback.ts
- useProfiledBarcodeScanner.ts

This rewrite supersedes that design.

Production implementation should begin from the commit containing certified
6.2A + the final production-hardened 6.2B, then overlay ONLY this rewritten
6.2C package.
