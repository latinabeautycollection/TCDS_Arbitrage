# TCDS Domain 10 — Slice 10A: Authoritative PostgreSQL Contract

Green Tier 1 target contract for Notifications & Operations.

Human channels are **Microsoft 365 Email via Microsoft Graph** and **SMS via Telnyx**. Database events are internal evidence/control, not a third human channel.

## Owns
Immutable operational events; policy/version governance; recipients/audiences/authorization; template/version governance; notification plans; per-recipient deliveries; outbox/leases; attempts; provider receipts; dead letters; incidents/acknowledgements/escalations; SMS consent; suppression; provider health; rate limits; fail-closed kill switches; hash-chained audit evidence.

## Key guarantees
- DB-enforced event and delivery idempotency.
- Frozen policy/template versions are immutable.
- Provider acceptance is not final delivery.
- Expired SENDING leases become `UNKNOWN_PROVIDER_OUTCOME`, not blind retries.
- `FOR UPDATE ... SKIP LOCKED` protects concurrent workers.
- Telnyx consent events are append-only and duplicate/out-of-order safe.
- TCDS Telnyx number is `+15715160419`.
- EMAIL and SMS start disabled with emergency stop enabled.
- Audit is append-only and hash chained.

## Certification
```bash
export DATABASE_URL='postgresql://...disposable_cert_db...'
./scripts/certify-domain10-10a.sh
```

Do not enable production channels until Microsoft Graph/Exchange and Telnyx live certifications are complete.
