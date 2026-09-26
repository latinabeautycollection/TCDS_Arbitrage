# Domain 6.2B — Real-device test evidence

| | |
|---|---|
| Device | iPhone 17 |
| Operating system | iOS 27.0 |
| Browsers | Safari, installed Home Screen web app, Chrome for iOS |
| Application | the deployed warehouse PWA over HTTPS, build carrying the 6.2B follow-up |
| Scanner runtime | Scandit 8.5.3, 44 runtime files served, hashes matching the certified manifest |
| Tester | integration team |
| Date | 2026-09-26 |
| Result | **39 checks passed, 0 failed** |

Test targets: the three certification symbologies (Code 128, EAN-13/UPC-A, QR) rendered on a screen at
full brightness, scanned from about 20 cm.

---

## 1. Result by block

| | Block | Checks | Result |
|---|---|---|---|
| ✅ | Safari | 21 | all passed |
| ✅ | Installed Home Screen web app | 10 | all passed; the sign-in check is not applicable |
| ✅ | Chrome for iOS | 5 | all passed |
| ✅ | Rules that must hold everywhere | 4 | all held |

The sign-in check is marked not applicable because the authenticated shell is not wired yet, which was
confirmed in writing before testing. Temporary preview access was enabled for the test window.

## 2. What the device run proves

- **All three certification symbologies decode** on a real device, in all three browsers. UPC-A is reported
  in its 13-digit form with a leading zero, under symbology `EAN13_UPCA`.
- **One scan at a time.** Every decode pauses capture and states that the observation is not warehouse
  validated. Scanning only continues after an explicit resume.
- **The camera is released** on Stop, on leaving the page, and on backgrounding. The device camera indicator
  goes out each time, confirmed repeatedly in all three browsers.
- **The capture timeout releases the camera by itself.** After 60 seconds without a decode the surface shows
  `CAPTURE_TIMEOUT` and the camera indicator goes out, without any further action. The next Start is clean.
- **A denied camera produces a readable state**, not a blank screen: phase `PERMISSION_DENIED`, camera
  `DENIED / OFF`, capture code `CAMERA_PERMISSION_DENIED`, with a plain instruction to the operator.
- **Scanning works offline.** With Wi-Fi switched off mid-session, decoding continued. This is what the
  precached runtime buys.
- **Nothing sensitive reaches the screen** in any state: no licence key, no raw SDK error, no stack trace,
  no configuration value. Checked on the healthy, timed-out and permission-denied states.
- **The hidden entry point works** in the installed web app: press and hold opens the surface, a normal tap
  does nothing.
- **The runtime status code read `1 / SUCCESS`** on the device. This closes the runtime-slice item that
  could not be confirmed without real hardware.

## 3. Observations

Seven observations were recorded. None is a decode or lifecycle failure, and none blocks certification of
this slice. They are listed with our recommendation; nothing was changed during the test window, so the
evidence describes the build as deployed.

| | Observation | Owner |
|---|---|---|
| 🔴 | **D-1** The installed web app re-asks for camera permission after a background, when the camera was live | platform |
| ⚠️ | **D-2** First launch downloads about 15 MB of runtime before the surface is usable | trade-off |
| ⚠️ | **D-3** Content sits under the Dynamic Island in landscape and under the floating navigation in portrait | application shell |
| ⚠️ | **D-4** The diagnostic surface needs scrolling between the camera and its controls | this slice |
| ⚠️ | **D-5** The previous result stays on screen after a capture timeout | this slice |
| ⚠️ | **D-6** UPC-A arrives in 13-digit form; barcode matching must expect it | later slice |
| ⚠️ | **D-7** Camera permission is asked per browser application and per fresh tab | platform |

### D-1 — camera permission after a background (platform)

In the installed web app, if the camera is live when the application is backgrounded, iOS asks for camera
permission again on return. Every time. It does not happen when the camera was stopped first, when the
screen is merely locked and unlocked, in a Safari tab, or in Chrome.

The same code runs in all three, so the cause is the display mode, not the slice: iOS does not persist a
camera grant for a Home Screen web app. This is WebKit bug 215884, open since 2020 and still under
discussion in 2026, with other barcode-scanning web apps reporting the same behaviour. One report there
notes that a persistent grant set in Safari reverts to "ask" once the application is opened from the Home
Screen.

The prompt cannot be removed by the application. What can be improved is when it appears: in standalone
mode the scanner could return from a background **paused**, so the prompt follows the operator's own tap
rather than appearing unbidden. We have not made that change; it is offered for decision.

### D-2 — first launch cost

| Situation | Surface opens | First Start |
|---|---|---|
| Installed app, first launch | 40–50 s | fast afterwards |
| Installed app, later launches | 10–15 s | fast |
| Chrome, first visit | fast | about 30 s |
| Any browser, afterwards | fast | fast |

The service worker precaches the whole scanner runtime: 45 files, including two WebAssembly files of
7,520,894 and 7,465,207 bytes, about 15 MB. Whichever comes first, the surface or the first Start, pays for
it, and each browser keeps its own cache. The precache is deliberate and required by the runtime slice's own
verification, and it is what made offline scanning work. Our suggestion is to keep it and show progress on
the first launch, so a 40-second wait does not read as a hang.

### D-3 — safe areas

In landscape the Dynamic Island covers the left edge of the surface, hiding part of the decoded value and
the resume control. In portrait the floating navigation is drawn over the scanner controls. Applying the
device safe-area insets and reserving space for the floating navigation would fix both. This is the
application shell rather than the scanner slice.

### D-4 and D-5 — the diagnostic surface

The camera sits at the top and the controls below two status blocks, so the tester scrolls down to press a
button and back up to aim. A successful decode is announced in text only. After a capture timeout the
previous decoded value is still displayed under the timeout message.

Both are contained to this surface, which certification uses and operators do not. If wanted: move the
controls directly under the camera, add a clear colour signal, and clear the last observation when an
attempt ends without a decode.

### D-6 — UPC-A representation

`036000291452` is reported as `0036000291452`, symbology `EAN13_UPCA`. Anything that matches scanned codes
to warehouse records has to expect that form. That belongs to the workflow slice.

### D-7 — permission scope

Safari, Chrome and the installed application each ask for the camera separately, and a newly opened tab asks
again. Expected platform behaviour, recorded so it is not mistaken for a defect.

## 4. Certification status of the slice

| | Check | Result |
|---|---|---|
| ✅ | Runtime regression suite | 54/54 |
| ✅ | Capture suite | 52/52 |
| ✅ | Strict TypeScript, library checking on | PASS |
| ✅ | Production build and offline cache | PASS, 45 precache entries |
| ✅ | Version, runtime and cache parity | PASS, 8.5.3, 44 runtime files |
| ✅ | Provider, boundary and protected-feature checks | PASS |
| ✅ | Continuous integration | PASS |
| ✅ | Real-device matrix | **39/39** |

## 5. Remaining for Milestone 1

1. A decision on the observations above, in particular D-1 and D-3.
2. Returning the shared deployment to its secure posture once testing is accepted: temporary preview access
   switched off and redeployed.
3. The policy slice, then acceptance of the three slices together.
