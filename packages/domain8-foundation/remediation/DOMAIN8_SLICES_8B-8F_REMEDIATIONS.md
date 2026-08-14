# Domain 8 Slices 8B–8F — deployment remediations (2026-08-14)

Applied to the live TCDS Supabase DB while installing Domain 8 slices 8B→8F on top of the
8A foundation. All slices install into the `return_defense` schema, no cross-domain FKs.
Registry status at time of writing: 8C/8D/8E CERTIFIED, 8B/8F INSTALLED. Migrations 810–910 applied.

## Generalized deploy note
Vendor install scripts run `psql -f <migration>` with NO app context, but migrations perform
governed INSERTs → they fail with `app.correlation_id is required`. Apply each slice's
migrations in ONE psql session that first does
`SET app.tenant_id/app.actor_id/app.actor_type/app.correlation_id`, then `\i` each migration
in numeric order. libpq needs `sslmode=require` (node-pg uses `sslmode=no-verify`).

## Package defects found + fixes (relay to package authors)
- **8E2 / 862 schema drift:** `862_..._contract_compatibility.sql` INSERTs into
  `control_definitions` using columns `control_name/control_description/control_category/
  mandatory_default/control_metadata` that don't exist. Real 8A(801) columns:
  `display_name/description/control_domain/control_type(NOT NULL)/metadata`. Fixed the INSERT
  (remapped columns + supplied control_type). 8E2 was built against a different 8A.
- **8E2 / 872–873 ordering:** 871 creates `post_sale_feature_projection_rules` with an inline
  `cast_type` CHECK lacking `BIGINT`; 872 inserts BIGINT rows; 873 widens the constraint —
  but 873 runs after 872. Fix: drop the narrow inline check before 872 (873 re-adds the wider
  `post_sale_projection_cast_type_ck`).
- **8E2 / missing controls:** `certify_required_post_sale_controls()` (875) requires 14 active
  control codes; 862 seeds only 6. Seeded the other 8 (ADD_INSURANCE, ADD_SIGNATURE,
  CAPTURE_ADDITIONAL_EVIDENCE, PRESERVE_EVIDENCE, RECONCILE_LINEAGE, REWEIGH_PACKAGE,
  SUPERVISOR_REVIEW, VALIDATE_ADDRESS) with the correct 8A schema.
- **8B / missing source contract:** 862's DELIVERY_INTERVENTION requires a source contract for
  `arb.shipment_tracking_events (id bigint)` which 8B's seed (814) omitted. The table exists;
  registered the contract + ran `validate_source_entity_contract()` → VALID.
- **8E2 / profile activation:** 874 defines but never calls
  `seed_post_sale_profile_activations(tenant, policy_version, model_version, approver, ref)`.
  Called it manually (active 8A policy, NULL model — models are advisory) to activate the 5
  post-sale gate profiles so `certify_post_sale_profile_activations()` passes.
- **8F / 884 orphan FK (#7):** 884 FKs `override_event_id` to `return_defense.prevention_override_events`
  which NO migration creates (8C named the override table `decision_overrides`). Dropped that FK
  clause (column kept as a plain uuid). 8F built against a different 8C.
- **8F / 899 mis-ordered grants (#8):** 899 GRANTs EXECUTE on functions defined later/renamed
  (`verify_outcome_observation`/`supersede_outcome_observation` are `_v2` in 902;
  `approve_recommendation_for_experiment_v2` in 905). Skipped 899; ran 900–910; then applied a
  resilient security finalize: `REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA return_defense FROM
  PUBLIC` + a DO-block that GRANTs by function name (tolerant of `_v2` drift and overloads) to
  `tcds_domain8_worker` / `tcds_domain8_reviewer`.

## Cert-script defects (non-blocking; substantive certs pass)
- `has_function_privilege('PUBLIC', …)` → `role "PUBLIC" does not exist` (PUBLIC is a pseudo-role).
  Verify PUBLIC-revoke via `aclexplode(proacl) grantee=0` instead. (8B/8C certs.)
- psql `:'var'` used inside `DO $$ … $$` blocks → `syntax error at or near ":"` (psql doesn't
  substitute inside dollar-quoted bodies). Use `current_setting('app.tenant_id')`.

## App layer (TypeScript) integration
Slices 8C+8D+8E+8F ship `src/domains/returnDefense/*` (95 files total, self-contained; deps
pg/express/zod/pino/node:crypto). Integrated into the repo; `npm run build` is clean (strict).
Repo jest (`testMatch **/src/tests/**`) doesn't include the package tests — run them with
`npx jest --testMatch '**/src/domains/returnDefense/tests/**/*.test.ts'` (6+3 suites pass).
Added `src/domains/returnDefense/tests` to tsconfig `exclude` (build uses `types:["node"]`,
no jest types; tests run via `tsconfig.test.json`). 8E certified end-to-end incl. a real TS
build+test evidence file. 8F green-tier cert (runtime behavioral) still pending.
