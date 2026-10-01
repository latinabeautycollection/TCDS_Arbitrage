# Domain 6.2C — Traceability Matrix

Each rule this slice is responsible for, the file that implements it, and the automated
check that proves it.

| Rule | Implementation | Proof |
|---|---|---|
| An authoritative configuration snapshot is required | `capturePolicyValidator.ts` | `authoritativeConfigurationRules`: missing snapshot fails closed |
| The scanner profile must be bound to a Warehouse Control asset | `capturePolicyValidator.ts` | `authoritativeConfigurationRules`: blank asset identity fails closed |
| The profile timestamp must be a valid instant | `capturePolicyValidator.ts` | strict typecheck and the validator's own guard; no test case |
| Only camera scanner modes are accepted | `capturePolicyValidator.ts` | `failClosedAuthority`: a HID keyboard profile is rejected |
| Continuous scanning is rejected | `capturePolicyValidator.ts` | `failClosedAuthority` |
| Duplicate suppression must be a sane integer | `capturePolicyValidator.ts` | validator guard; bounds asserted by the conversion test |
| Milliseconds are converted to the capture contract's seconds | `capturePolicyResolver.ts` | `policyResolution`: 750 ms becomes 0.75 s |
| A configured symbology outside capture capability fails closed | `capturePolicyResolver.ts`, `warehouseControlSymbologyMapper.ts` | `failClosedAuthority`, `symbologyMapper` |
| A symbology disabled in the database cannot become effective | `capturePolicyResolver.ts` | `failClosedAuthority`: all rows disabled leaves no effective symbology |
| The context envelope can only narrow, never widen | `capturePolicyResolver.ts`, `capturePolicyEnvelopeRegistry.ts` | `authoritativeConfigurationRules`, `policyResolution` |
| Unknown configuration keys fail closed | `configurationExtension.ts` | `configurationEnvelope`: an over-wide scan area is rejected |
| Scan area and capture timeout stay inside the envelope | `capturePolicyValidator.ts` | `configurationEnvelope` |
| Automatic selection is restricted where the context forbids it | `capturePolicyValidator.ts` | `configurationEnvelope`: serial capture stays explicit |
| Feedback is a ceiling, not an instruction | `capturePolicyResolver.ts` | envelope feedback ceiling applied with a warning; `no6_2bOwnership` proves this slice never executes feedback |
| The execution policy carries complete lineage | `capturePolicyResolver.ts` | `policyResolution` asserts the whole lineage object |
| The execution policy carries no warehouse entity or outcome field | `capturePolicyResolver.ts` | `policyResolution` scans the serialized policy |
| This slice imports no Scandit and owns no capture object | policy sources | `no6_2bOwnership` and the boundary check's token scan |
| This slice modifies no capture or provider file | — | boundary check against the baseline; `policyBoundaryGate` |
| This slice modifies no protected Domain 6 business feature | — | boundary check; `policyBoundaryGate` |
| This slice adds no SQL | — | boundary check over every changed path |
| Certification fails closed without a valid baseline | `verify-domain6-2c-boundary.mjs` | `policyBoundaryGate`: absent baseline fails |
| The policy manifest describes the policy sources exactly | `generate-domain6-2c-policy-manifest.mjs` | generated twice byte-identically and matched against 11 sources in the workflow |

One rule is carried by code review alone: the profile timestamp guard has no dedicated
test case. Every other rule above is proved by an automated check that runs inside
`scandit:policy:certify`.
