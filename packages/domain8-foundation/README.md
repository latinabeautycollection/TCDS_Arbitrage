# TCDS Domain 8 — Slice 8A.1.1 Authoritative Database Foundation Hardening

## Purpose

This package establishes the authoritative PostgreSQL contract for Domain 8 before cross-domain adapters or risk engines are implemented.

It creates:

- controlled status, reason, and control catalogs;
- versioned policy governance;
- versioned model governance and rollback;
- ten-gate risk threshold governance;
- tenant isolation with forced row-level security;
- idempotent command claims and replay;
- immutable domain events;
- transactional outbox delivery;
- append-only audit structures;
- contract-version registration;
- preflight, seed, smoke, certification, and rollback controls.

## Deliberate boundary

This package does **not** create foreign keys to Retail, ARB, Warehouse, Warehouse Control, Shipping, or Domain 7.

Those exact relationships belong in Slice 8B after this foundation is installed and certified. This prevents deployment failure when upstream schema names or key types differ between environments.

## Installation order

```bash
export DATABASE_URL='postgresql://...'

bash scripts/preflight-domain8-foundation.sh

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f database/migrations/801_domain8_return_defense_core.sql

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f database/migrations/802_domain8_policy_and_model_governance.sql

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f database/migrations/803_domain8_security_and_rls.sql

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f database/migrations/804_domain8_audit_outbox_and_idempotency.sql

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f database/migrations/805_domain8_foundation_indexes.sql

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f scripts/seed-domain8-policies.sql

bash scripts/smoke-domain8-foundation.sh
bash scripts/certify-domain8-foundation.sh
```

## Required application session context

Every tenant-scoped connection must set:

```sql
SET app.tenant_id = '<tenant UUID>';
SET app.actor_id = '<actor UUID>';
SET app.correlation_id = '<correlation UUID>';
```

Use `SET LOCAL` inside transactions or configure these values through a transaction wrapper. Do not place untrusted user input directly into `SET` statements.

## Runtime principles

1. Rules and database policy are authoritative.
2. Statistical or AI models cannot create a hard block by themselves.
3. Active policies and models are unique by governed scope.
4. Events and audit records are append-only.
5. Duplicate requests must claim an idempotency key before side effects.
6. Outbox publication is transactional with the domain event.
7. Application roles must not own Domain 8 objects.
8. Cross-domain source data is referenced, not copied.

## Rollback

Rollback is destructive:

```bash
psql "$DATABASE_URL" \
  -v domain8_confirm_rollback='DROP_DOMAIN8_8A1' \
  -f scripts/rollback-domain8-foundation.sql
```

Do not execute rollback after Slice 8B or later migrations have installed dependent objects.

## Next package

`Domain8_Slice8B_ProfitDefensePassport_CrossDomainIntegration`


## Fortune 500 hardening added in 8A.1.1

Migrations 806-809 add: PUBLIC execution lockdown; tenant-derived security-definer APIs; mandatory correlation IDs; immutable approved governance versions; database-generated serialized SHA-256 audit chains; complete idempotency leases; SKIP LOCKED outbox claims, retries, dead-lettering, and stale-lock recovery; retention/legal-hold/partition governance; ownership finalization; and behavioral/adversarial certification.

### Hardened installation

```bash
export DATABASE_URL='postgresql://...'
bash scripts/preflight-domain8-foundation.sh
bash scripts/install-domain8-foundation-hardened.sh
```

For an existing 801-805 installation, apply migrations 806-809 in order and run both certification scripts. Destructive purge remains fail-closed until external archive verification and case/evidence legal-hold linkage are certified.

## Managed PostgreSQL ownership note (8A1.1.1)

Migration 809 is capability-aware. If the deployment principal cannot `SET ROLE tcds_domain8_owner`, the migration completes all mandatory PUBLIC privilege lockdown and safely skips ownership transfer with a NOTICE.

To complete ownership transfer later, a platform administrator may temporarily grant the deployment owner membership in `tcds_domain8_owner`, rerun migration 809, then revoke that membership. Alternatively run `scripts/finalize-domain8-owner-admin.sql` as an eligible administrator.
