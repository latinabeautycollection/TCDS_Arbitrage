# Domain 6.2B Green Tier 1 Certification Checklist — Filled In (29 of 33)

Legend: **PASS** verified by an automated check that runs in certification ·
**REVIEW** verified by code review only · **DEVICE** waiting for the real-device matrix.

One command reproduces every automated result:

```
DOMAIN6_2B_BASELINE_SHA=<last 6.2A commit> npm run scandit:capture:certify
```

## Ownership and isolation

| | Item | Status | Evidence |
|---|---|---|---|
| ✅ | Hardened 6.2A remains certified | PASS | `scandit:certify` runs first inside `scandit:capture:certify`; 6.2A suite 54/54 |
| ✅ | Scandit imports remain provider-isolated | PASS | `verify-scandit-boundary.mjs`, the 6.2B boundary check and the boundary ESLint config |
| ✅ | BarcodeCapture is the only capture mode | PASS | the 6.2B boundary check rejects every advanced mode identifier |
| ✅ | No advanced Scandit modes | PASS | same check; the single documented exception is the capture-policy type name, not a mode |
| ✅ | No Domain 6 business API calls | PASS | forbidden-token scan over the scanner subsystem plus `noBusinessAuthority` |
| ✅ | No SQL files or migrations | PASS | the boundary check inspects every changed path against the baseline |
| ✅ | No PostgreSQL mutation | PASS | no database client, query or migration exists in the subsystem |
| ✅ | No warehouse scan-observation business integration yet | PASS | the decode observation is provider-neutral and is consumed only by the diagnostic surface |

## Camera lifecycle

| | Item | Status | Evidence |
|---|---|---|---|
| ✅ | Camera permission is intentional only | PASS | the camera is requested inside `start()` only; `scannerHookLifecycle` proves a start that was abandoned never reaches the provider |
| ⚠️ | World-facing camera preference works | REVIEW + DEVICE | preference is applied and re-verified after access; the device matrix confirms it |
| ⚠️ | Best-camera fallback for camera-not-found | REVIEW + DEVICE | fallback path is implemented for `CAMERA_UNAVAILABLE`; no simulator reproduces the real case |
| ⚠️ | Recommended BarcodeCapture camera settings are applied | REVIEW | settings are applied before the camera starts |
| 🔴 | DataCaptureView renders | DEVICE | requires the deployed surface on a device |
| ⚠️ | Picture-in-picture is disabled | REVIEW | disabled on the view before attachment |
| ✅ | Camera is released on route unmount | PASS | `scannerHookLifecycle` covers unmount during startup and before startup |
| ✅ | Camera is released while the PWA is hidden | PASS | `pwaLifecycleContract`; `captureLifecycle` proves a failed scanner is not suspended or silently resumed |
| ✅ | Session resumes only when the scanner surface still owns it | PASS | ownership is claimed inside the queued operation and re-checked after every step |
| ✅ | Start/stop/resume operations are serialized | PASS | single operation queue in the controller; covered by the repeated-Start and repeated-failure tests |
| ✅ | Stop disables capture before camera shutdown | PASS | `cleanupContract` plus the documented cleanup order in the controller |
| ✅ | Repeated Start leaves no stale camera session | PASS | `captureLifecycle`: previous camera stopped, mode removed, listener removed, view detached |
| ✅ | Repeated failure and retry leak no resources | PASS | `captureLifecycle`: every camera, capture listener and view is balanced except the live one |

## Decode behaviour

| | Item | Status | Evidence |
|---|---|---|---|
| 🔴 | Code 128 decodes | DEVICE | symbology is enabled by the certification policy; a real barcode is needed |
| 🔴 | EAN-13 / UPC-A decodes | DEVICE | as above |
| 🔴 | QR decodes | DEVICE | as above |
| ✅ | `didScan` copies primitives only | PASS | `deviceIdentityBoundary`; the listener copies inside the callback |
| ✅ | The SDK session object never escapes the callback | PASS | same test and the provider-neutral observation contract |
| ✅ | Decode disables capture before the observation is emitted | PASS | `captureLifecycle`: after a decode the phase is PAUSED and capture is disabled |
| ✅ | Capture stays paused until an explicit resume | PASS | same test |
| ✅ | A barcode already visible during startup cannot decode early | PASS | `captureLifecycle`: the mode is created disabled and out-of-phase decodes are ignored |
| ✅ | A decode from a replaced session is rejected | PASS | `captureLifecycle`: an in-flight callback from the previous mode is ignored and that mode is disabled |
| ✅ | Feedback follows the capture policy only | PASS | `captureLifecycle`: the SDK success feedback is cleared and nothing is emitted when the policy disables it |

## Device controls and state

| | Item | Status | Evidence |
|---|---|---|---|
| ✅ | Torch control renders only when supported | PASS | torch availability comes from the camera controls; the control is capability-driven |
| ✅ | Zoom availability is capability-driven | PASS | reported from the camera controls, never assumed |
| ✅ | Impossible state transitions fail closed | PASS | `captureStateMachine` and `captureStateMachine.hardened` |
| ✅ | A camera or runtime error never reads as READY | PASS | `runtimeErrorMapping` |
| ✅ | Raw provider exceptions never cross the boundary | PASS | `captureLifecycle` checks the capture error and the cleanup record |
| ✅ | A failure is readable on the device surface | PASS | `diagnosticStatusSurface` |

## Real-device matrix

| | Item | Status | Evidence |
|---|---|---|---|
| ✅ | The surface can be opened on an installed PWA | PASS | `diagnosticsEntry`: press and hold the scanner chip in the status strip, under the same access rule as the route guard |
| 🔴 | iPhone Safari matrix passes | DEVICE | open — needs the deployed build |
| 🔴 | Installed iPhone PWA matrix passes | DEVICE | open |
| 🔴 | Chrome iOS baseline passes | DEVICE | open |

## Regression

| | Item | Status | Evidence |
|---|---|---|---|
| ✅ | Existing Domain 6 checks and regressions remain green | PASS | `npm run check` and `npm run verify` exit 0; production build succeeds |

## Summary

- **29 of 33 items** are verified today; 4 wait for the real-device matrix, and 4 of the verified items rest
  on code review because no automated check can reproduce real camera hardware.
- Automated totals: 6.2A **54/54**, 6.2B **52/52**, strict TypeScript PASS, build PASS, runtime, cache and
  version parity PASS, boundary PASS, protected-feature check PASS.
