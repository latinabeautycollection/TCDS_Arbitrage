# Domain 6.2B — Certification Findings

Findings from our integration review of the delivered 6.2B package against the real Scandit 8.5.3 SDK.
Closed findings have a change record and at least one test. Open findings are listed with a recommendation
and are not fixed, so the slice stays inside its approved scope.

| ID | Severity | Finding | Status |
|---|---|---|---|
| B-01 | High | Capture live from camera start; SDK feedback outside the capture policy | Closed — CR-6.2B-04 |
| B-02 | High | Retry after a timeout or failure could leave the previous session attached | Closed — CR-6.2B-05 |
| B-03 | High | Leaving the page during startup left the camera on | Closed — CR-6.2B-06 |
| B-04 | Medium | Background and foreground could turn a failed scanner into READY | Closed — CR-6.2B-07 |
| B-05 | Medium | A camera or runtime status code could read as READY | Closed — CR-6.2B-08 |
| B-06 | Medium | Raw SDK exceptions crossed the capture boundary | Closed — CR-6.2B-09 |
| B-07 | Medium | No readable runtime status on the device surface | Closed — CR-6.2B-10 |
| B-08 | Medium | The protected-feature rule never fired in this repository | Closed — CR-6.2B-11 |
| B-09 | Medium | The suite did not exercise the shipped lifecycle | Closed — CR-6.2B-13 |
| B-10 | Low | A capture timeout leaves the camera running until the next Start | Closed — CR-6.2B-14 |
| B-11 | Low | The installed PWA has no way to reach the diagnostic surface | Closed — CR-6.2B-15 |
| B-12 | Low | The SDK is in the main bundle because the diagnostic route is imported eagerly | Closed — CR-6.2B-16 |
| B-13 | Low | Mid-session camera loss is not detected | Deferred to 6.2C |
| B-14 | Low | Capture-policy details that matter to the next slice | Deferred to 6.2C |

---

## B-01 — Capture was live from camera start

The SDK creates `BarcodeCapture` enabled, carrying its own success feedback, and attaches it to the context
at once. A barcode already in view therefore decoded while the session was still starting, which is an
illegal transition and failed the Start, and the SDK emitted a beep and a vibration although the capture
policy disables both. Closed by CR-6.2B-04.

## B-02 — Retry could stack a second session

Start skipped its teardown for the four error phases, so a retry after a capture timeout, a permission
failure or a camera failure could create a second capture mode and attach a second view to the same element
while the previous camera was still running. Closed by CR-6.2B-05.

## B-03 — Leaving the page during startup left the camera on

Session ownership was recorded only after Start resolved, and the unmount handler read it synchronously, so
an operator who navigated away during startup left the camera, the view and the listeners in place.
Closed by CR-6.2B-06.

## B-04 — Background and foreground masked a failure

Suspension patched the status to PAUSED from any phase and resume set permission GRANTED and phase READY,
so a failed scanner appeared healthy after the application was backgrounded. Closed by CR-6.2B-07.

## B-05 — A camera or runtime error could read as READY

The status assessment trusted the reported validity before the status code, so a camera runtime error, and a
licence rejection, could publish a healthy runtime. This was raised as a runtime-slice finding and fixed
here because the capture slice owns the file. Closed by CR-6.2B-08.

## B-06 — Raw SDK exceptions crossed the boundary

Capture errors kept the raw exception, cleanup records copied raw messages, and the surface turned every
lifecycle failure into an unhandled rejection carrying them. Closed by CR-6.2B-09.

## B-07 — No readable runtime status on the device

A licence, domain or runtime problem looked like "nothing happens", so the certification points that depend
on reading the runtime state could not be checked on the device. Closed by CR-6.2B-10.

## B-08 — The protected-feature rule never fired

The rule compared application-relative paths with the repository-relative paths Git reports. No changed file
could ever match, so the rule protected nothing in this repository. Closed by CR-6.2B-11, with a probe that
shows the same change passing before the fix and failing after it.

## B-09 — The suite did not exercise the shipped lifecycle

The delivered tests assert on contract objects and models; they never import the controller, the hook, the
camera module or the capture listener. Closed by CR-6.2B-13.

---

## B-10 — A capture timeout leaves the camera running (open)

When the capture timeout elapses, capture is disabled and the phase becomes an error phase, but the camera
keeps running until the next Start or until the surface is left. The camera indicator therefore stays on
after a timeout. The next Start does release everything (CR-6.2B-05), so nothing is stacked.

**Closed by CR-6.2B-14.** The timeout path now runs the same teardown as unmount and cancel.

## B-11 — The installed PWA cannot reach the diagnostic surface (open)

The diagnostic route has no navigation entry, by design. In an installed PWA there is no address bar, so the
device matrix rows for the installed PWA need either a temporary link, a deep link opened from Safari before
installation, or remote inspection.

**Closed by CR-6.2B-15.** A press and hold on the scanner chip in the status strip opens the surface for a
signed-in session. It is unlabelled and the route keeps its guard.

## B-12 — The SDK sits in the main bundle (open)

The diagnostic page is imported eagerly by the router, so the Scandit runtime is part of the main bundle for
every user of the application, not only for those who open the diagnostic surface.

**Closed by CR-6.2B-16.** The route is loaded on demand. The main chunk drops from 865 kB to 539 kB.

## B-13 — Mid-session camera loss is not detected (open)

If the camera is taken by another application or the track ends mid-session, the capture status is not
updated, because the camera state observer only reports transitions the SDK reports.

**Deferred to 6.2C** by agreement: it is a hardening case that belongs with the next slice.

## B-14 — Capture-policy details for the next slice (deferred to 6.2C, information)

- The duplicate-suppression value is documented by this slice in seconds, while the stored warehouse value
  is in milliseconds. The conversion belongs to the slice that loads the stored profile.
- The "explicit confirmation" selection option maps to an aim-to-select behaviour in the SDK, not to a
  confirmation dialog. The certification policy uses automatic selection, so this only matters when profiles
  select the other option.
- A binary QR payload has no text form. The observation currently carries the decoded text, so a binary
  payload will need a defined representation before it is used by a workflow.
- The viewport scan area is fixed to the certification policy area. Profiles that change it are a next-slice
  concern.
