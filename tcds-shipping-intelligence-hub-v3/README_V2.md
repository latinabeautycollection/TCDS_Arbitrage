# TCDS Shipping Intelligence Hub v2

This is a fail-closed rewrite of the decision-critical portion of the hub.

## Merge order

1. Keep v1 migration `502` intact.
2. Apply `503_domain3_shipping_intelligence_hub_v2.sql`.
3. Merge v2 TypeScript files.
4. Wire existing rate/address engines only through adapters.
5. Run the v2 preflight.
6. Run critical tests.
7. Deploy in `OBSERVE_ONLY`, then `SHADOW`.
8. Do not enable blocking until replay certification succeeds.

## Safety invariant

- Zone-anchor quotes protect presale price.
- Actual-destination quotes select the carrier.
- These datasets are never interchangeable.

## Accuracy posture

The hub refuses to produce an enforceable carrier decision when:
- the actual destination is absent;
- the address is not marketplace-verified and delivery-point validated;
- rate data is stale or partial;
- protection capabilities are unknown;
- package weight or dimensions are unverified at label authorization;
- no service meets the configured delivery commitment.
