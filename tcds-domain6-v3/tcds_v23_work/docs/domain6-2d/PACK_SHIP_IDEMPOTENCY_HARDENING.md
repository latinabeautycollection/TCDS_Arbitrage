# Pack/Ship retry and idempotency: separate hardening item

Status: **open**. Not part of the Milestone 2A scanner slice, which changes only the four
scanner-driven calls. Everything below describes the code as it is; nothing here changes it.

## What Milestone 2A changed

`scanSource`, `scanItem`, `verifyLabel` and `stageOutbound` in
`src/features/packShip/services/packShipApi.ts` take an optional `OperationContext`
(`clientOperationId`, `correlationId`). With it, every attempt of one operation sends:

| Header | Value |
|---|---|
| `Idempotency-Key` | `clientOperationId`, the same on every attempt |
| `X-Correlation-ID` | `correlationId`, the same on every attempt |
| `X-Request-ID` | new for each HTTP attempt |

This is the same mapping as `operationHeaders()` in the 6.2D operation contract. Without a
context, as from the manual Pack/Ship screen today, each call gets new values as before.

## Current behaviour of every other Pack/Ship call

All calls go through `request()` in `packShipApi.ts`:

- Each call sends a new `X-Request-ID`, a new `X-Correlation-ID` and, for every POST, a new
  `Idempotency-Key`, all from `crypto.randomUUID()`.
- The helper never retries. After 20 seconds it aborts and throws `REQUEST_TIMEOUT`; any other
  failure to get a response throws `NETWORK_ERROR`. In both cases the server may or may not have
  applied the request.
- The Pack/Ship screen's retry (`retryLast` in `PackShipScreen.tsx`) runs the last call again.
  The repeat carries a new `Idempotency-Key`, so the server cannot tell it from a new request.

| Call | What guards a repeat today | A repeat applied twice could mean |
|---|---|---|
| `purchaseLabel` | nothing sent by the client | a second label bought from the carrier |
| `printLabel` | nothing sent by the client | a second print job |
| `selectRate` | `quoteId` | the same quote selected again |
| `getRates` | nothing sent by the client | a second rate request |
| `validateAddress` | nothing sent by the client | a second validation |
| `evaluateRisk` | nothing sent by the client | a second evaluation |
| `completionCheck` | nothing sent by the client | a second check |
| `claim` | nothing sent by the client | a second claim attempt |
| `selectPackage` | `rowVersion` | refused as stale, if the server checks the row version |
| `saveMeasurements` | `rowVersion` | refused as stale, if the server checks the row version |
| `seal` | `rowVersion` | refused as stale, if the server checks the row version |

The right-hand column is what the client allows. Whether the server already guards these calls
some other way is for the Domain 6 backend owner to confirm; the backend is not in this
repository.

`claim` is in neither list of the Milestone 2A instruction. It is not scanner-driven, so it is
left unchanged and listed here.

## Suggested order

1. `purchaseLabel` and `printLabel`, where a duplicate costs money or material.
2. `selectRate`, `getRates`, `validateAddress`, `evaluateRisk`, `completionCheck`, `claim`.
3. The row-versioned calls last, since a stale row version already stops most repeats.

The same pattern applies to each: the screen creates one operation per user action, keeps it
for that action's retries, and passes it to the helper.
