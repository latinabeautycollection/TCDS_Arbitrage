# Production Integration

## 1. Prerequisites

Install reviewed 10A and reviewed 10B first.

The production composition root must already configure:

`configureDomain10Runtime(...)`

from reviewed 10B.

## 2. Overlay

Copy only additive 10C runtime paths:

`src/domains/operations/delivery/**`

Do not overwrite existing Graph, email worker, Telnyx, planning, logger or DB-pool files.

Run:

```bash
REPO_ROOT=/srv/tcds-arbitrage ./scripts/preflight-domain10-10c-repo.sh
```

immediately before merge.

## 3. Database

Run preflight, then migrations 516/517, then security 518 through the normal TCDS migration governance.

## 4. Provider registry

At the existing production composition root, configure the low-level providers once:

```ts
configureDeliveryProviderRegistry({
  email: adaptExistingMicrosoftGraphSender(existingGraphProvider),
  sms: adaptExistingTelnyxSender(existingTelnyxProvider)
});
```

The adapter is intentionally thin. Authentication remains in the existing providers.

## 5. Worker bootstrap

Add the two 10C batch functions to the existing managed worker process rather than starting a second API server:

```ts
await runDeliveryOrchestrationBatch("EMAIL");
await runDeliveryOrchestrationBatch("SMS");
await runDeliveryReconciliationBatch();
```

Cadence can be controlled by the existing worker scheduler.

## 6. Telnyx webhook integration

The existing `/telnyx/inbound` / delivery webhook endpoint must:

1. retain the raw body
2. verify `telnyx-signature-ed25519`
3. validate `telnyx-timestamp` freshness
4. return 2xx promptly
5. queue/process asynchronously
6. for outbound `message.sent` / `message.finalized`, normalize the verified event
7. call `consumeVerifiedTelnyxDeliveryEvent(...)`

10C does not take over START/STOP/HELP.

## 7. Enablement

Keep these false until live certification:

```env
DOMAIN10_DELIVERY_ENABLED=false
DOMAIN10_DELIVERY_EMAIL_ENABLED=false
DOMAIN10_DELIVERY_SMS_ENABLED=false
```

The 10A database `channel_controls` must also be enabled separately after provider certification.

Both application and database gates must be open to send.


## Legacy email-worker semantic collision guard

The current production repository already contains `src/domains/operations/workers/emailDeliveryWorker.ts`.

That file may remain in the repository for migration/history, but it must not be scheduled concurrently with the 10C EMAIL executor. The 10C repository preflight checks the central worker bootstrap and PM2 configuration and fails if it detects dual execution authority.

This is not a filename collision; it is a delivery-authority collision, and Green Tier 1 prohibits it.

## Graph provider compatibility

The reviewed adapter matches the current production `MicrosoftGraphEmailProvider.send(...)` request/result shape. No changes to that provider are required for 10C ownership.

## Telnyx provider compatibility

10C expects a provider-owned `sendOperationalMessage({to,text,tags})` facade. If the existing Telnyx implementation is lower-level and requires `from` or Messaging Profile ID per call, expose that facade inside the Telnyx subsystem. Do not move those provider configuration values into 10C.
