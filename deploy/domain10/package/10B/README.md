# TCDS Domain 10 — Slice 10B Revision 2
## Event Intake & Notification Decision Engine
### Reviewed Green Tier 1 target

10B is the deterministic decision layer between originating-domain operational facts and the reviewed 10A Email/SMS delivery control plane.

## Authoritative flow

```text
Originating domain event
→ strict envelope validation
→ frozen event-contract validation
→ 10A immutable operational event
→ durable planning outbox
→ deterministic policy resolution
→ suppression evaluation
→ declarative audience resolution
→ recipient authorization
→ EMAIL/SMS eligibility
→ frozen template binding + safe rendering
→ one atomic notification plan
→ 10A notification outbox
→ 10C provider delivery
```

10B performs **no Microsoft Graph or Telnyx calls**.

## Revision 2 review hardening

This release corrects the original 10B package's production-repository and governance issues, including:

- repository-native CommonJS/root-build compatibility;
- no competing root package/tsconfig;
- no second PostgreSQL pool/logger/metrics control plane;
- full authoritative event-envelope collision fingerprinting;
- frozen event receipt-time decision basis;
- historical retired-contract/policy replay support;
- PostgreSQL revalidation of the selected policy;
- PostgreSQL revalidation of recipient/channel eligibility;
- all-rule, channel-aware suppression;
- immutable/sealed decision candidate evidence;
- actual planning attempt numbers for retry backoff;
- per-item worker failure isolation;
- strict SECURITY DEFINER grants;
- fresh/upgrade/partial-install database preflight;
- production repository path-collision preflight.

See `docs/10B_FINAL_REVIEW.md`.

## Reviewed 10A prerequisite

10B requires the reviewed 10A contract including its 511 hardening. It extends those objects; it does not replace them.

## Production repository integration

Do not copy the certification metadata into the root project. Only merge the runtime source/database/scripts/docs intentionally. See:

`docs/PRODUCTION_INTEGRATION.md`

The production repository must add `ajv` and `ajv-formats` to its **root** dependency set because those packages power frozen JSON-Schema validation.

## Fail closed

Keep:

```env
DOMAIN10_PLANNER_ENABLED=false
```

until all database, root-build, concurrency, replay, audience/policy, and 10C handoff gates pass.

## Certification

Run against a disposable PostgreSQL database and a clean checkout of the actual production repository:

```bash
export DATABASE_URL='postgresql://...'
export REPO_ROOT='/path/to/TCDS_Arbitrage'
./scripts/certify-domain10-10b.sh
```

The certification harness intentionally uses the production root `package-lock.json`, TypeScript configuration, Jest stack, and build.
