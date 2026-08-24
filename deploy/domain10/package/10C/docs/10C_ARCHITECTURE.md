# Domain 10C — Enterprise Delivery Orchestration

## Ownership boundary

10C is deliberately narrow.

### 10A remains authoritative for

- notification delivery rows and state machine
- delivery attempts
- transactional notification outbox
- provider receipt evidence
- dead letters
- SMS subscriptions / consent truth
- channel controls
- rate-limit tables
- final-delivery evidence rules
- audit truth

### 10B remains authoritative for

- operational-event intake
- frozen event contracts
- notification policy selection
- suppression planning
- recipient/audience resolution
- recipient authorization
- channel selection
- frozen template binding/rendering
- creation of notification requests/deliveries/outbox rows
- immutable notification-decision evidence

### 10C owns

- claiming provider-ready 10A outbox work
- last-moment operational send gates
- beginning exactly one provider attempt
- coordinating the existing Graph/Telnyx provider implementations
- explicit retry scheduling
- Retry-After-aware delay
- ambiguous provider-outcome quarantine
- final failure / dead-letter orchestration
- normalized verified Telnyx outbound receipt application
- delivery reconciliation task queueing

10C does not choose recipients, choose channels, render business templates, manage SMS consent, verify START/STOP/HELP, authenticate Graph, authenticate Telnyx, or create a second notification truth model.

## Delivery flow

10B committed delivery
→ 10A `notification_outbox`
→ 10A `claim_notification_outbox`
→ 10C local/environment gate
→ 10A channel control
→ rate permit
→ SMS current-consent recheck if applicable
→ 10C `begin_delivery_execution_10c`
→ delivery becomes `SENDING`
→ exactly one provider call

Explicit provider acceptance:
- Graph: HTTP 202 only
- Telnyx: HTTP 2xx + Telnyx message ID

→ reviewed 10A `record_provider_acceptance`
→ `ACCEPTED_BY_PROVIDER`

Explicit retryable failure:
→ `FAILED_RETRYABLE`
→ future outbox availability
→ retry worker claim later

Network/timeout/unknown response:
→ `UNKNOWN_PROVIDER_OUTCOME`
→ outbox completed
→ reconciliation task
→ **NO blind resend**

Explicit permanent/exhausted failure:
→ `FAILED_FINAL`
→ `DEAD_LETTERED`

## Microsoft Graph

Microsoft Graph `sendMail` HTTP 202 is provider acceptance only. It never becomes `DELIVERED` in 10C by itself.

The existing Microsoft Graph provider keeps ownership of certificate/OAuth authentication and the actual HTTP request. 10C injects it through `EmailDeliveryPort`.

## Telnyx

Telnyx send acceptance must produce an HTTP 2xx response and a provider message ID.

The existing SMS provider/webhook layer keeps ownership of:
- API key
- raw HTTP webhook endpoint
- Ed25519 raw-body signature verification
- timestamp freshness
- START/STOP/HELP consent processing

After signature verification, the webhook layer may normalize outbound `message.sent` / `message.finalized` events and pass them to:

`consumeVerifiedTelnyxDeliveryEvent(...)`

A `message.finalized` status of `delivered` is accepted as final Telnyx delivery evidence. Final failure statuses are not silently resent.

## Retry safety

Provider adapters contain no business-level retry loop.

Worker retry:
- only after an explicit retryable response
- bounded by 10A `max_attempts`
- exponential backoff with jitter
- uses provider Retry-After when supplied

Unknown outcome:
- never treated as an ordinary retry

This prevents retry multiplication and duplicate operational alerts.


## Reviewed production-provider boundary

10C does not carry `M365_ALERT_FROM`, Telnyx `from`, Messaging Profile ID, API keys, certificate paths, or OAuth configuration. Those are provider-owned settings.

The Microsoft Graph adapter is structurally aligned with the production `GraphSendRequest` contract, including `EmailRecipient[]`, required HTML body, importance, correlation IDs, and exact HTTP 202 result semantics.

The adapter also preserves the existing provider's explicit failure metadata (`failure`, `retryable`, `ambiguousOutcome`, `httpStatus`, `providerCode`, `retryAfterMs`) instead of converting all provider errors into UNKNOWN.
