"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildPackShipRoutes = buildPackShipRoutes;
const express_1 = require("express");
const operationHeaders_1 = require("../http/operationHeaders");
const captureEvidence_1 = require("../services/captureEvidence");
const requestValidation_1 = require("../http/requestValidation");
function buildPackShipRoutes(input) {
    const r = (0, express_1.Router)();
    r.get("/api/v1/packing/tasks/:taskId", async (req, res, next) => {
        try {
            const p = await input.principalResolver.resolve(req, res, false);
            (0, requestValidation_1.validatePackShipRequest)(req, "getTask");
            res.setHeader("Cache-Control", "no-store");
            res.json(await input.service.getTask(p.authSessionId, req.params.taskId));
        }
        catch (e) {
            next(e);
        }
    });
    // V0.2.2: the boxes this task may use (eligibility enforced again by POST .../package). Read-only, no CSRF.
    r.get("/api/v1/packing/tasks/:taskId/packaging-options", async (req, res, next) => {
        try {
            const p = await input.principalResolver.resolve(req, res, false);
            (0, requestValidation_1.validatePackShipRequest)(req, "packagingOptions");
            res.setHeader("Cache-Control", "no-store");
            res.json(await input.service.listPackagingOptions(p.authSessionId, req.params.taskId));
        }
        catch (e) {
            next(e);
        }
    });
    r.post("/api/v1/packing/tasks/:taskId/completion-check", async (req, res, next) => {
        try {
            const p = await input.principalResolver.resolve(req, res, true);
            (0, requestValidation_1.validatePackShipRequest)(req, "completionCheck");
            res.setHeader("Cache-Control", "no-store");
            res.json(await input.service.getTask(p.authSessionId, req.params.taskId));
        }
        catch (e) {
            next(e);
        }
    });
    r.post("/api/v1/packing/tasks/:taskId/claim", async (req, res, next) => {
        try {
            const p = await input.principalResolver.resolve(req, res, true);
            (0, requestValidation_1.validatePackShipRequest)(req, "claim");
            res.json(await input.service.claim(p.authSessionId, req.params.taskId, (0, operationHeaders_1.requireOperationHeaders)(req)));
        }
        catch (e) {
            next(e);
        }
    });
    r.post("/api/v1/packing/tasks/:taskId/scan-source", async (req, res, next) => {
        try {
            const p = await input.principalResolver.resolve(req, res, true);
            (0, requestValidation_1.validatePackShipRequest)(req, "scanSource");
            res.json(await input.service.verifySource({
                authSessionId: p.authSessionId, taskId: req.params.taskId, rowVersion: req.body.rowVersion,
                barcode: req.body.barcode, capture: (0, captureEvidence_1.captureFromBody)(req.body), op: (0, operationHeaders_1.requireOperationHeaders)(req)
            }));
        }
        catch (e) {
            next(e);
        }
    });
    r.post("/api/v1/packing/tasks/:taskId/scan-item", async (req, res, next) => {
        try {
            const p = await input.principalResolver.resolve(req, res, true);
            (0, requestValidation_1.validatePackShipRequest)(req, "scanItem");
            res.json(await input.service.verifyItem({
                authSessionId: p.authSessionId, taskId: req.params.taskId, rowVersion: req.body.rowVersion,
                barcode: req.body.barcode, capture: (0, captureEvidence_1.captureFromBody)(req.body), op: (0, operationHeaders_1.requireOperationHeaders)(req)
            }));
        }
        catch (e) {
            next(e);
        }
    });
    r.post("/api/v1/packing/tasks/:taskId/package", async (req, res, next) => {
        try {
            const p = await input.principalResolver.resolve(req, res, true);
            (0, requestValidation_1.validatePackShipRequest)(req, "selectPackage");
            res.json(await input.service.selectPackage({
                authSessionId: p.authSessionId, taskId: req.params.taskId, rowVersion: req.body.rowVersion,
                profileId: req.body.profileId, reason: req.body.reason, op: (0, operationHeaders_1.requireOperationHeaders)(req)
            }));
        }
        catch (e) {
            next(e);
        }
    });
    r.post("/api/v1/packing/tasks/:taskId/measurements", async (req, res, next) => {
        try {
            const p = await input.principalResolver.resolve(req, res, true);
            (0, requestValidation_1.validatePackShipRequest)(req, "recordMeasurements");
            res.json(await input.service.recordMeasurements({
                authSessionId: p.authSessionId, taskId: req.params.taskId, taskRowVersion: req.body.rowVersion,
                packageId: req.body.packageId, packageRowVersion: req.body.packageRowVersion,
                weightOz: req.body.weightOz, lengthIn: req.body.lengthIn, widthIn: req.body.widthIn, heightIn: req.body.heightIn,
                weightSource: req.body.weightSource, op: (0, operationHeaders_1.requireOperationHeaders)(req)
            }));
        }
        catch (e) {
            next(e);
        }
    });
    r.post("/api/v1/packing/tasks/:taskId/seal", async (req, res, next) => {
        try {
            const p = await input.principalResolver.resolve(req, res, true);
            (0, requestValidation_1.validatePackShipRequest)(req, "complete");
            res.json(await input.service.complete({
                authSessionId: p.authSessionId, taskId: req.params.taskId, taskRowVersion: req.body.rowVersion,
                packageId: req.body.packageId, packageRowVersion: req.body.packageRowVersion,
                op: (0, operationHeaders_1.requireOperationHeaders)(req)
            }));
        }
        catch (e) {
            next(e);
        }
    });
    r.post("/api/v1/shipments/:shipmentId/label/verify", async (req, res, next) => {
        try {
            const p = await input.principalResolver.resolve(req, res, true);
            (0, requestValidation_1.validatePackShipRequest)(req, "verifyLabel");
            res.json(await input.service.verifyLabel({
                authSessionId: p.authSessionId, shipmentId: req.params.shipmentId,
                trackingBarcode: req.body.trackingBarcode, packageBarcode: req.body.packageBarcode,
                physicalEvidence: req.body.physicalEvidence, capture: (0, captureEvidence_1.captureFromLabelEvidence)(req.body),
                op: (0, operationHeaders_1.requireOperationHeaders)(req)
            }));
        }
        catch (e) {
            next(e);
        }
    });
    r.post("/api/v1/shipments/:shipmentId/outbound-stage", async (req, res, next) => {
        try {
            const p = await input.principalResolver.resolve(req, res, true);
            (0, requestValidation_1.validatePackShipRequest)(req, "stageOutbound");
            res.json(await input.service.stageOutbound({
                authSessionId: p.authSessionId, shipmentId: req.params.shipmentId,
                locationBarcode: req.body.locationBarcode, capture: (0, captureEvidence_1.captureFromBody)(req.body),
                op: (0, operationHeaders_1.requireOperationHeaders)(req)
            }));
        }
        catch (e) {
            next(e);
        }
    });
    return r;
}
