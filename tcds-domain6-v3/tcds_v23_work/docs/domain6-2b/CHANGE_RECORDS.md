# Domain 6.2B — Change Records

Every change we made to the delivered 6.2B package, in the format requested for review:
finding, root cause, affected files, fix, test added, certification result.

The package files are otherwise byte-identical to the delivery.

---

## CR-6.2B-01 — Retire the legacy scanner adapter placeholder

**Finding.** The package requires the legacy adapter to be absent, and ships a check for it.
**Root cause.** A placeholder module from before the Scandit work was still in the tree with no consumers.
**Affected files.** `src/lib/scanditAdapter.ts` (removed).
**Fix.** Removed the placeholder. No import of it existed anywhere in the application.
**Test added.** None needed; `verify-legacy-scandit-adapter-absent.mjs` and `legacyAdapterGovernance` cover it.
**Certification result.** Legacy adapter check PASS.

---

## CR-6.2B-02 — Package integration corrections

**Finding.** The package as delivered produced 8 strict TypeScript errors and 3 test failures in this repository.
**Root cause.** Four independent causes: `SelectionMode` was imported from the Core package instead of the
Barcode package; the frozen certification symbology list was not asserted as a literal tuple; the scanner
component still passed a start option the capability contract no longer accepts; the 6.2B TypeScript project
did not include the environment type declarations. The three failing tests read a packaging file that only
exists inside the delivered package, compared a floating-point margin exactly, and scanned the whole
application rather than 6.2B-owned paths.
**Affected files.** `src/lib/scanning/providers/scandit/scanditBarcodeCapture.ts`,
`src/lib/scanning/capture/BarcodeCaptureCapability.ts`, `src/components/scanning/BarcodeScanner.tsx`,
`config/typescript/scandit-6.2b.tsconfig.json`, and three tests under `tests/scanning-6.2b/`.
**Fix.** Corrected the import, added the literal assertion, removed the stale start option, added the
environment declarations to the project, and narrowed the three tests to what they are meant to assert.
**Test added.** None; the corrected tests are the coverage.
**Certification result.** Strict TypeScript PASS with `skipLibCheck: false`; the delivered suite 29/29.

---

## CR-6.2B-03 — Two boundary false positives in the delivered package

**Finding.** The 6.2B boundary check failed on two package files as delivered.
**Root cause.** A documentation comment contained a forbidden business-token string, and the capture-policy
type name contains an advanced-mode substring although it is not that mode.
**Affected files.** `src/lib/scanning/capture/BarcodeDecodeObservation.ts`,
`scripts/scandit/verify-domain6-2b-boundary.mjs`.
**Fix.** Reworded the comment. Added a single documented identifier exception for the capture-policy type
name, which the next slice imports by that exact name. Nothing else in the rule was relaxed.
**Test added.** None; a temporary probe confirmed that the real advanced-mode identifiers still fail the check.
**Certification result.** Boundary check PASS; advanced-mode detection still fires on real usage.

---

## CR-6.2B-04 — Capture must not be live from camera start

**Finding.** Capture was active from the moment the camera started. A barcode already in view could decode
before the session was ready, which produced an illegal state transition and failed the Start; and the SDK
emitted its own beep and vibration although the capture policy disables both.
**Root cause.** The SDK creates `BarcodeCapture` enabled and carrying its own success feedback, and attaches
it to the context immediately. The package used the returned mode as delivered.
**Affected files.** `src/lib/scanning/providers/scandit/scanditBarcodeCapture.ts`,
`src/lib/scanning/providers/scandit/ScanditBarcodeCaptureController.ts`.
**Fix.** The mode is created disabled and the SDK success feedback is cleared, so the capture policy is the
only feedback authority. A decode from a previous session, or from any phase other than CAPTURING, is
ignored and its mode is disabled.
**Test added.** `captureLifecycle`: "does not decode a barcode that is already visible while the camera
starts", "clears the SDK feedback and emits nothing when the policy disables feedback" and "rejects a decode
that arrives from a previous session".
**Certification result.** PASS. Both tests fail against the code as delivered.

---

## CR-6.2B-05 — A retry must release the previous attempt

**Finding.** After a capture timeout or a camera failure, the next Start could build a second session on top
of the first: a second capture mode, a second view on the same element, and in some paths a camera that was
never stopped.
**Root cause.** Start skipped its own teardown for the four error phases.
**Affected files.** `src/lib/scanning/providers/scandit/ScanditBarcodeCaptureController.ts`.
**Fix.** Every phase except IDLE and STOPPED is torn down before a restart.
**Test added.** `captureLifecycle`: "releases the timed-out attempt before the next Start" and "recovers on
the next Start after a camera failure".
**Certification result.** PASS. The timeout test fails against the code as delivered.

---

## CR-6.2B-06 — Leaving the page during startup must cancel the startup

**Finding.** If the operator left the scanner page while Start was still running, the camera stayed on and
the view and listeners were never released.
**Root cause.** Session ownership was recorded only after Start resolved, and the unmount handler read that
flag synchronously.
**Affected files.** `src/hooks/useBarcodeScanner.ts`.
**Fix.** Ownership is claimed before the first asynchronous step, a release flag is re-checked after each
step, and the unmount release is queued behind the pending start so it always runs after it.
**Test added.** `scannerHookLifecycle`: "releases the session when the page is left while Start is still
running" and "does not start anything when the page is left before the queued start runs".
**Certification result.** PASS. Both tests fail against the code as delivered.

---

## CR-6.2B-07 — Background and foreground must not mask a failure

**Finding.** A scanner in a failed or blocked state could return as READY after the application was
backgrounded and brought forward again.
**Root cause.** Suspension patched the status to PAUSED from any phase, bypassing the state machine, and
resume set permission GRANTED and phase READY without a camera.
**Affected files.** `src/lib/scanning/providers/scandit/ScanditBarcodeCaptureController.ts`.
**Fix.** A failed or blocked scanner is neither suspended nor resumed. READY is reached again only through a
successful restart.
**Test added.** `captureLifecycle`: "does not turn a failed scanner into READY through background and resume".
**Certification result.** PASS. The test fails against the code as delivered.

---

## CR-6.2B-08 — A camera or runtime status code must never read as READY

**Finding.** A Scandit camera runtime error, and a licence rejection, could be published as a healthy
runtime when the SDK reported the context as valid.
**Root cause.** The status assessment returned SUCCESS whenever the reported validity was true, before it
looked at the status code.
**Affected files.** `src/lib/scanning/providers/scandit/scanditContextStatusMapper.ts`.
**Fix.** A recognised failure code is authoritative. The reported validity is only a fallback for codes the
mapping does not recognise, so the runtime surfaces DEGRADED, BLOCKED, FAILED or RECOVERING instead of READY.
**Test added.** `runtimeErrorMapping`, three cases including a healthy context that must still read READY.
**Certification result.** PASS. Two of the three fail against the code as delivered.

---

## CR-6.2B-09 — Raw provider exceptions must not cross the capture boundary

**Finding.** Capture errors retained the raw SDK or DOM exception, cleanup records copied raw exception
messages, and the diagnostic surface turned every lifecycle failure into an unhandled rejection that carried
them to the console.
**Root cause.** The capture error type stored the cause unchanged, and the surface called the lifecycle
operations without handling rejection.
**Affected files.** `src/lib/scanning/capture/BarcodeCaptureError.ts`,
`src/lib/scanning/providers/scandit/ScanditBarcodeCaptureController.ts`,
`src/components/scanning/BarcodeScanner.tsx`.
**Fix.** The cause and every cleanup message pass through the redacting sanitizer already used by the runtime
slice, which keeps a short validated name and a redacted message. The code, message, retryability and
cleanup steps are unchanged, so the diagnostic value is kept. Lifecycle rejections on the surface are
absorbed and reported through the capture status.
**Test added.** `captureLifecycle`: "keeps raw SDK exceptions out of the capture error and the cleanup record",
using a message that contains a URL and a credential-shaped value.
**Certification result.** PASS. The test fails against the code as delivered.

---

## CR-6.2B-10 — A readable status surface for the device test

**Finding.** A licence, domain or runtime problem looked like "nothing happens" on the device, so the
certification points that depend on reading the runtime state could not be checked.
**Root cause.** The diagnostic surface showed the capture badge only.
**Affected files.** `src/components/scanning/ScannerRuntimeDiagnostics.tsx` (new),
`src/components/scanning/BarcodeScanner.tsx`, `src/hooks/useBarcodeScanner.ts`.
**Fix.** A read-only status section that reports runtime state, blocking reason, provider status code and
category, camera state, capture state, capture status code, SDK and runtime asset version, and the active
capture profile. It never renders the licence key, a raw SDK error, a stack trace, a configuration value or
a raw SDK object.
**Test added.** `diagnosticStatusSurface`, two cases including the state before the runtime is available.
**Certification result.** PASS. The file cannot even load against the code as delivered.

---

## CR-6.2B-11 — The protected-feature rule never fired in this repository

**Finding.** The "no warehouse business feature changed" rule could never match, so it protected nothing.
**Root cause.** The rule compared application-relative paths with the repository-relative paths that Git
reports, and the application is nested inside the repository.
**Affected files.** `scripts/scandit/verify-domain6-2b-boundary.mjs`.
**Fix.** The application prefix is removed before the comparison. The reported path stays repository-relative
and the rule itself is unchanged. The SQL rule already covered the whole repository and still does.
**Test added.** `protectedFeatureBoundary`, one positive and one negative case, both running the real script
against a disposable repository with the same nesting.
**Certification result.** PASS. A probe confirms that the same protected-feature change passed before the fix
and fails after it.

---

## CR-6.2B-12 — Install the 6.2B certification workflow

**Finding.** The delivered workflow template assumed the application was the repository root.
**Root cause.** Template written against the package layout.
**Affected files.** `.github/workflows/domain6-2b-scandit-capture-certification.yml` (new).
**Fix.** Paths, working directory, dependency cache and job name adapted. The workflow has no path filter,
because a path-filtered workflow never reports a result on pull requests that do not touch those paths and
therefore cannot serve as a required check.
**Test added.** Not applicable.
**Certification result.** The workflow runs the same certification chain that passes locally.

---

## CR-6.2B-13 — Tests that exercise the shipped lifecycle

**Finding.** The delivered suite tests contracts and models. It never loads the controller, the hook, the
camera or the capture listener, so none of the lifecycle behaviour above could be proved or defended
against regression.
**Root cause.** The suite was written around contract objects rather than the implementation.
**Affected files.** `tests/scanning-6.2b/support/scanditSdkFake.ts` (new) and four new test files.
**Fix.** A fake Scandit SDK built from the real 8.5.3 type definitions and observed behaviour: the capture
mode is created enabled and carries the SDK's own success feedback, the camera is driven through its state
API, and decoded barcodes reach the registered listener. The real controller and hook run against it.
**Test added.** 16 tests across `captureLifecycle`, `scannerHookLifecycle`, `runtimeErrorMapping` and
`diagnosticStatusSurface`.
**Certification result.** 6.2B suite 47/47. Against the code as delivered, 12 of the 16 fail.
