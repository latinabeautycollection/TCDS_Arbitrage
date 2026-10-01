# Domain 6.2C — Certification Findings

What we found while integrating and certifying the delivered policy package, and how each
finding stands now.

The package itself integrated cleanly. Unlike the capture slice, the first run needed no
correction to the adapter: the policy manifest generated, the strict typecheck was clean
and the delivered suite passed 21 of 21. Every finding below is about the verification
around the adapter, not about the adapter.

---

## C-1 — The boundary check's strongest rules were inert (resolved)

The check compares ownership prefixes written against the application root with the paths
Git reports from the repository root. Because the application is nested here, only the
`.sql` rule could ever match.

**Proof, before the correction.** A disposable repository reproducing the nested layout,
with a commit that changes `src/lib/scanning/capture/captureStateMachine.ts`,
`src/lib/scanning/providers/scandit/ScanditBarcodeCaptureController.ts` and
`src/features/receiving/ReceivingWorkflow.ts`:

```
Domain 6.2C boundary verification PASSED against baseline <baseline>
exit=0
```

**After the correction, the same repository and the same commit:**

```
Domain 6.2C boundary verification FAILED
 - .../src/features/receiving/ReceivingWorkflow.ts: 6.2C may not modify 6.2B implementation or a Domain 6 business feature.
 - .../src/lib/scanning/capture/captureStateMachine.ts: 6.2C may not modify 6.2B implementation or a Domain 6 business feature.
 - .../src/lib/scanning/providers/scandit/ScanditBarcodeCaptureController.ts: 6.2C may not modify 6.2B implementation or a Domain 6 business feature.
exit=1
```

Resolved by CR-6.2C-01 and covered by CR-6.2C-02. The same defect was found and corrected
the same way in the capture slice, so both checks now share identical normalization code.

---

## C-2 — The delivered CI workflow could not pass (resolved)

The policy chain runs the capture chain first, which needs the capture baseline; the
delivered workflow set only the policy baseline. It also assumed the application sits at
the repository root and did not generate the Scandit runtime, which is not committed.

Resolved by CR-6.2C-03. Both baselines are now supplied and validated, and the run fails
closed if either is missing, malformed or unreachable.

---

## C-3 — The policy diagnostic card cannot be wired by this slice (resolved by decision)

The component is delivered but unused, and the page that would render it is outside this
slice's ownership allowlist. It stays unwired, carries the reserved marker, and display is
left to a later slice. Resolved by CR-6.2C-04.

---

## C-4 — The generated policy manifest (resolved by decision)

It is a build product, and a committed copy would have nothing verifying it. It is
excluded from version control, generated fresh by every certification run, verified
against the policy sources and retained as a build artifact. Resolved by CR-6.2C-05.

---

## C-5 — Two checklist items had no automated evidence (resolved)

The authoritative asset-identity rule and the "envelope cannot widen configuration" rule
were implemented but untested. Both are now covered. Resolved by CR-6.2C-06.

---

## Carried forward, not a 6.2C matter

- The capture slice's runtime-authorization defect — capture kept the camera while the
  runtime withdrew authorization — was corrected before this slice was integrated, so the
  policy slice freezes a capture implementation that already releases the camera.
- Device evidence for the capture slice is complete and accepted. No new device evidence is
  reported here: this slice is deterministic and is verified entirely by the suites, and
  device verification is paused until the scanning licence in the deployed build is
  renewed.
