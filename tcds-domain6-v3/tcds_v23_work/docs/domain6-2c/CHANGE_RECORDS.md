# Domain 6.2C — Change Records

Every change we made to the delivered 6.2C package, in the format requested for review:
finding, root cause, affected files, fix, test added, certification result.

All other package files are byte-identical to the delivery: 23 of the 26 overlaid files
are unchanged. The two source corrections below are the only changes to delivered code.
The third changed file is the delivered certification checklist, which we filled in with
the evidence for each item rather than shipping it blank.

---

## CR-6.2C-01 — The boundary check's strongest rules could never fire

**Finding.** `verify-domain6-2c-boundary.mjs` passed a commit that modified
`src/lib/scanning/capture/`, `src/lib/scanning/providers/scandit/` and
`src/features/receiving/` — the three things its rules exist to block.
**Root cause.** The ownership rules are written against the application root, while Git
reports changed paths from the repository root. In this repository the application is
nested, so every reported path carries a prefix and no prefix rule could ever match.
Only the `.sql` suffix rule still worked.
**Affected files.** `scripts/scandit/verify-domain6-2c-boundary.mjs`.
**Fix.** The application prefix is derived from Git and removed before every prefix
comparison, exactly as the capture slice already does. No rule is weakened, nothing is
added to the allowlist, and the reported path is unchanged, so failure messages still
name the file as Git reports it. The normalization code is identical to the capture
slice's; only the comment differs, because this slice has three prefix rules instead of
one.
**Test added.** `tests/scanning-6.2c/policyBoundaryGate.test.ts`, six cases, described in
CR-6.2C-02. A before-and-after probe against a disposable repository is recorded in the
certification findings.
**Certification result.** Boundary check PASS against the baseline; the same script now
fails with exit 1 on each forbidden change.

---

## CR-6.2C-02 — No test proved the boundary rules were effective

**Finding.** The delivered suite asserts the policy sources contain no forbidden token,
but nothing executed the certification script itself, so a dead rule was invisible.
**Root cause.** The check is a script, not a module, and had no test harness.
**Affected files.** `tests/scanning-6.2c/policyBoundaryGate.test.ts` (new).
**Fix.** The real script is executed against a disposable repository that reproduces the
nested layout. Six cases: an allowed policy-only change passes; a capture change, a
Scandit provider change and a protected Domain 6 business-feature change each fail with
the ownership message; a source change outside the allowlist fails with the allowlist
message; a missing baseline fails closed.
**Test added.** The six cases above.
**Certification result.** 6/6 pass. Each negative case was also confirmed to pass
against the unmodified script, which is what proves the correction changed behaviour.

---

## CR-6.2C-03 — The delivered CI workflow could not pass as written

**Finding.** The policy chain begins by running the capture chain, which requires
`DOMAIN6_2B_BASELINE_SHA`. The delivered workflow sets only the policy baseline, so the
run would have failed closed at the capture boundary check.
**Root cause.** The template was written for a repository where the application sits at
the root and where the capture slice is already certified out of band.
**Affected files.** `.github/workflows/domain6-2c-scandit-policy-certification.yml`
(new, adapted); the delivered template is committed unchanged at
`config/ci/domain6-2c-scandit-certification.yml` for reference.
**Fix.** The workflow supplies both baselines and refuses to run when either one is
missing, malformed or unreachable in the checkout. The working directory and the
dependency cache path point at the application. The generated Scandit runtime is
produced by `scandit:prepare` before the chain, because it is not committed and a clean
checkout cannot otherwise satisfy the runtime and parity checks. The path filter is
removed so the workflow can be a required check: a path-filtered workflow never reports
a result on pull requests that do not touch those paths. The generated policy manifest
is then proved reproducible, matched against the policy sources and retained as a build
artifact.
**Test added.** None; the workflow is itself the check. Every step was executed locally
in the production layout with both baselines exported.
**Certification result.** Full chain exit 0, and `npm run check` and `npm run verify`
both exit 0.

---

## CR-6.2C-04 — The policy diagnostic card ships unused

**Finding.** `CapturePolicyDiagnosticCard.tsx` is delivered with the package and nothing
imports it. Wiring it would change a diagnostic page that is outside this slice's
ownership allowlist, so the slice's own boundary check would reject the change.
**Root cause.** Display belongs to a later slice; the component is delivered early.
**Affected files.** `src/components/scanning/policy/CapturePolicyDiagnosticCard.tsx`.
**Fix.** The component is left unwired and carries the reserved marker agreed for it, so
a later reader does not mistake it for dead code, together with a short note explaining
why this slice cannot render it.
**Test added.** None; the boundary check already rejects a diagnostic-page change.
**Certification result.** Strict typecheck PASS; the component compiles and is excluded
from the entry bundle because nothing imports it.

---

## CR-6.2C-05 — The generated policy manifest is not committed

**Finding.** `scandit:policy:manifest` writes `domain6-2c-policy-manifest.json` into the
application root. Committing it would create a record that nothing verifies, so it could
drift from the policy sources silently.
**Root cause.** The file is a build product of the certification chain.
**Affected files.** `.gitignore`.
**Fix.** The file is excluded from version control and produced fresh by every
certification run. The workflow proves it is reproducible, matches every policy source by
SHA-256 and byte count, and records no source that no longer exists; it is then retained
as a build artifact of the run that produced it. If it is ever to be committed, a
stale-manifest verifier has to come first.
**Test added.** None; the verification runs in certification.
**Certification result.** Manifest generated twice byte-identically, verified against 11
policy sources.

---

## CR-6.2C-06 — Two checklist items had no automated evidence

**Finding.** The delivered certification checklist requires an authoritative scanner
asset identity and requires that the context envelope cannot widen Warehouse Control
configuration. Both rules are implemented, but no delivered test exercised either.
**Root cause.** Coverage gap in the delivered suite, not a defect in the adapter.
**Affected files.** `tests/scanning-6.2c/authoritativeConfigurationRules.test.ts` (new).
**Fix.** Four cases: a blank asset identity fails with `SCANNER_ASSET_ID_REQUIRED`; a
missing snapshot fails with `AUTHORITY_SNAPSHOT_REQUIRED`; the resolved policy carries
the authority evidence; and with an envelope that allows two symbologies and a profile
that configures one, only the configured one becomes effective, which is what proves the
envelope is a ceiling and never a source of capability.
**Test added.** The four cases above. No production file was touched.
**Certification result.** 4/4 pass; both checklist items are now PASS rather than
REVIEW.
