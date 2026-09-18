# Domain 6.2A — Certification Findings

Code reviewed for F-01 to F-05: the first local 6.2A commit `9653cc3` (never pushed; the same code as
`090f3a8` without CR-6.2A-05 and CR-6.2A-06). Line numbers and code quotes in F-01, F-02 and F-05
refer to that version, before the fixes.
Fixes committed in: `090f3a8eb192faea26c79b7688d346d60bbad03e` (the 6.2A code commit)
Scandit Web SDK: 8.5.2 at review time. The project moved to 8.5.3 on 2026-09-18 (CR-6.2A-08). All
TypeScript declaration files are identical between the two versions. In the core package, only the
version string, `package.json` and three internal UI button modules changed, so the core code behind
F-01, F-03 and F-04 (loading status, context status, the camera-access-error handler) is the same.
The findings are unchanged.

These findings come from reviewing the merged 6.2A source against the **real** Scandit 8.5.2
type definitions and shipped JavaScript, not against the test mocks. They were found after
the first `scandit:certify` run passed, because the tests used mocks that did not match the real
SDK. F-06 and F-07 came from our follow-up review of the F-01/F-02 fixes.

Fixes were applied only after a TCDS decision.

| ID | Severity | Finding | Status |
|---|---|---|---|
| F-01 | High | Loading-progress subscription is never removed | **Resolved** — CR-6.2A-05, approved 2026-09-15 |
| F-02 | Medium | Raw Scandit exception reachable through `ScannerProviderError.cause` | **Resolved** — CR-6.2A-06, TCDS decision "sanitize" |
| F-03 | Medium, 6.2B scope | Camera access errors arrive with `isValid: true` and are classed as success | Open — before 6.2B |
| F-04 | Low, 6.2B scope | Success status code not confirmed against the shipped SDK | Moved to 6.2B (with point 14) |
| F-05 | Low | Test mock does not match the real Scandit loading API | **Resolved** — part of CR-6.2A-05 |
| F-06 | Low | `ContextStatus` messages reach `ScannerProviderError.message` with light redaction only | **Accepted for 6.2A** — TCDS, 2026-09-16 |
| F-07 | Medium, 6.2B scope | 6.2B keeps raw errors in `BarcodeCaptureError.cause` | Open — before 6.2B |

---

## F-01 — Loading-progress subscription is never removed

**Real Scandit 8.5.2 API** (`@scandit/web-datacapture-core/build/js/LoadingStatus-*.d.ts`):

```ts
declare class LoadingStatus {
  subscribe(subscriber: LoadingStatusSubscriber): void;
  unsubscribe(subscriber: LoadingStatusSubscriber): void;
}
```

`subscribe` returns nothing. Removal needs a separate `unsubscribe(subscriber)` call with the
same function.

**6.2A code before the fix** (`src/lib/scanning/providers/scandit/scanditLoadingObserver.ts`):

```ts
const subscription = loadingStatus.subscribe((info: ProgressInfo) => { ... });
return () => {
  const maybe = subscription as unknown as { unsubscribe?: () => void };
  maybe?.unsubscribe?.();
};
```

`subscription` is always `undefined`, so the returned cleanup does nothing.

**Impact.** `ScanditScannerProvider` calls this cleanup in the `finally` block of initialization
and again in `dispose()`. Both calls are no-ops. The subscriber stays registered on Scandit's
global `loadingStatus` object for the life of the page. Every new provider initialization adds
another one. A stale subscriber keeps a reference to its provider and may still call
`setStatus` on a disposed provider if loading progress is reported again.

**Why tests did not catch it.** See F-05.

**Checklist item affected:** "Loading subscription is removed during completion/disposal."

**Resolved in `090f3a8` (CR-6.2A-05).** Approved by TCDS on 2026-09-15. The observer
now keeps its subscriber and removes it with `loadingStatus.unsubscribe(subscriber)`.
`ScanditScannerProvider` subscribes inside the `try` block, so the `finally` always removes it, even
when a runtime listener throws. The mock matches the real `LoadingStatus`. Five tests prove
removal and no stacking across re-initialization, failure, retry, and a throwing listener. Details
and mutation checks are in CR-6.2A-05.

---

## F-02 — Raw Scandit exception reachable through `ScannerProviderError.cause`

`ScannerProviderError` exposed `public readonly cause?: unknown`
(`src/lib/scanning/contracts/ScannerProviderError.ts`, line 40).

The raw error thrown by Scandit was attached as `cause` in:

- `scanditErrorCatalog.ts` — `mapScanditError`, line 41
- `ScanditScannerProvider.ts` — lines 96, 130 and 291

The public `message` is generic and safe. But the original exception object, with its original
unredacted message, travels with the error. Redaction in `scanditContextStatusMapper.ts` applies
only to `ContextStatus` messages, not to thrown exceptions.

Nothing in 6.2A reads `.cause` today. Any consumer that logs the error, for example
`console.error(error)`, will print the cause chain in modern browsers.

**Checklist item affected:** "Raw Scandit exceptions do not cross the provider boundary."

**Resolved in `090f3a8` (CR-6.2A-06).** TCDS decided on 2026-09-15 to sanitize it,
keeping only a redacted name and short message. `ScannerProviderError` now stores only a frozen, non-writable
`{ name, message }`, with the message redacted and capped at 160 characters. The exact redaction
rule is in CR-6.2A-06. The fix sits in the provider-neutral contract, so every call site is
covered, including the 6.2B provider.

---

## F-03 — Camera access errors are classed as success (6.2B scope)

**Shipped Scandit 8.5.2 JavaScript** (`@scandit/web-datacapture-core/build/js`): the camera-access-error
handler notifies context listeners with a `ContextStatus` whose `code` is `33794` and whose `isValid`
is `true`.

**6.2A mapper** (`scanditContextStatusMapper.ts`, line 46):

```ts
if (status.isValid || code === 1) { return { category: 'SUCCESS', phase: 'READY', ... }; }
```

This check runs before the dedicated `code === 33794 → CAMERA_RUNTIME_ERROR` branch on line 188,
so that branch can never be reached for this event. The provider would move to `READY`.

**Scope.** 6.2A never creates a camera, so this event cannot occur inside 6.2A. The same mapper
and provider carry into 6.2B, where it becomes live.

**Recommendation:** resolve before 6.2B certification — check known error codes before trusting
`isValid`.

---

## F-04 — Success status code not confirmed against the shipped SDK

`ContextStatus.fromJSON` copies `code`, `message` and `isValid` from the SDK without a fixed
success value. No literal success code was found in the shipped JavaScript. The mapper treats
`isValid || code === 1` as success, and the recovery test uses `code: 1`.

Given F-03 shows `isValid: true` on an error, success detection should be confirmed on a real
device during the browser runtime diagnostic. TCDS moved that diagnostic (certification point 14)
to the consuming UI slice, 6.2B, on 2026-09-16, so F-04 is confirmed there.

---

## F-05 — Test mock does not match the real Scandit loading API

`tests/scanning/ScanditScannerProvider.test.ts`, lines 35 to 37 (before the fix):

```ts
loadingStatus: {
  subscribe: vi.fn(() => ({ unsubscribe: vi.fn() })),
},
```

The real SDK returns `void` from `subscribe` and has a separate `unsubscribe` method. Because
the mock used a different return shape from the SDK, the test passed while the real cleanup did
nothing.

**Resolved in `090f3a8`** as part of CR-6.2A-05. The loading mock keeps subscribers in a `Set`,
`subscribe` and `unsubscribe` return `void`, and removal needs the same function, exactly like the
shipped SDK. Other Scandit mocks in the tests remain simplified stand-ins.

---

## F-06 — `ContextStatus` messages reach `ScannerProviderError.message` with light redaction only

Found by our follow-up review of the F-02 fix. Not changed: it is outside the F-02 scope, which
covered `cause`.

`scanditContextStatusMapper.ts` `safeMessage()` trims the Scandit `ContextStatus.message`,
redacts only `license key = <value>` shapes, and cuts it to 1,000 characters. The result is used
as `assessment.sanitizedMessage`. It becomes the top-level `ScannerProviderError.message` in
`errorFromContextAssessment` and the status `message` in `ScanditScannerProvider`. It does not
pass through the new F-02 redactor.

**Severity:** low. Scandit context status messages are short SDK texts. But the path does not
follow the no-raw-external-payloads rule as strictly as `cause` now does.

**Proposed fix (not applied):** export the F-02 redactor from `ScannerProviderError.ts` and use
it inside `safeMessage()`. One small change in the mapper, which 6.2B and 6.2C do not ship.

**TCDS decision (2026-09-16):** accepted for 6.2A without a code change and documented here; to be
revisited only if QA raises it. Kept as-is.

---

## F-07 — 6.2B keeps raw errors in `BarcodeCaptureError.cause` (6.2B scope)

Found by the same review. The 6.2B overlay's `src/lib/scanning/capture/BarcodeCaptureError.ts`
declares `cause?: unknown` and stores the raw error, and its cleanup-failure records copy the raw
`error.message`. Once 6.2B is merged, raw Scandit and camera errors will again travel with an
error object, against the F-02 rule.

**Recommendation:** decide before 6.2B certification whether the F-02 rule applies to 6.2B. If it
does, reuse `sanitizeProviderErrorCause` in `BarcodeCaptureError`. That is a small change in
one 6.2B file, applied inside the 6.2B commit.

---

## Scandit 8.5.3 and 6.2B (2026-09-18)

On 2026-09-18 TCDS asked us to document which 6.2B APIs or types depend on 8.5.3. **Result: no 6.2B API or type requires
8.5.3.** The requirement comes from the 6.2B package's version gate, not from its code.

- **Symbols 6.2B uses.** From `@scandit/web-datacapture-core`: `Camera`, `CameraPosition`,
  `DataCaptureContext`, `DataCaptureView`, `FrameSourceListener`, `FrameSourceState`,
  `MarginsWithUnit`, `MeasureUnit`, `NumberWithUnit`, `PointWithUnit`, `SelectionMode`, `TorchState`.
  From `@scandit/web-datacapture-barcode`: `BarcodeCapture`, `BarcodeCaptureListener`,
  `BarcodeCaptureSession`, `BarcodeCaptureSettings`, `Symbology`.
- **Type declarations.** All 571 `.d.ts` files in both packages are byte-identical between 8.5.2 and
  8.5.3, so each of these symbols has the same declaration in both versions.
- **Files that changed (other than type declarations).** Barcode package: the engine (4 `sdc-lib`
  JS and 4 WASM files), the worker file (renamed `barcode-worker-8.5.3.js`), the worker and loader
  JavaScript (`moduleLoader.js`, `worker/BarcodeCaptureWorkerManager.js`,
  `worker/dataCaptureEngine.js`, and one hashed `BarcodeCaptureWorkerManager-*.js` chunk with a new
  name), and `package.json`. Core package: the SDK version string, `package.json`, and three
  internal UI button modules (camera switch, camera field-of-view switch, torch switch). 6.2B does
  not add Scandit's built-in UI controls. License files are unchanged.
- **Scandit release notes.** 8.5.3 (released 2026-08-18) lists one behaviour change: enhanced
  low-resolution QR scanning is disabled for MatrixScan modes. 6.2B uses `BarcodeCapture` only, and
  its boundary script forbids MatrixScan.
- **Where the requirement is.** `scripts/scandit/verify-domain6-2b-sdk-version.mjs` expects exactly
  `8.5.3` in `package.json`, `package-lock.json` and the installed packages, and
  `scandit:capture:certify` runs it. `PACKAGE_MANIFEST.json` sets `scanditWebTarget` to `8.5.3`.
  6.2C inherits the gate, because `scandit:policy:certify` runs `scandit:capture:certify` first.
  `docs/PRODUCTION_HARDENING_FINAL.md` also requires both packages at exactly 8.5.3, and the
  README's revision note pins the SDK contract to 8.5.3. Only the README header (line 5) still
  says 8.5.2.

So 8.5.3 is a version-policy requirement of the 6.2B package, not an API dependency. The 6.2B gate
looks for exactly 8.5.3 in `package.json`, `package-lock.json` and the installed packages; all three
were confirmed on 2026-09-18 with no code change. The gate itself runs when 6.2B is merged.

---

## 6.2B prerequisites

- **Re-apply the F-01 provider change.** 6.2B replaces `ScanditScannerProvider.ts`, and its copy
  subscribes to loading progress outside the `try` block (6.2B lines 183–204). This is the same
  throwing-listener leak path that CR-6.2A-05 closed in 6.2A.
- **6.2B package type errors.** A trial type check of the 6.2B package reported 8 diagnostics.
  The same 8 appear with the old and the new `ScannerProviderError`, so they are not caused by the
  F-02 change. Run `scandit:capture:typecheck` after merging 6.2B and report the real
  output.
- **CI templates.** The 6.2A workflow is installed unchanged (CR-6.2A-07). Its path filter leaves
  out `tests/**`. The 6.2B workflow uses root-relative paths and no `working-directory`, so from
  the repository root it would not trigger and would run npm in the wrong folder. It needs
  adjusting before it is installed.
- **Browser diagnostic and F-04.** Point 14 moved to 6.2B (TCDS, 2026-09-16). Confirm the Scandit
  success status code on a real device there.

---

## Differences from the delivered 6.2A package manifest

`PACKAGE_MANIFEST.json` in the delivered 6.2A package lists a sha256 for each file. These
committed files intentionally differ from it:

| File | Why |
|---|---|
| `scripts/scandit/sync-scandit-runtime.mjs` | CR-6.2A-01 |
| `src/lib/scanning/providers/scandit/scanditLoadingObserver.ts` | CR-6.2A-02 and CR-6.2A-05 |
| `src/lib/scanning/providers/scandit/ScanditScannerProvider.ts` | CR-6.2A-05 |
| `src/lib/scanning/contracts/ScannerProviderError.ts` | CR-6.2A-06 |
| `tests/scanning/ScanditScannerProvider.test.ts` | CR-6.2A-05 and CR-6.2A-06 |
| `tests/scanning/scanditErrorCatalog.test.ts` | CR-6.2A-06 |
| `tests/scanning/scannerProviderError.test.ts` (new) | CR-6.2A-06 |
| `src/lib/scanning/providers/scandit/scanditVersion.ts` | CR-6.2A-08 (regenerated for 8.5.3) |
| `docs/SCANDIT_VERSION_APPROVAL.md` | CR-6.2A-08 |

No script verifies source files against the package manifest, so these differences do not
affect any certification gate.

---

## Dependency vulnerabilities (`npm audit`)

6.2A introduced no advisory into the production dependency set (re-checked on Scandit 8.5.3, 2026-09-18). It introduced one moderate,
development-only advisory (`vitest` / `@vitest/mocker`). Details: `DEPENDENCY_DISCLOSURE.md`.
