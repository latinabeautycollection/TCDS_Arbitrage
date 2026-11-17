"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WRONG_SCAN_CODES = exports.PackShipRouteService = void 0;
const PackShipPrincipalResolver_1 = require("../auth/PackShipPrincipalResolver");
class PackShipRouteService {
    repo;
    mapper;
    constructor(repo, mapper) {
        this.repo = repo;
        this.mapper = mapper;
    }
    async mapResult(result, expected) {
        // A wrong scan is a normal outcome, already recorded by the database as evidence (row version unchanged).
        // 422 makes PR #13 classify it as REJECTED ("scan again"), never UNCERTAIN (5xx) or CONFLICT (409).
        if (result && result.ok === false && typeof result.code === "string" &&
            Object.prototype.hasOwnProperty.call(exports.WRONG_SCAN_CODES, result.code)) {
            throw (0, PackShipPrincipalResolver_1.routeError)(422, exports.WRONG_SCAN_CODES[result.code]);
        }
        if (!result || result.ok !== true) {
            const code = typeof result?.code === "string" && /^PACKSHIP_[A-Z0-9_]+$/.test(result.code)
                ? result.code : "PACKSHIP_BACKEND_REJECTED";
            throw (0, PackShipPrincipalResolver_1.routeError)(backendHttpStatus(code), code);
        }
        if (!result.task)
            throw (0, PackShipPrincipalResolver_1.routeError)(502, "PACKSHIP_TASK_SNAPSHOT_MISSING");
        if (expected?.taskId && result.task.packingTaskId !== expected.taskId)
            throw (0, PackShipPrincipalResolver_1.routeError)(502, "PACKSHIP_CROSS_TASK_RESPONSE");
        if (expected?.shipmentId && result.task.shipment?.shipmentId !== expected.shipmentId)
            throw (0, PackShipPrincipalResolver_1.routeError)(502, "PACKSHIP_CROSS_SHIPMENT_RESPONSE");
        return this.mapper.map(result.task);
    }
    getTask(authSessionId, taskId) { return this.repo.getTask(authSessionId, taskId).then(r => this.mapResult(r, { taskId })); }
    claim(authSessionId, taskId, op) { return this.repo.claim(authSessionId, taskId, op).then(r => this.mapResult(r, { taskId })); }
    verifySource(input) { return this.repo.verifySource(input).then(r => this.mapResult(r, { taskId: input.taskId })); }
    verifyItem(input) { return this.repo.verifyItem(input).then(r => this.mapResult(r, { taskId: input.taskId })); }
    selectPackage(input) { return this.repo.selectPackage(input).then(r => this.mapResult(r, { taskId: input.taskId })); }
    recordMeasurements(input) { return this.repo.recordMeasurements(input).then(r => this.mapResult(r, { taskId: input.taskId })); }
    complete(input) { return this.repo.complete(input).then(r => this.mapResult(r, { taskId: input.taskId })); }
    verifyLabel(input) { return this.repo.verifyLabel(input).then(r => this.mapResult(r, { shipmentId: input.shipmentId })); }
    stageOutbound(input) { return this.repo.stageOutbound(input).then(r => this.mapResult(r, { shipmentId: input.shipmentId })); }
}
exports.PackShipRouteService = PackShipRouteService;
/** V0.2 ok:false scan outcomes → PR #13 message-catalog codes. The three marked NEW need catalog entries in the PWA. */
exports.WRONG_SCAN_CODES = {
    WRONG_ITEM: "PACK_WRONG_SERIALIZED_ITEM",
    ITEM_ALREADY_VERIFIED: "PACK_DUPLICATE_SCAN",
    TRACKING_MISMATCH: "SHIP_TRACKING_MISMATCH",
    WRONG_SOURCE: "PACK_WRONG_SOURCE", // NEW catalog entry
    PACKAGE_MISMATCH: "SHIP_PACKAGE_LABEL_MISMATCH", // NEW catalog entry
    WRONG_LOCATION: "PACK_WRONG_OUTBOUND_LOCATION", // NEW catalog entry
};
function backendHttpStatus(code) {
    if (code.includes("NOT_FOUND"))
        return 404;
    if (code.includes("FACILITY_MISMATCH") || code.includes("ACTOR_NOT_ALLOWED"))
        return 403;
    if (code.includes("SESSION_INVALID"))
        return 401;
    if (code.includes("INPUT_INVALID") || code.includes("IDEMPOTENCY_KEY_REUSED"))
        return 422;
    return 409;
}
