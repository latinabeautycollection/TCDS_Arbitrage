# Pack/Ship: eligible packaging (contract `packship.packaging-options.v1`)

Backend V0.2.2, 2026-11-18. Owner: Praise. It serves the box choice for the Select Packaging control.

## Read the boxes a task may use

`GET /api/v1/packing/tasks/{taskId}/packaging-options`

This is a read, so it needs no CSRF header. The session cookie is enough, with the same `PACKSHIP_PACK`
permission as the task read. The response is never cached (`Cache-Control: no-store`).

```json
{
  "contractVersion": "packship.packaging-options.v1",
  "taskId": "…", "taskStatus": "PACKING", "taskRowVersion": 7,
  "selectable": true,
  "eligibilityRule": "PACKSHIP_PACKAGING_ELIGIBILITY_V1",
  "basis": { "itemCount": 1, "knownWeightOz": 10, "itemsWithoutWeight": 0, "categories": ["phones"], "itemsWithoutCategory": 0 },
  "options": [
    { "profileId": "uuid", "profileCode": "PSTEST-BOX-S", "profileName": "TEST small box", "version": 1,
      "packagingTypeCode": "BOX", "itemCategoryKey": null, "maximumWeightOz": null,
      "minimumLengthIn": null, "minimumWidthIn": null, "minimumHeightIn": null }
  ]
}
```

- **`selectable`** is `true` only when `POST …/package` would accept a choice right now: the task is `PACKING`, this session holds the claim, and no package exists yet. When it is `false`, show the list read-only.
- **`options`** may be empty, meaning no eligible box. Show that state; don't invent a box.

## Select one

`POST /api/v1/packing/tasks/{taskId}/package` (unchanged), with CSRF and the operation headers as for every write:

```json
{ "rowVersion": 7, "profileId": "<options[i].profileId>", "reason": "optional" }
```

The server applies the same rule again.

| Response | Meaning | PR #13 handling |
|---|---|---|
| 200 | Task snapshot, status `MEASURING`, `package.packageId` + `package.rowVersion` | continue to measurements |
| 409 `PACKSHIP_PACKAGING_NOT_ELIGIBLE` | that box is not eligible (stale list) | CONFLICT: reload task + options |
| 409 `PACKSHIP_PRECONDITION_FAILED` | box inactive/expired, or a package already exists | CONFLICT: reload |
| 409 `PACKSHIP_ROW_VERSION_CONFLICT` | task changed | CONFLICT: reload |

## The rule (`PACKSHIP_PACKAGING_ELIGIBILITY_V1`)

1. **In date:** the box is active and within its effective dates. Only the highest in-date version of each box code is offered.
2. **Weight:** the task's known item weight must not exceed the box's `maximumWeightOz`, when the box has one. Known weight is the item's actual weight, or else the product's expected weight, times the quantity. Items without a weight don't count, so a box is refused only when it is known to be too light.
3. **Category:** a box with an `itemCategoryKey` is offered only when every item has that category. An unknown category means the box isn't offered.
4. **Not used yet:** the box's minimum dimensions, because their meaning (interior size or minimum item size) isn't defined.

The chosen package records the rule name and the basis it was decided on.
