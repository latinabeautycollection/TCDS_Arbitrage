# Domain 9 (AI Orchestration) — Deployment Notes

Domain 9 is the AI-orchestration governance layer (schemas `ai_control`, `ai_audit`, `ai_eval`,
`ai_finance`, `ai_integration`, `ai_observe`, `ai_query`, `ai_batch`, `ai_release`). It is
advisory-only: it cannot authorize any refund/listing/shipment/financial action.

Installed from the vendor **V3 PostgreSQL re-issue**
(`domain9_enterprise_deployment_bootstrap_v3_postgres_reissue.zip`). V3 genuinely fixed the 7
major defects from the earlier round, but a clean PG17/Supabase install still tripped on ~16
smaller residuals. Those are all fixed by `d9v3_fix.py`, applied to the extracted WORK tree
after each extraction (never to the checksummed `/database/migrations/` files).

## What is DONE (all DB-side; committed here for traceability)
- **Phase A** — 9A→9K schema install + certification (`DOMAIN9_SCHEMA_ASSEMBLY_9A_TO_9K_PASS`).
- **Phase B** — 11 dedicated LOGIN roles + group grants + service principals + 3 approval
  authorities + real-principal RLS matrix (`DOMAIN9_REAL_PRINCIPAL_RLS_MATRIX_PASS`).
- **Phase C config** — 3 providers (OpenAI/Anthropic/Gemini) with `file://` secret references,
  4 models + pricing + capabilities, PRODUCTION connection profiles, `DOMAIN9_GLOBAL` budget.
  All non-operational (providers `DISABLED`).
- **Task selection** — 4 Phase-4 tasks enabled (listing title/description, product identity,
  image condition) + 9E/9F policy templates seeded.

## What is HELD (go-live) — deliberately not done
Governance activation (9D task-execution contracts → 9E quality → 9F consensus → 9C routing)
is driven by the ai-orchestration **runtime**, not operator SQL (no build/approve contract
functions exist; the app assembles the canonical contract). Going live therefore requires
deploying + running the Domain 9 immutable overlay, then the 9K release cert + **3 distinct
approvals (Technical/Security/Executive)** which route through the business owner. Held pending
a low-cost test plan.

## Scripts in this directory
- `d9v3_fix.py <WORK_dir>` — applies the ~16 V3 residual fixes to the extracted slice
  scripts/seeds/certs/tsconfig (NOT migrations). Wired into the enterprise installer after the
  extract step; also run on `$ROOT/scripts` for the root installer + Phase-B scripts.
- `phase_b_setup.sh` — creates the 11 dedicated non-super/non-bypassrls LOGIN roles (hex
  passwords generated on the box, never in git) and writes a mode-600 `domain9-production.env`.
- `phase_c_secrets_and_config.sh` — writes provider keys from `.env` into `~/.domain9-secrets`
  (mode 600), sets `file://` references, loads the 4 models + pricing + capabilities + budget.

## V3 residuals fixed by d9v3_fix.py (relay to package authors for v3.1)
1. slice sub-scripts ship without the executable bit (installer invokes them directly).
2. psql `:'var'` inside `DO $$` blocks (migration-history verification) → set_config/current_setting.
3. PG17 folds `ELSE 1/0` in a non-const CASE → `1/(CASE WHEN cond THEN 1 ELSE 0 END)`.
4. 9E `907b` redefines `activate_quality_policy` with a changed return type via CREATE OR REPLACE → DROP in the install script before it.
5. 9F seed omits two NOT NULL cols 908b added (`minimum_decisive_model_votes`, `minimum_distinct_human_reviewers`).
6. 9F V1 cert checks V1 grants that 908b revoked → point to the V2 functions.
7. 9H `run-local-certification.sh` uses `npx --yes tsc` (wrong `tsc` package) → use the repo's TypeScript 6.0.2.
8. 9H certification-harness `tsconfig.json` missing `"rootDir":".."` (TS6059/TS5011).
9. `911b` preflight requires functions 911b itself creates → skipped.
10. 9I `history_sha` uses `:'code'` in `psql -c` → shell interpolation.
11. 9I cert queries `pg_tables.forcerowsecurity` (doesn't exist) → `pg_class.relforcerowsecurity`.
12. scripts call `python` instead of `python3`.
13. 9J `912c` redefines `claim_control_request` with a changed RETURNS TABLE → DROP before 912c.
14. 9J cert uses `has_function_privilege('PUBLIC',…)` (uppercase) → lowercase `'public'`.
15. Phase-B bootstrap reviewer `service_principals` row had 10 values for 9 columns.
16. Phase-B bootstrap login-validation used `:'login'` in `psql -c` → shell interpolation.
Plus two live 9K grant gaps: `tcds_ai_reviewer` needed `USAGE`+`SELECT` on `ai_release` and a
self-read RLS policy on `release_approval_authorities` for approver validation.

## Per-run reset (a partial install requires an empty namespace — collision preflight fails otherwise)
`DROP SCHEMA IF EXISTS ai_control, ai_audit, ai_eval, ai_finance, ai_integration, ai_observe, ai_query, ai_batch, ai_release CASCADE;`

## NOT in git (by design)
`domain9-production.env` (role passwords), `~/.domain9-secrets/*` (provider keys), the vendor
zips, and the extracted `.work/` tree.
