# Domain 6.2B — Integration Notes

## 1. Scope

Camera and barcode capture only: camera selection and permission, the camera on/off lifecycle, a single
barcode capture mode, one decode at a time, pause and resume, view attachment, capture error mapping,
browser lifecycle suspension, and a provider-neutral decode observation.

A decoded barcode is an observation. It is not a warehouse decision, and this slice calls no business API,
touches no database and changes no warehouse feature.

## 2. What was merged

- The delivered package, at the paths its documentation specifies. Package files are byte-identical to the
  delivery except where a change record says otherwise.
- The package fragment merged into the project manifest (test dependencies and the 6.2B scripts).
- The diagnostic route, protected by the existing application sign-in and with no navigation entry.
- Our corrections and tests, each with a change record in `CHANGE_RECORDS.md`.

The runtime slice stays certified: its suite runs first inside the capture certification chain.

## 3. How to certify

```
export DOMAIN6_2B_BASELINE_SHA=<the last runtime-slice commit, 40 characters>
npm run scandit:capture:certify
```

The chain is: runtime certification (version parity, runtime files, provider isolation, boundary lint,
runtime suite, production build, built-output parity, offline-cache parity) then the capture SDK version
check, the legacy adapter check, the capture boundary check, strict TypeScript for the capture project, the
capture suite, and a final production build.

`npm run check` and `npm run verify` cover the existing application checks and also pass.

The baseline is required and the check fails closed without it: the boundary rules are evaluated against the
difference between that baseline and the current head.

## 4. Diagnostic surface

Route: `/__diagnostics/scanner-capture`, behind the existing sign-in, no navigation entry, no new role. It
is loaded on demand, so the scanner SDK stays out of the initial bundle. On a device, and in an installed
PWA where there is no address bar, press and hold the scanner chip in the status strip to open it. The
gesture follows the same access rule as the route guard, read from the guard itself, so it adds no access
path of its own and closes when that rule is withdrawn.

It shows the scanner viewport, the capture controls, the decode result labelled as an observation, and a
read-only status section for the device test:

- runtime state, with ready, degraded or blocked
- runtime blocking reason
- runtime status code and category
- runtime message
- camera state: permission, camera on or off, background suspension
- capture state and whether capture is enabled
- capture status code and message
- SDK version, runtime asset version, implementation version
- active capture profile

It never renders the licence key, a raw SDK error, a stack trace, a configuration value or a raw SDK object.
A licence, domain or runtime failure therefore reads as a state and a code instead of "nothing happened".

Before a shared or staging deployment, confirm that the preview unlock flag is off, so the surface stays
behind sign-in.

## 5. Lifecycle rules this slice enforces

- The capture mode is created disabled. Capture becomes active only when the session reaches the capturing
  phase, so a barcode already in view during startup cannot decode early or break Start.
- The capture policy is the only feedback authority; the SDK's own success feedback is cleared.
- One decode at a time: a decode disables capture, emits the observation and leaves the session paused until
  an explicit resume.
- A restart always releases the previous attempt first, including after a timeout or a failure.
- Leaving the page during startup cancels the startup and releases the camera, listeners and view.
- A failed or blocked scanner is not suspended as a background session and does not return as ready.
- A recognised camera or runtime status code is authoritative and never reads as ready.
- Errors that leave the provider carry a code, a message, retryability and cleanup steps, with the
  underlying exception reduced to a redacted summary.

## 6. Test approach

The delivered suite tests contracts and models. We added a fake Scandit SDK, written from the real 8.5.3
type definitions and observed behaviour, and the real controller and hook run against it. That is what makes
the lifecycle rules above verifiable rather than described.

Current totals: runtime suite 54, capture suite 52.

## 7. Before the real-device matrix

1. Deploy a build that contains this slice to the test environment over HTTPS.
2. Confirm the preview unlock flag is off in that deployment.
3. Reach the surface on the device by pressing and holding the scanner chip in the status strip while
   signed in. Typing the URL still works in a browser.
4. The device matrix needs the device model, the operating system and browser version, the mode, the tester,
   the timestamp, the result and the evidence for every row.

## 8. Not in this slice

Business APIs and workflows, database access, telemetry persistence, offline replay, advanced capture modes,
and scanner profiles loaded from warehouse configuration. The capture policy used here is the immutable
certification policy that ships with the slice.
