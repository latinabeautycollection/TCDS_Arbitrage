# Fortune 500 Review — TCDS Shipping Intelligence Hub

## Honest rating of v1

**4.8/10 overall.**

The architecture was directionally good, but v1 was not safe for production enforcement.

### Critical v1 defects corrected in v2

1. **Anchor quotes were used for carrier selection.**  
   California, Florida, and Wisconsin quotes are now used only for presale protection. Sold-order carrier selection uses a separate live quote request to the buyer's actual verified checkout destination.

2. **Carrier capabilities defaulted to true.**  
   Missing support for signature, adult signature, restricted delivery, or insurance now defaults to false.

3. **No stage-specific validation.**  
   Presale, sold-order, label authorization, and reconciliation now enforce different required data.

4. **Floating-point money.**  
   All core decision money uses integer cents.

5. **Partial/stale quote data could still allow a decision.**  
   Blocking mode now fails closed with `REQUOTE`.

6. **Disabled mode still called providers.**  
   Disabled mode now returns `BYPASS` without network or database calls.

7. **Third-party insurance was confused with carrier declared value.**  
   Insurance mechanism is explicit and carrier capability checks apply only when carrier declared value is selected.

8. **Non-deterministic evidence.**  
   Canonical JSON hashing, input hashes, idempotency keys, and evidence conflict detection are included.

9. **Weak persistence semantics.**  
   The v2 database function is idempotent, detects conflicting replays, writes an audit event, writes an outbox event, and revokes public execution.

10. **Reconciliation was a no-op.**  
    It now queues an idempotent reconciliation job through the existing TCDS queue.

## What no code can honestly guarantee

No shipping system can guarantee 99.99% “always right” decisions because carrier APIs, weather, scans, addresses, surcharges, and delivery operations contain uncertainty. A Fortune 500 design achieves reliability by:

- using current, timestamped data;
- rejecting stale or incomplete inputs;
- failing closed;
- maintaining human escalation;
- measuring predicted versus actual outcomes;
- using shadow and replay certification before enforcement;
- preserving deterministic evidence.

## Required before blocking production

- Map the adapters to the exact live TCDS provider types.
- Add official carrier service/capability matrices.
- Add holiday and pickup-cutoff calendars.
- Add weather/outage feeds.
- Add third-party insurance APIs and policy terms.
- Add actual carrier invoice reconciliation.
- Run at least 30–90 days in shadow mode.
- Establish minimum sample sizes by carrier/service/lane.
- Certify policy thresholds against current eBay rules.
- Load-test and chaos-test provider failures.
- Obtain legal review of customer-facing terms.
