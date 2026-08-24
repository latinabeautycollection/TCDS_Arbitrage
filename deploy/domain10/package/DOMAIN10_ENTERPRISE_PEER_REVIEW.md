# Domain 10A–10F Enterprise Peer Review

## Verdict

The uploaded reviewed slices have a strong separation-of-authority design, but the
unmodified set was **not yet a literal 10/10 certifiable production package**.

The peer review found two deployment blockers and one production-repository
compatibility condition:

### Blocker 1 — missing `operations.severity_rank(text)`

10B authoritative policy resolution and 10D escalation-binding verification call
`operations.severity_rank(...)`. None of the uploaded migrations originally
created that function. 10A owns the severity taxonomy, so this master package
adds the immutable helper to 10A migration 511 and adds prerequisite/certification
tests.

### Blocker 2 — production root lacks AJV dependencies

Reviewed 10B imports `ajv` and `ajv-formats`. The current public production
`package.json` does not list either dependency. Before production overlay, install:

`npm install --save-exact ajv@8.17.1 ajv-formats@3.0.1`

and commit the resulting root `package.json` and `package-lock.json`.

### Production compatibility condition — legacy email subsystem

The current GitHub production repository still contains legacy:
- `emailDeliveryWorker.ts`
- `emailRetryWorker.ts`
- `emailReconciliationWorker.ts`
- `emailDeliveryRepository.ts`
- associated legacy email services/types.

The legacy repository targets a different historical SQL shape (`email_outbox`,
`request_id`, JSON recipients, etc.) than reviewed 10A. It therefore **must not
be scheduled after reviewed 10A–10C become authoritative**.

The current central `workerBootstrap.ts` does not schedule those legacy email
workers, which is good. The master production preflight fails if a future bootstrap
or PM2 configuration activates them.

The existing `microsoftGraphEmailProvider.ts`, `emailEnv.ts`,
`EmailProviderError.ts`, and Graph request types are retained as provider
infrastructure. Reviewed 10C structurally adapts to that provider.

## Final ownership

- 10A — PostgreSQL authoritative event/notification/delivery/incident/audit truth
- 10B — event intake and notification-decision authority
- 10C — EMAIL/SMS provider execution, retry, receipt and reconciliation authority
- 10D — incident activation, ACK/OWN/DECLINE and escalation orchestration authority
- 10E — communication assurance/SLO evidence authority
- 10F — certification/replay/release-evidence authority only

## External provider gates

Production certification remains conditional on:
- Microsoft Graph application Mail.Send configured under approved least privilege;
- Exchange application RBAC scope verified and any broader Entra grant removed
  when the scoped model is authoritative;
- certificate credential mode/expiry verified for production;
- Graph HTTP 202 treated as provider acceptance, not final delivery;
- Exchange trace/NDR reconciliation used for final email-delivery evidence;
- Telnyx webhook signature verification, duplicate-event handling and occurred_at
  ordering verified;
- START/STOP/HELP behavior verified;
- active/approved 10DLC campaign and assigned long-code verified.

## PostgreSQL ↔ TypeScript review

The reviewed B–F runtime contracts use:
- PostgreSQL `uuid` ↔ TypeScript `string`;
- PostgreSQL `integer` ↔ TypeScript `number`;
- PostgreSQL `timestamptz` ↔ ISO `string` / Date conversion;
- PostgreSQL `jsonb` ↔ `Record<string, unknown>`/structured objects;
- PostgreSQL `numeric` ↔ explicit `Number(...)` only for bounded SLO metrics.

No material length mismatch was found in the reviewed B–F runtime code. Runtime
error strings are generally bounded to the DB evidence limits before persistence.

The current production legacy email model is deliberately excluded from the
authoritative reviewed DB contract because it targets the historical schema.
It must remain dormant or be removed/migrated before anyone grants it runtime
authority.

## Certification position

After the included severity-helper remediation and the required production-root
AJV dependency update, the **architecture/code target is Green Tier 1 certifiable**.

A deployed environment is not `CERTIFIED` until the actual PostgreSQL 15+ migration
suite, root TypeScript 6.0.2 build/Jest, concurrent SKIP LOCKED drills, real Graph/
Exchange evidence, real Telnyx/10DLC evidence, incident escalation drills, 10E
breach/recovery drills and 10F profile-v2 attestations all pass.
