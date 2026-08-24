# Domain 10F In-Depth Enterprise Review — Reviewed Final

The original 10F had a clean certification-only ownership model, but the
Telnyx/Microsoft 365/Exchange review found several gaps that prevented literal
Green Tier 1 certification.

## Material findings remediated

1. Audit certification verified hash-chain links but did not recompute each audit
   record hash from its canonical fields. The reviewed evaluator does both.

2. The schema fingerprint covered columns and selected function definitions but
   omitted constraints, triggers and indexes and used MD5 for inner function
   fingerprints. The reviewed fingerprint includes columns, constraints,
   non-internal triggers, indexes and SHA-256 function-definition hashes.

3. There was no automated invariant proving that a Graph delivery marked
   `DELIVERED` had verified Exchange evidence. Reviewed 10F requires
   `EXCHANGE_MESSAGE_TRACE` or `EXCHANGE_NDR_RECONCILIATION`.

4. Graph provider-acceptance certification did not independently prove the
   accepted attempt used HTTP 202. Reviewed 10F checks the attempt evidence.

5. There was no certification of SMS consent state at the actual Telnyx provider
   acceptance instant. Reviewed 10F reconstructs the latest consent action and
   requires OPT_IN.

6. Telnyx terminal carrier failures were not independently tied to verified
   `message.finalized` failure evidence. Reviewed 10F adds that invariant.

7. The original live attestation profile did not require the Microsoft 365
   Exchange RBAC mailbox scope, removal of unscoped Entra Mail.Send, certificate
   credential health, Exchange final-delivery reconciliation, Telnyx webhook
   signature verification, duplicate/out-of-order webhook handling, SMS
   START/STOP/HELP behavior, or an active 10DLC campaign. Profile version 2 now
   requires all of these.

8. Evidence hashes were verified from caller-supplied values but were not bound
   to all run/timestamp fields. Reviewed triggers DB-generate stronger hashes
   including run identity and evidence timestamps.

9. The run input/final hash did not include the frozen profile definition hash
   or a security fingerprint. Reviewed 10F binds both.

10. Database callers could bypass TypeScript's 31-day/future-window validation.
    Reviewed PostgreSQL enforces the limits itself.

## Final ownership

10F still only certifies. It has:
- no Graph client,
- no Telnyx client,
- no SMS consent mutation,
- no notification planner,
- no incident command,
- no assurance calculator ownership,
- no deployment authority,
- no persistent worker.

All provider configuration and business state remain owned by 10A–10E and the
existing Microsoft Graph/Telnyx provider subsystems.
