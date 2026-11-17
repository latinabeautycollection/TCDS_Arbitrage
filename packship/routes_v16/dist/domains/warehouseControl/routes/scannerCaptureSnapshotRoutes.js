"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildScannerCaptureSnapshotRoutes = buildScannerCaptureSnapshotRoutes;
const express_1 = require("express");
function buildScannerCaptureSnapshotRoutes(input) {
    const r = (0, express_1.Router)();
    r.get("/api/v1/warehouse-control/scanner/capture-snapshot", async (req, res, next) => {
        try {
            const principal = await input.principalResolver.resolve(req, res, {
                requireCsrf: false, requiredPermission: "PACKSHIP_PACK",
                allowedAssuranceLevels: input.allowedAssuranceLevels
            });
            res.setHeader("Cache-Control", "no-store");
            res.json(await input.captureAuthority.loadSnapshot(principal));
        }
        catch (e) {
            next(e);
        }
    });
    return r;
}
