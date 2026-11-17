"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PROGRESS_BLOCKERS = exports.PackShipTaskResponseMapper = void 0;
exports.mapSnapshot = mapSnapshot;
const packShipRouteTypes_1 = require("../contracts/packShipRouteTypes");
const PackShipPrincipalResolver_1 = require("../auth/PackShipPrincipalResolver");
/**
 * Pure translation of the V0.2.1 task snapshot into the PWA PackShipTask shape.
 * No database access: every fact comes from warehouse.packship__snapshot, so the mapper works under the
 * least-privileged tcds_packship_api role, which has no table access. Never converts absent evidence into a
 * positive business claim.
 */
class PackShipTaskResponseMapper {
    async map(snapshot) {
        return mapSnapshot(snapshot);
    }
}
exports.PackShipTaskResponseMapper = PackShipTaskResponseMapper;
/** packship__blockers codes that only mean "this step has not been done yet". Everything else is a problem. */
exports.PROGRESS_BLOCKERS = new Set([
    "SOURCE_UNVERIFIED", "ITEMS_UNVERIFIED", "PACKAGE_MISSING", "WEIGHT_MISSING", "DIMENSIONS_MISSING", "EVIDENCE_PENDING",
]);
function mapSnapshot(snapshot) {
    validateSnapshot(snapshot);
    const s = snapshot;
    const blocker = new Set(s.blockers);
    const items = s.items.map(i => ({
        itemId: i.itemId, internalBarcode: i.expectedBarcode ?? "",
        title: typeof i.title === "string" && i.title.trim() ? i.title : "Product description unavailable",
        quantity: i.expectedQuantity,
        verified: ["VERIFIED", "PACKED"].includes(i.status) && i.expectedQuantity > 0 && i.verifiedQuantity === i.expectedQuantity,
    }));
    const itemVerified = items.length > 0 && items.every(i => i.verified);
    const packaged = !!s.package && s.package.status !== "VOIDED";
    const measured = packaged && [s.package?.weightOz, s.package?.lengthIn, s.package?.widthIn, s.package?.heightIn]
        .every(v => typeof v === "number" && Number.isFinite(v) && v > 0);
    const ev = s.evidence;
    // Mirrors packship__blockers: EVIDENCE_PENDING is raised only when a blocking requirement is not accepted, so a task
    // with no requirements completes. With requirements, every one must be accepted and integrity-verified; with none,
    // it passes only once the task has reached the evidence step, never before.
    const reachedEvidenceStep = ["EVIDENCE_PENDING", "PACKED", "SHIPPING_REVIEW", "LABEL_PENDING", "LABEL_PURCHASED",
        "PRINTING", "LABEL_VERIFIED", "OUTBOUND_STAGED"].includes(s.status);
    const evidencePassed = !blocker.has("EVIDENCE_PENDING") && ev.rejected === 0 && (ev.requirementCount > 0
        ? ev.required > 0 && ev.pending === 0 && ev.accepted >= ev.required && ev.integrityVerified === true
        : reachedEvidenceStep);
    // packship__blockers mixes "this step is not done yet" with real problems. Only problems are FAIL; progress
    // blockers show PENDING, so a fresh task is not painted red. Any blocker code not listed here is treated as a
    // problem (fail closed: it can never look harmless).
    const problems = [...blocker].filter(b => !exports.PROGRESS_BLOCKERS.has(b));
    const itemProblem = blocker.has("ITEM_NOT_PACKABLE") || blocker.has("ITEM_ON_HOLD");
    const gate = (code, label, pass, failed, stage) => ({
        code, label, state: failed ? "FAIL" : pass ? "PASS" : "PENDING", blocking: true, stage,
    });
    const labelVerified = s.status === "LABEL_VERIFIED" || s.status === "OUTBOUND_STAGED";
    // OUTBOUND mirrors warehouse.packship_stage_outbound_v2's own precondition (status LABEL_VERIFIED, claim held by
    // this session, no blockers). The database still enforces it on the call; this only tells the PWA it may try.
    const outboundAllowed = s.status === "OUTBOUND_STAGED" ||
        (s.status === "LABEL_VERIFIED" && s.claim?.heldBySession === true && blocker.size === 0);
    const gates = [
        gate("CONTENTS", "Contents verified", itemVerified && !itemProblem, itemProblem, "CONTENTS"),
        gate("MEASUREMENTS", "Measurements complete", measured, false, "MEASUREMENTS"),
        gate("EVIDENCE", "Evidence accepted", evidencePassed, ev.rejected > 0, "EVIDENCE"),
        gate("LABEL", "Carrier label verified", labelVerified, false, "LABEL"),
        gate("OUTBOUND", "Ready for outbound staging", outboundAllowed, problems.length > 0, "OUTBOUND"),
    ];
    if (blocker.has("EXCEPTION_OPEN"))
        for (const g of gates)
            if (g.state === "PASS")
                g.state = "FAIL";
    const sealed = ["PACKED", "SHIPPING_REVIEW", "LABEL_PENDING", "LABEL_PURCHASED", "PRINTING", "LABEL_VERIFIED",
        "OUTBOUND_STAGED"].includes(s.status);
    return {
        taskId: s.packingTaskId, taskNumber: s.taskNumber, orderId: s.fulfillmentOrderId,
        orderNumber: s.order?.externalOrderId ?? s.fulfillmentOrderId,
        ...(s.shipment?.shipmentId ? { shipmentId: s.shipment.shipmentId } : {}),
        facilityCode: s.facility.facilityCode, stationCode: s.station?.stationCode ?? "UNASSIGNED",
        employeeName: "Assigned operator", claimExpiresAt: s.claim?.expiresAt ?? "",
        ...(s.carrierCutoffAt ? { carrierCutoffAt: s.carrierCutoffAt } : {}),
        rowVersion: s.rowVersion,
        stage: mapStage(s.status), sourceBarcode: "", sourceVerified: s.sourceVerified,
        items,
        ...(s.package ? { packageId: s.package.packageId, packageRowVersion: s.package.rowVersion } : {}),
        ...(s.package?.packageNumber ? { packageBarcode: s.package.packageNumber } : {}),
        itemLabelStatus: "ACTIVE_PENDING_PRINT",
        measurement: {
            ...(s.package?.lengthIn != null ? { lengthIn: s.package.lengthIn } : {}),
            ...(s.package?.widthIn != null ? { widthIn: s.package.widthIn } : {}),
            ...(s.package?.heightIn != null ? { heightIn: s.package.heightIn } : {}),
            ...(s.package?.weightOz != null ? { weightLb: s.package.weightOz / 16 } : {}),
            source: measured ? "MEASURED" : "PENDING", stable: measured,
        },
        evidence: { required: ev.required, accepted: ev.accepted, pending: ev.pending, rejected: ev.rejected,
            integrityVerified: ev.integrityVerified },
        sealed,
        address: { status: "NOT_STARTED" },
        protection: { declaredValue: 0, insuranceRequired: false, deliveryConfirmationRequired: false,
            signatureRequired: false, restrictedDeliveryRequired: false, routing: "PENDING", reasons: [] },
        rates: [],
        carrierLabel: {
            status: mapCarrierLabel(s.status, s.shipment?.trackingPresent === true, s.printJob?.status),
            ...(s.shipment?.carrierCode ? { carrier: s.shipment.carrierCode } : {}),
            ...(s.package?.packageNumber ? { packageBarcode: s.package.packageNumber } : {}),
        },
        readiness: { api: "UNKNOWN", postgres: "UNKNOWN", scanner: "UNKNOWN", scale: "UNKNOWN",
            printer: "UNKNOWN", gateway: "UNKNOWN", network: "UNKNOWN" },
        completionGates: gates, localPendingCount: 0, lastUpdatedAt: new Date().toISOString(),
        operationalMessages: [],
    };
}
function validateSnapshot(s) {
    if (!s || typeof s.packingTaskId !== "string" || !s.packingTaskId ||
        typeof s.fulfillmentOrderId !== "string" || !s.fulfillmentOrderId ||
        typeof s.facilityId !== "string" || !s.facilityId ||
        !Number.isSafeInteger(s.rowVersion) || s.rowVersion < 0 || !Array.isArray(s.items) || !Array.isArray(s.blockers) ||
        typeof s.sourceVerified !== "boolean" ||
        !s.items.every(i => Number.isSafeInteger(i.expectedQuantity) && i.expectedQuantity >= 0 && Number.isSafeInteger(i.verifiedQuantity)))
        throw (0, PackShipPrincipalResolver_1.routeError)(502, "PACKSHIP_SNAPSHOT_INVALID");
    // A replayed result stored before V0.2.1 lacks the fields below; refuse it rather than render guesses.
    if (s.snapshotVersion !== packShipRouteTypes_1.PACKSHIP_SNAPSHOT_VERSION)
        throw (0, PackShipPrincipalResolver_1.routeError)(502, "PACKSHIP_SNAPSHOT_VERSION_UNSUPPORTED");
    if (!s.facility || typeof s.facility.facilityCode !== "string" || !s.facility.facilityCode)
        throw (0, PackShipPrincipalResolver_1.routeError)(502, "PACKSHIP_METADATA_MISSING");
    if (!s.order)
        throw (0, PackShipPrincipalResolver_1.routeError)(502, "PACKSHIP_METADATA_MISSING");
    // The snapshot returns station only when it is in the task's facility.
    if (s.assignedStationId && !s.station)
        throw (0, PackShipPrincipalResolver_1.routeError)(409, "PACKSHIP_STATION_MISMATCH");
    const e = s.evidence;
    if (!e || ![e.requirementCount, e.required, e.accepted, e.pending, e.rejected].every(n => Number.isSafeInteger(n) && n >= 0) ||
        typeof e.integrityVerified !== "boolean")
        throw (0, PackShipPrincipalResolver_1.routeError)(502, "PACKSHIP_SNAPSHOT_INVALID");
    mapStage(s.status);
}
function mapStage(status) {
    const m = { READY: "CONTENTS", CLAIMED: "CONTENTS", CONTENTS_VERIFYING: "CONTENTS", PACKING: "PACKAGING",
        MEASURING: "MEASUREMENTS", EVIDENCE_PENDING: "EVIDENCE", PACKED: "SEALED", SHIPPING_REVIEW: "ADDRESS",
        LABEL_PENDING: "CARRIER_LABEL", LABEL_PURCHASED: "CARRIER_LABEL", PRINTING: "CARRIER_LABEL",
        LABEL_VERIFIED: "OUTBOUND", OUTBOUND_STAGED: "OUTBOUND" };
    if (!Object.prototype.hasOwnProperty.call(m, status))
        throw (0, PackShipPrincipalResolver_1.routeError)(502, "PACKSHIP_STATUS_UNKNOWN");
    return m[status];
}
/**
 * PRINTED only when the print gateway reported the label job printed (PRINTED / VERIFICATION_PENDING / VERIFIED);
 * a queued, spooling or failed job is not printed paper. SCAN_VERIFIED only from the task status, which the database
 * sets after a verified physical label pair. Values are PR #13's CarrierLabelState.status union.
 */
function mapCarrierLabel(status, tracking, printStatus) {
    if (status === "LABEL_VERIFIED" || status === "OUTBOUND_STAGED")
        return "SCAN_VERIFIED";
    if (tracking && printStatus) {
        if (["PRINTED", "VERIFICATION_PENDING", "VERIFIED"].includes(printStatus))
            return "PRINTED";
        if (printStatus === "PRINTING")
            return "PRINTING";
        if (["CREATED", "QUEUED", "CLAIMED", "SPOOLING"].includes(printStatus))
            return "PRINT_QUEUED";
        // FAILED / CANCELLED / DEAD_LETTER: purchased but not printed; the PWA must reprint.
    }
    if (status === "PRINTING")
        return "PRINTING";
    if (status === "LABEL_PURCHASED" || tracking)
        return "LABEL_PURCHASED";
    return "NOT_PURCHASED";
}
