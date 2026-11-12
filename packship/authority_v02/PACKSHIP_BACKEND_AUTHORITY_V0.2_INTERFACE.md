# Pack/Ship Backend Authority V0.2: database interface

Status: **Implemented and rehearsed on production** (2026-11-13: 54/54 tests passed inside a rolled-back transaction).
Not yet applied. Migration `910_packship_v02.sql`, tests `911_packship_v02_tests.sql`.
Owner: Praise (Domain 6 backend). Supersedes the Pack/Ship database review (v0.1).
Schema basis: production catalog dump, 2026-11-12. Every Pack/Ship table is currently empty.

## 1. Rules that apply to every function

| Rule | How |
|---|---|
| **Identity comes from the session, never the caller** | Every operator function takes `p_auth_session_id` (the server-side `warehouse_identity.auth_sessions` id). The function derives user, employee, device and facility from it. It also checks the station when the task has one. No function accepts a user, employee, device or facility id from the route |
| **Session validation** | The session must not be revoked, and its idle and absolute expiry must be in the future. The user must be `ACTIVE`, not locked and not archived. The employee must be `ACTIVE` in the task's facility. The device must be `ACTIVE`, not retired, and in the same facility. If the task has `assigned_station_id`, the device's station must match it |
| **True idempotency** | Every mutation takes `p_idempotency_key` (the client operation id). A new ledger, `warehouse.packship_operations`, stores the key, the operation, a SHA-256 of the canonical inputs, the actor and the result. The same key with the same inputs returns the stored result with `replayed: true` and writes nothing. The same key with different inputs, a different operation or a different actor is refused with `PACKSHIP_IDEMPOTENCY_KEY_REUSED` |
| **Row versions** | Mutations on a task take `p_expected_row_version`. A mismatch is refused with `PACKSHIP_ROW_VERSION_CONFLICT`, and the current version is returned in the error. Triggers bump `row_version` on `packing_tasks`, `packing_task_items`, `packing_task_claims` and `packages` (today only `items` has one) |
| **Claim lifecycle** | Only the holder of the active claim (same employee and device) can change a task. Each mutation extends the lease (15 minutes). An expired claim can be taken over by another operator. A live claim held by someone else is refused with `PACKSHIP_TASK_CLAIMED_BY_OTHER` |
| **One active task per order** | Already enforced by the existing index `ux_packing_tasks_active_order`. Create returns `PACKSHIP_ACTIVE_TASK_EXISTS` together with the existing task id |
| **Durable scan evidence** | Every scan (source, item, tracking, package, location) is written to `warehouse_telemetry.barcode_scan_events`, which is append-only, bound to the facility, device session, operator and task. The scan event id is returned |
| **Rejected scans are kept** | A wrong source, item, label or location is a **result**, not an exception. The function commits the scan event and the idempotency record, and returns `ok: false` with a code. That way the evidence survives and a retry replays the same answer |
| **Errors** | Authority and integrity failures raise SQLSTATE `P0001` with MESSAGE = the code and DETAIL = JSON. The route maps the code to HTTP (§5) |
| **Security** | All functions are `SECURITY DEFINER` with `SET search_path = pg_catalog, pg_temp` and fully qualified names. `REVOKE ALL FROM PUBLIC`; `EXECUTE` is granted only to the roles in §4. There are no table grants |

Every function returns `jsonb`:
```json
{ "ok": true, "code": "OK", "replayed": false,
  "task": { "...snapshot, §3..." },
  "scanEventId": 123, "scanResult": "ACCEPTED" }
```

## 2. Functions

All are in the `warehouse` schema. The `_v2` suffix keeps them separate from the two existing functions, which are revoked rather than dropped. Common trailing parameters for mutations: `p_idempotency_key text, p_request_id uuid, p_correlation_id uuid`.
Scan functions also take `p_capture jsonb`:
```json
{ "source": "CAMERA" | "MANUAL" | "HID",
  "symbology": "CODE128",
  "provider": "scandit",
  "observationId": "...",
  "capturedAt": "...",
  "correlationId": "..." }
```
It is stored as evidence only. `capturedAt` is the client's time; the server's time is authoritative.

| # | Function | Inputs (besides the common ones) | Does | Status change |
|---|---|---|---|---|
| 1 | `packship_create_task_v2` | `p_fulfillment_order_id, p_source_pick_task_id, p_assigned_station_id, p_priority, p_carrier_cutoff_at` | Creates the task and one `packing_task_items` row per order line (item, expected quantity, expected barcode = `items.internal_barcode`). Issues the task's TCDS barcode. **System caller**, no session (§4) | → `READY` |
| 2 | `packship_claim_task_v2` | `p_auth_session_id, p_packing_task_id` | Claims the task, or takes over an expired claim (the old claim is released with `CLAIM_EXPIRED`). Re-claiming your own claim refreshes it | `READY` → `CLAIMED`. Takeover keeps the current status |
| 3 | `packship_release_task_v2` | `p_auth_session_id, p_packing_task_id, p_expected_row_version, p_reason` | Releases your own claim | `CLAIMED` → `READY`; later statuses stay as they are |
| 4 | `packship_verify_source_v2` | `p_auth_session_id, p_packing_task_id, p_expected_row_version, p_raw_barcode, p_capture` | Checks that the source scan is the task's TCDS barcode, or the location holding all of the task's items (open question 2) | `CLAIMED` → `CONTENTS_VERIFYING` |
| 5 | `packship_verify_item_v2` | `p_auth_session_id, p_packing_task_id, p_expected_row_version, p_raw_barcode, p_capture` | Matches the scan to an expected item by `internal_barcode` or a verified `item_identifiers` value. A 13-digit code with a leading `0` also matches its 12-digit UPC-A. Increments `verified_quantity` | When every item is `VERIFIED` → `PACKING` |
| 6 | `packship_select_package_v2` | `p_auth_session_id, p_packing_task_id, p_expected_row_version, p_packaging_profile_id, p_reason` | Creates the package (issued TCDS package number) and links it as `CREATED` | → `MEASURING` |
| 7 | `packship_record_measurements_v2` | `…, p_package_id, p_expected_package_row_version, p_weight_oz, p_length_in, p_width_in, p_height_in, p_weight_source jsonb` | Weight comes from an accepted, stable `scale_measurements` reading (`{"type":"SCALE","weighSessionId":…}`), or from manual entry backed by an approved supervisor override (`{"type":"MANUAL","overrideDecisionId":…}`) | → `EVIDENCE_PENDING` |
| 8 | `packship_complete_task_v2` | `p_auth_session_id, p_packing_task_id, p_expected_row_version, p_package_id, p_expected_package_row_version` | Requires every item verified, the package measured, every blocking evidence requirement accepted or overridden, and no open blocking exception. Writes `package_items`, sets items and package to `PACKED`, seals the package and links it as `PACKED` | → `PACKED` |
| 9 | `packship_verify_label_pair_v2` | `p_auth_session_id, p_shipment_id, p_tracking_barcode, p_package_barcode, p_physical_evidence jsonb, p_capture` | Resolves the handoff from `shipment_id`. Checks the tracking scan against `shipping_handoffs.tracking_number`, both normalized (a carrier number doesn't need to be in `barcodes`). Checks the package scan against the TCDS package number. Requires the handoff's package to be the task's `PACKED` package. Records both scans and links them in a new table, `warehouse.packship_label_pairs`, for 6.2E. Records a `print_verifications` row against the handoff's print job | `PACKED`…`PRINTING` → `LABEL_VERIFIED` |
| 10 | `packship_stage_outbound_v2` | `p_auth_session_id, p_shipment_id, p_location_barcode, p_capture` | The location must be active, in the same facility and of type `STAGING` or `SHIPPING_STATION`. Writes `outbound_staging_events` with the two scan ids from step 9, then releases the claim | `LABEL_VERIFIED` → `OUTBOUND_STAGED` |
| 11 | `packship_get_task_v2` | `p_auth_session_id, p_packing_task_id` | Read only. Returns the snapshot (§3), restricted to the session's facility. Also serves the PWA's `completionCheck` | none |

Each function also checks the task's facility against the session's, and refuses `CANCELLED`, `ABANDONED`, `EXCEPTION` and `HANDED_TO_CARRIER` tasks.

**Not in V0.2:** label purchase and printing (`purchaseLabel`, `printLabel`), rates, address validation, risk evaluation. These belong to the shipping domain, which must create `shipping_handoffs` with `tracking_number` before step 9.

## 3. Task snapshot (returned by every function)

```json
{ "packingTaskId": "…", "taskNumber": "PK-…", "status": "CONTENTS_VERIFYING", "rowVersion": 7,
  "facilityId": "…", "assignedStationId": null, "fulfillmentOrderId": "…",
  "claim": { "heldBySession": true, "employeeId": "…", "deviceId": "…", "expiresAt": "…" },
  "sourceVerified": true,
  "items": [ { "packingTaskItemId": "…", "itemId": "…", "expectedBarcode": "…", "expectedQuantity": 1,
               "verifiedQuantity": 1, "status": "VERIFIED", "rowVersion": 2 } ],
  "package": { "packageId": "…", "packageNumber": "…", "status": "OPEN", "rowVersion": 3,
               "weightOz": null, "lengthIn": null, "widthIn": null, "heightIn": null },
  "shipment": { "shipmentId": "…", "shippingHandoffId": "…", "carrierCode": "…", "status": "…", "trackingPresent": true },
  "blockers": [ "ITEMS_UNVERIFIED", "WEIGHT_MISSING", "EVIDENCE_PENDING" ] }
```
The tracking number itself is not returned. The PWA only needs to know whether one exists.

## 4. Roles

| Role | NOLOGIN | Can execute |
|---|---|---|
| `tcds_packship_api` | yes | functions 2–11 |
| `tcds_packship_system` | yes | function 1 (task creation after picking) |

Your API's login role is granted one or both. **Which login role does your API use?** (open question 5)

## 5. Error codes

| Code | HTTP | Meaning |
|---|---|---|
| `PACKSHIP_SESSION_INVALID` | 401 | Session missing, revoked or expired |
| `PACKSHIP_ACTOR_NOT_ALLOWED` | 403 | User, employee or device not active, or missing the permission |
| `PACKSHIP_FACILITY_MISMATCH` / `PACKSHIP_STATION_MISMATCH` | 403 | The task belongs to another facility or station |
| `PACKSHIP_TASK_NOT_FOUND` | 404 | |
| `PACKSHIP_TASK_CLAIMED_BY_OTHER` | 409 | Live claim held by someone else (DETAIL: `expiresAt`) |
| `PACKSHIP_CLAIM_REQUIRED` | 409 | You don't hold the claim (it expired, or was taken over) |
| `PACKSHIP_ROW_VERSION_CONFLICT` | 409 | DETAIL: `currentRowVersion`. The route should return the fresh snapshot |
| `PACKSHIP_INVALID_STATUS` | 409 | DETAIL: `status`, `expected` |
| `PACKSHIP_ACTIVE_TASK_EXISTS` | 409 | DETAIL: `packingTaskId` |
| `PACKSHIP_IDEMPOTENCY_KEY_REUSED` | 422 | Same key, different request |
| `PACKSHIP_PRECONDITION_FAILED` | 409 | DETAIL lists the `blockers` (complete, label, stage) |
| `PACKSHIP_SHIPMENT_NOT_FOUND` / `PACKSHIP_SHIPMENT_AMBIGUOUS` | 404 / 409 | |
| `PACKSHIP_ORDER_NOT_FOUND` | 404 | Task creation only |
| `PACKSHIP_INPUT_INVALID` | 422 | Bad barcode, capture, dimensions, weight or weight source; or `physicalEvidence` that contradicts the scans (DETAIL: `field`) |
| `PACKSHIP_IDEMPOTENCY_KEY_INVALID` | 422 | Key missing, or not 8–200 characters |

Scan results (returned with `ok: false`; the HTTP status is the route's choice, 200 or 422):
`WRONG_SOURCE`, `WRONG_ITEM`, `ITEM_ALREADY_VERIFIED`, `TRACKING_MISMATCH`, `PACKAGE_MISMATCH`, `WRONG_LOCATION`.

## 6. PWA call → function

| `packShipApi` call | Route (yours) | Function |
|---|---|---|
| `getTask`, `completionCheck` | `GET /packing/tasks/:id`, `POST …/completion-check` | 11 |
| `claim` | `POST /packing/tasks/:id/claim` | 2 |
| `scanSource` | `POST …/scan-source` | 4 |
| `scanItem` | `POST …/scan-item` | 5 |
| `selectPackage` | `POST …/package` | 6 |
| `saveMeasurements` | `POST …/measurements` | 7 |
| `seal` | `POST …/seal` | 8 |
| `verifyLabel` (with `physicalEvidence`) | `POST /shipments/:shipmentId/label/verify` | 9 |
| `stageOutbound` | `POST /shipments/:shipmentId/outbound-stage` | 10 |
| (task creation) | internal, after picking | 1 |

Route responsibilities: resolve `p_auth_session_id` from the cookie; pass the `Idempotency-Key` header as `p_idempotency_key`; pass `X-Request-ID` and `X-Correlation-ID`. Note that `claim`, `selectPackage`, `saveMeasurements` and `seal` in `packShipApi.ts` currently mint a **new** key per call, so a retry after a lost response is not idempotent. They should reuse the operation's key, the way the scan calls do.

## 7. Schema changes in V0.2 (one governed migration)

- New tables: `warehouse.packship_operations` (the idempotency ledger, append-only) and `warehouse.packship_label_pairs` (the physical label pair: both scan events, both client operation and correlation ids, capture source).
- `row_version` bump triggers on `packing_tasks`, `packing_task_items`, `packing_task_claims` and `packages`, plus an `updated_at` trigger on `packing_tasks`.
- Functions 1–11; roles `tcds_packship_api` and `tcds_packship_system`.
- `REVOKE EXECUTE … FROM PUBLIC` on the old `complete_packing_task` and `verify_label_and_stage_outbound`. Also on the `warehouse_control` definer functions that are executable by PUBLIC today: `record_barcode_scan`, `issue_barcode`, `enqueue_print_job`, `claim_print_jobs`, `accept_scale_measurement`, `record_scale_measurement`, `record_asset_heartbeat` and `record_activity`.

## 8. Open questions

1. **Pilot hardware.** Is there a scale and a label printer? Without a scale, weight is manual with a supervisor override (function 7). Without a printer flow, there is no print job for function 9 to verify against. Should function 9 then accept a label with no print job?
2. **What is the source barcode** (PACK_SOURCE): the packing task's own TCDS label, the pick tote, or the staging location? The draft accepts the task label or the location holding all of the task's items.
3. **Task creation.** Who creates tasks (picking completion or a supervisor)? Which `order_status` and item statuses count as packable?
4. **Permission name.** Which `roles.permissions` value allows packing (for example `PACKSHIP_PACK`)?
5. **API login role.** Which database login role does your Pack/Ship API connect as?
6. **Shipping handoff.** Which service writes `shipping_handoffs` (with `shipment_id` and `tracking_number`) after label purchase?
