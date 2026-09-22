# 6.2B Real Device Certification Matrix

Every row must record device model, iOS/browser version, PWA mode, tester, timestamp, result, and evidence.

## Required

### iPhone Safari
- cold start
- warm start
- first camera permission grant
- permission already granted
- permission denied
- Code128 decode
- EAN-13/UPC-A decode
- QR decode
- pause after decode
- Scan Again / resume
- stop/restart
- portrait
- landscape
- page background/foreground
- screen lock/unlock
- Wi-Fi loss while camera remains active
- Wi-Fi restore
- route exit releases camera

### Installed iPhone PWA
Repeat all above.

### Chrome iOS
- camera permission
- three certification symbologies
- pause/resume
- background/foreground
- stop/restart

## Required invariants

- No decode automatically calls a Domain 6 API.
- No database record changes as a result of 6.2B diagnostic scanning.
- Camera indicator turns off after stop/route exit/background suspension.
- Raw Scandit session/barcode objects never appear outside provider code.
