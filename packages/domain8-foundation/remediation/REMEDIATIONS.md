# Domain 8 Slice 8A.1.1 — Supabase remediations

The shipped package installs cleanly on vanilla Postgres but has three defects on
managed Postgres (Supabase, db.vfxlrkqgakqqbnbbgecp). All three are fixed here.
The live DB (TCDS Supabase) has been remediated and CERTIFIED PASS
(active_policies=1, active_thresholds=10, reason_codes=11, controls=10).

## Defects & fixes
1. **pgcrypto search_path (functional blocker).** pgcrypto lives in the `extensions`
   schema; `digest()` is only there. `sha256_jsonb`/`sha256_text` are un-pinned
   inlined SQL, so they resolve `digest()` under the callers' pinned
   `search_path=pg_catalog, return_defense` (no extensions) and fail. Idempotency
   claims and audit-chain hashing break entirely.
   Fix: `010_pgcrypto_searchpath_fix.sql` (pins search_path incl. `extensions`,
   which also disables inlining).
2. **Seed missing audit context.** Migration 806 made `app.correlation_id` (+actor)
   mandatory on governed writes, but `scripts/seed-domain8-policies.sql` only sets
   `app.tenant_id`, so it aborts and rolls back (empty catalogs).
   Fix: run `seed-with-context.sh` instead of the raw seed.
3. **Broken certification scripts.** `scripts/certify-domain8-foundation.sh` and
   `...-behavioral.sh` reference psql vars `:'tenant_id'` inside `DO $$ ... $$`
   blocks; psql does not substitute inside dollar-quoted bodies -> syntax error.
   Fix: `certify-inline.sql`.

## Correct install order on managed PG
```
export DATABASE_URL='postgresql://...?sslmode=require'   # libpq: require, NOT no-verify
bash scripts/preflight-domain8-foundation.sh
bash scripts/install-domain8-foundation-hardened.sh      # applies 801-809 (idempotent DDL)
psql "$DATABASE_URL" -f remediation/010_pgcrypto_searchpath_fix.sql
bash remediation/seed-with-context.sh
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f remediation/certify-inline.sql
```
Note: migration 807 uses `ALTER TABLE ... ADD CONSTRAINT` without IF NOT EXISTS, so
a re-run of the hardened installer over an existing install errors on that
constraint; on an already-installed DB, apply only the remediation steps above.
Domain 8 migrations are applied out-of-band from this package, not via the repo
`sql/` pipeline.
