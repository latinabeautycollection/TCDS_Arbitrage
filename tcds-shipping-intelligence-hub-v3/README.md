# TCDS Shipping Intelligence Hub — Phase 3

This package is a **profit-first decision overlay** for the existing TCDS shipping domain. It does not replace carrier clients, label creation, tracking, webhooks, or carrier-specific repositories.

## Non-collision contract

The hub may import only:
- its own contracts/models/policies,
- `pg`, `pino`, and `zod`,
- adapters supplied by the operational shipping layer.

The operational shipping layer may call only `intelligenceHub/index.ts`.

## Core policies implemented

- Virginia-origin presale protection using California, Florida, and Wisconsin anchor quotes.
- Highest eligible anchor rate protects listed shipping economics.
- Contiguous U.S.: only services with a verified commitment of two business days or less.
- Alaska, Hawaii, Puerto Rico, U.S. Virgin Islands, Guam, and Canada: economic 5–7 business-day target.
- Signature outside the contiguous U.S.
- Insurance at $100+ using sale price as insured value.
- TCDS signature at $250+ and eBay-required signature at $750+ total order value.
- Restricted delivery at $1,000+.
- No PO boxes, CMRAs, private mailboxes, freight forwarders, or reshippers.
- No shipping-address changes after checkout; marketplace checkout address must be verified.
- Tamper evidence, serial capture, and digital weight audit for high-value orders.
- Shadow-first rollout with explicit enforcement modes.
- Deterministic evidence hashing and Postgres audit persistence.

## Installation into the live repo

Copy:

```text
src/domains/shipping/intelligenceHub
database/migrations/502_domain3_shipping_intelligence_hub.sql
scripts/preflight-domain3-shipping-intelligence.sh
```

Do not copy the package.json or tsconfig.json over the live repository; they are included only to compile this package independently.

## Rollout

1. Apply migration.
2. Keep all feature flags false.
3. Wire existing rate and destination engines through adapters.
4. Run `OBSERVE_ONLY`.
5. Move to `SHADOW`.
6. Compare recommendations to production outcomes.
7. Enable non-blocking requirements.
8. Enable blocking only after policy, regression, and replay certification.

## Important legal/platform note

Seller-facing policy language such as “liability transfers on delivered scan” does not override marketplace, payment-network, consumer-protection, or carrier rules. The hub preserves evidence and applies platform protection requirements; final policy wording should be reviewed by counsel and aligned to current eBay rules.
