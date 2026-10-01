# Domain 6.2C Green Tier 1 Certification Checklist — Filled In (25 of 25)

Legend: **PASS** verified by an automated check that runs in certification ·
**REVIEW** verified by code review only.

One command reproduces every automated result:

```
export DOMAIN6_2B_BASELINE_SHA=<approved 6.2B baseline>
export DOMAIN6_2C_BASELINE_SHA=<commit before the 6.2C overlay>
npm run scandit:policy:certify
```

That single command certifies all three slices together: the 6.2A runtime chain, the
6.2B capture chain, then the 6.2C policy chain and the production build.

## Prerequisites

| | Item | Status | Evidence |
|---|---|---|---|
| ✅ | Certified 6.2A present | PASS | `scandit:certify` runs first inside the chain; 6.2A suite 54/54 |
| ✅ | Certified production-hardened 6.2B present | PASS | `scandit:capture:certify` runs next; 6.2B suite 58/58 |
| ✅ | `DOMAIN6_2C_BASELINE_SHA` is valid and available | PASS | the boundary check refuses a missing, malformed or unreachable baseline; `policyBoundaryGate` proves the absent-baseline case fails closed |

## Ownership and isolation

| | Item | Status | Evidence |
|---|---|---|---|
| ✅ | 6.2C changes no 6.2B implementation file | PASS | boundary check against the baseline; no capture, provider or scanner-hook file appears in the slice diff |
| ✅ | 6.2C changes no Domain 6 business feature | PASS | same check; all six protected feature directories are unchanged across the whole diff |
| ✅ | Zero SQL | PASS | the boundary check inspects every changed path; no `.sql` path exists in the diff |
| ✅ | Zero `@scandit` imports in 6.2C | PASS | `no6_2bOwnership` plus the forbidden-token scan in the boundary check |
| ✅ | Zero `DataCaptureView` / `BarcodeCaptureSettings` ownership in 6.2C | PASS | same test and scan |
| ✅ | Zero `AudioContext` / `navigator.vibrate` execution in 6.2C | PASS | same test and scan |

## Authority rules

| | Item | Status | Evidence |
|---|---|---|---|
| ✅ | Authoritative scanner asset ID required | PASS | `authoritativeConfigurationRules`: a blank asset identity fails with `SCANNER_ASSET_ID_REQUIRED`, and a missing snapshot with `AUTHORITY_SNAPSHOT_REQUIRED` |
| ✅ | HID keyboard configuration rejected for the camera path | PASS | `failClosedAuthority` |
| ✅ | Continuous scan configuration rejected | PASS | `failClosedAuthority`; 6.2B pauses capture after every decode |
| ✅ | Unsupported configured symbology fails closed | PASS | `failClosedAuthority`: a configured symbology outside 6.2B capability raises `CONFIGURED_SYMBOLOGY_UNSUPPORTED` |
| ✅ | Disabled database symbologies cannot become effective | PASS | `failClosedAuthority`: with every database row disabled the resolution fails with no effective symbologies |
| ✅ | Context envelope cannot widen Warehouse Control configuration | PASS | `authoritativeConfigurationRules`: the envelope allows two symbologies, the profile configures one, and only that one becomes effective |
| ✅ | Warehouse Control configuration cannot widen 6.2B capability | PASS | `symbologyMapper` returns null for an unmapped symbology; the resolver then fails closed |
| ✅ | `duplicate_suppression_ms` conversion test passes | PASS | `policyResolution`: 750 ms becomes 0.75 s |

## Output contract

| | Item | Status | Evidence |
|---|---|---|---|
| ✅ | Policy lineage includes registry version, context and revision | PASS | `policyResolution` asserts the complete lineage object |
| ✅ | No warehouse entity IDs in `BarcodeCaptureExecutionPolicy` | PASS | `policyResolution` scans the serialized policy for entity fields |
| ✅ | No warehouse outcome fields in `BarcodeCaptureExecutionPolicy` | PASS | same test, outcome fields |

## Verification

| | Item | Status | Evidence |
|---|---|---|---|
| ✅ | Tests pass | PASS | 6.2C suite 31/31 across 7 files; 6.2A 54/54; 6.2B 58/58 |
| ✅ | Typecheck passes | PASS | `scandit:policy:typecheck` with `skipLibCheck: false` |
| ✅ | Production build passes | PASS | `npm run build` inside the chain; the policy adapter adds no runtime weight to the entry chunk |
| ✅ | Existing Domain 6 check/verify remains green | PASS | `npm run check` and `npm run verify` both exit 0, unchanged by this slice |
| ✅ | Boundary rules are effective in this repository, not only in the package | PASS | `policyBoundaryGate` runs the real certification script against a disposable repository that reproduces the nested layout: an allowed policy change passes, and a capture change, a provider change, a protected business-feature change and an out-of-allowlist source change each fail |
