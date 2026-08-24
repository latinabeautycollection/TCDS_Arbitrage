# Production Repository Integration — Domain 10B Revision 2

## Current repository model

10B must be merged as an additive extension of the existing `src/domains/operations` domain. Do not replace the current Email files and do not merge the standalone certification `package.json` or `tsconfig.json`.

### Additive runtime paths

10B adds these categories/files:

- `config/operationsEnv.ts`
- `errors/OperationsDecisionError.ts`
- `models/eventTypes.ts`
- `models/decisionTypes.ts`
- `infrastructure/operationsRuntime.ts`
- `validators/eventEnvelopeValidator.ts`
- 10B repositories named for event/planning/policy/audience/suppression/decision work
- 10B engines
- `services/templateRenderingService.ts`
- `services/notificationPlanningService.ts`
- `workers/notificationPlanningWorker.ts`

The reviewed package deliberately does not include a second `repositories/db.ts`, `email*` service/provider, or generic operations logger/metrics/tracer implementation.

## Runtime composition

The production composition root must call `configureDomain10Runtime()` exactly once and inject:

- the existing Domain 10 PostgreSQL `Pool`;
- a logger adapter around the production Pino logger;
- the existing metrics registry/adapter;
- the existing OpenTelemetry tracer/adapter.

Example logger adapter concept (adjust the import paths to the production composition root):

```ts
configureDomain10Runtime({
  pool,
  logger: {
    info: (message, context) => logger.info(context ?? {}, message),
    warn: (message, context) => logger.warn(context ?? {}, message),
    error: (message, context) => logger.error(context ?? {}, message),
  },
  metrics: domain10MetricsAdapter,
  tracer: domain10TracerAdapter,
});
```

This adapter is intentional because the production Pino usage is object-first/message-second while 10B's internal runtime port is message-first/context-second.

## Worker bootstrap

The production repository already owns worker lifecycle and graceful shutdown. 10B must be registered through that composition root rather than creating another PM2/API process.

Recommended integration pattern:

1. Configure the Domain 10 runtime once.
2. Create one production-managed planning loop/timer or worker wrapper that calls `runNotificationPlanningBatch()`.
3. Register its shutdown method with the existing managed worker lifecycle.
4. Keep `DOMAIN10_PLANNER_ENABLED=false` until certification.

Do not create a second application server or second PostgreSQL pool solely for 10B.

## Required root dependency addition

The current 10B validator uses JSON Schema through:

- `ajv`
- `ajv-formats`

These are intentional production dependencies and must be added to the **root** TCDS package under normal change control. Do not use the standalone certification package versions as the production dependency authority.

## Root tests

The final merge should run the 10B tests through the repository's Jest/ts-jest configuration from `tests/domain10/10b` or another root-approved excluded test path.

## Provider boundary

10B must never import:

- `MicrosoftGraphEmailProvider`
- `TelnyxSmsProvider`

It writes `operations.notification_outbox` only. 10C owns delivery execution.
