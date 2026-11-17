"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.captureFromBody = captureFromBody;
exports.captureFromLabelEvidence = captureFromLabelEvidence;
const PackShipPrincipalResolver_1 = require("../auth/PackShipPrincipalResolver");
const SOURCES = new Set(["CAMERA", "MANUAL", "HID"]);
const CANONICAL = new Set(["CODE128", "EAN13_UPCA", "QR"]);
const EXACT = new Set(["CODE128", "EAN13", "UPC_A", "QR", "CODE39", "DATAMATRIX", "EAN8", "GS1_128", "ITF14", "PDF417", "UPC_E"]);
function captureFromBody(body) {
    if (!body || typeof body !== "object" || Array.isArray(body))
        throw (0, PackShipPrincipalResolver_1.routeError)(422, "PACKSHIP_INPUT_INVALID");
    const c = body.capture;
    // Absence is a genuinely unknown source; never invent MANUAL from an absent capture.
    if (c === undefined || c === null)
        return {};
    if (typeof c !== "object" || Array.isArray(c))
        throw (0, PackShipPrincipalResolver_1.routeError)(422, "PACKSHIP_INPUT_INVALID");
    const x = c;
    if (!SOURCES.has(x.source))
        throw (0, PackShipPrincipalResolver_1.routeError)(422, "PACKSHIP_CAPTURE_INVALID");
    if (x.canonicalSymbology !== undefined && !CANONICAL.has(x.canonicalSymbology))
        throw (0, PackShipPrincipalResolver_1.routeError)(422, "PACKSHIP_CAPTURE_INVALID");
    if (x.symbology !== undefined && !EXACT.has(x.symbology))
        throw (0, PackShipPrincipalResolver_1.routeError)(422, "PACKSHIP_CAPTURE_INVALID");
    if (x.source === "CAMERA" && (typeof x.observationId !== "string" || !x.observationId ||
        typeof x.provider !== "string" || !x.provider.trim() || x.provider.length > 128 ||
        typeof x.capturedAt !== "string" || !Number.isFinite(Date.parse(x.capturedAt)) ||
        !CANONICAL.has(x.canonicalSymbology)))
        throw (0, PackShipPrincipalResolver_1.routeError)(422, "PACKSHIP_CAPTURE_INVALID");
    if (x.observationId !== undefined && (typeof x.observationId !== "string" || x.observationId.length > 160))
        throw (0, PackShipPrincipalResolver_1.routeError)(422, "PACKSHIP_CAPTURE_INVALID");
    if (x.capturedAt !== undefined && (typeof x.capturedAt !== "string" || !Number.isFinite(Date.parse(x.capturedAt))))
        throw (0, PackShipPrincipalResolver_1.routeError)(422, "PACKSHIP_CAPTURE_INVALID");
    if (x.captureDurationMs !== undefined && (typeof x.captureDurationMs !== "number" || !Number.isFinite(x.captureDurationMs) || x.captureDurationMs < 0))
        throw (0, PackShipPrincipalResolver_1.routeError)(422, "PACKSHIP_CAPTURE_INVALID");
    if (Object.keys(x).some(k => !["source", "symbology", "canonicalSymbology", "provider", "observationId", "capturedAt", "captureDurationMs"].includes(k)))
        throw (0, PackShipPrincipalResolver_1.routeError)(422, "PACKSHIP_CAPTURE_INVALID");
    return Object.fromEntries(Object.entries(x).filter(([k]) => ["source", "symbology", "canonicalSymbology", "provider", "observationId", "capturedAt", "captureDurationMs"].includes(k)));
}
function captureFromLabelEvidence(body) {
    const c = captureFromBody(body);
    const pair = body?.physicalEvidence;
    if (pair !== undefined && pair !== null) {
        if (typeof pair !== "object" || Array.isArray(pair) || !pair.tracking || !pair.package ||
            typeof pair.tracking !== "object" || typeof pair.package !== "object")
            throw (0, PackShipPrincipalResolver_1.routeError)(422, "PACKSHIP_CAPTURE_INVALID");
        const a = pair.tracking.observationId, b = pair.package.observationId;
        if (typeof a !== "string" || !a || typeof b !== "string" || !b || a === b)
            throw (0, PackShipPrincipalResolver_1.routeError)(422, "PACKSHIP_CAPTURE_INVALID");
    }
    return c;
}
