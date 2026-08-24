# Domain 10 (10A–10F) operations schema — DB layer deployment notes

Certified against Supabase PostgreSQL 17. All six slices pass their PostgreSQL contract +
hardening tests in one clean sequential build. Old email `operations` schema was backed up
(`operations_schema_backup_20260822_163142.dump`, on the box) then dropped and replaced.

## Install / re-verify (DB layer only)
    export DATABASE_URL="$(grep '^DATABASE_URL=' /srv/arb-system/api/.env | head -1 | cut -d= -f2- \
      | sed 's/sslmode=no-verify/sslmode=require/')"
    bash deploy/domain10/run10.sh      # DROP SCHEMA operations CASCADE -> 10A cert -> 10B..10F DB phase
Ends with: `######## ALL 10A-10F DB LAYERS CERTIFIED ########`.
`d10_fix.py` applies the systemic transforms (digest schema-qualification + E.164 regex) to the
package .sql files; already applied to the committed package.

## 8 residual fixes applied to the vendor package (relay for v-next). No checksum chain — files edited directly.
1. E.164 regex `'^\+…'` was written with a double backslash (needs standard_conforming_strings=off).
2. pgcrypto `digest()` unqualified -> `extensions.digest(` (Supabase keeps it in schema `extensions`).
3. 10B trigger order: hash guard sorted before immutability guard -> renamed to `trg_event_contract_frozen_immutable`.
4. 10A template/rendered hash separator `E'\\n'` -> `E'\n'` (matches tests/app).
5. 10C `record_final_delivery` revoked `FROM <role>` instead of `FROM PUBLIC` (default function EXECUTE grant).
6. `has_function_privilege('PUBLIC',…)` -> lowercase `'public'` (10D/10E tests, 10F 532).
7. 10E seed omitted NOT-NULL `event_sources.service_name` (+ domain_number).
8. 10F: inline CHECK auto-name truncates mid-string; 532's explicit DROP truncated end -> DROP no-op ->
   stale constraint survived. Fixed 532 to drop by discovery. Also 10F contract test was stale vs the
   vendor's own v1/v2 evaluator refactor (replay moved to delegated `_v1`; `apply_telnyx` only in
   PUBLIC_EXECUTE_LOCKDOWN signature strings) -> test assertion corrected; security code untouched.

## PENDING — runtime not wired (email/SMS processing paused)
Each slice certify script's repo phase (npm ci/typecheck/test/build) needs the TS overlay
(`src/domains/operations/*`, `tests/domain10/*`) integrated into this repo + AJV deps + the Graph
ClientCertificateCredential change. Until wired + PM2-started, nothing processes the new schema.

## RUNTIME — delivery worker wired (2026-08-23)
Overlay integrated into src/domains/operations (76 files, 0 collisions), reuses existing db.ts pool.
Added deps: ajv@8.17.1, ajv-formats@3.0.1 (production root). Zod-4 fix: *Env.ts bool() is
default-before-transform.
Composition root: `src/workers/domain10DeliveryBootstrap.ts` — configures Domain10Runtime (pool +
console logger + no-op metrics/tracer) and the delivery provider registry (Graph = existing
MicrosoftGraphEmailProvider via adaptExistingMicrosoftGraphSender; SMS = Telnyx direct via
adaptExistingTelnyxSender using TELNYX_API_KEY + DOMAIN10_SMS_FROM), then loops
runDeliveryOrchestrationBatch(EMAIL/SMS) + runDeliveryReconciliationBatch with graceful shutdown.
PM2: `pm2 start dist/workers/domain10DeliveryBootstrap.js --name domain10-delivery-worker --node-args="-r dotenv/config"`
Required .env (NOT committed): DOMAIN10_DELIVERY_ENABLED=true, DOMAIN10_DELIVERY_EMAIL_ENABLED=true,
DOMAIN10_DELIVERY_SMS_ENABLED (staged false), DOMAIN10_SMS_FROM=+15715160419, plus existing M365_* +
TELNYX_API_KEY + DATABASE_URL.
STATUS: delivery worker live + idle-clean. PENDING for full event->auto-send: wire the 10B planner
worker + seed governance config (notification_policies/templates/audiences, frozen) so the pipeline
PRODUCES claimable deliveries. Manual SMS/email sends already proven via direct API.

## PLANNER + GOVERNANCE — full pipeline live (2026-08-24)
Planner wired into domain10DeliveryBootstrap.ts (runNotificationPlanningBatch loop) + DOMAIN10_PLANNER_ENABLED=true (.env).
Governance smoke config seeded (deploy/domain10/governance_smoke_seed.sql): EMAIL channel_controls enabled;
alerts@ recipient + EMAIL authorization + OPERATIONS audience membership; DOMAIN10_SMOKE_TEST event type +
frozen event contract; frozen EMAIL template; DOMAIN10_SMOKE_POLICY bound + frozen.
END-TO-END PROVEN: ingest_operational_event(DOMAIN10_SMOKE_TEST) -> planner PLANNED -> delivery
ACCEPTED_BY_PROVIDER (Microsoft Graph HTTP 202), no manual step (real email to alerts@).
DELIVERED-state confirmation additionally needs Graph message-trace/webhook evidence wiring (future).
Residual #9: 10C claim_delivery_reconciliation_10c RETURNS TABLE OUT col `state` collided with the table
column in the lease-reset UPDATE ('column reference state is ambiguous') -> fixed with #variable_conflict use_column.
