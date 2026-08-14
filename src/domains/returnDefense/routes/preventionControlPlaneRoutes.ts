import { Router } from "express";
import type { PreventionControlPlaneService } from "../services/preventionControlPlaneService";

function context(req: {
  header(name: string): string | undefined;
}) {
  const tenantId = req.header("x-tcds-tenant-id");
  const actorId = req.header("x-tcds-actor-id");
  const correlationId = req.header("x-correlation-id");
  if (!tenantId || !actorId || !correlationId) {
    throw new Error("Required TCDS context headers are missing");
  }
  return { tenantId, actorId, correlationId };
}

export function preventionControlPlaneRoutes(
  service: PreventionControlPlaneService,
): Router {
  const router = Router();

  router.post("/snapshots", async (req, res, next) => {
    try {
      res.status(201).json({
        featureSnapshotId: await service.createSnapshot(context(req), req.body),
      });
    } catch (error) { next(error); }
  });

  router.post("/assessments", async (req, res, next) => {
    try {
      res.status(201).json({
        riskAssessmentId: await service.assess(context(req), req.body),
      });
    } catch (error) { next(error); }
  });

  router.post("/decisions", async (req, res, next) => {
    try {
      res.status(201).json({
        preventionDecisionId: await service.decide(context(req), req.body),
      });
    } catch (error) { next(error); }
  });

  router.get("/passports/:passportId/gates/:gateStage/readiness",
    async (req, res, next) => {
      try {
        res.json({
          allowed: await service.canProgress(
            context(req), req.params.passportId!, req.params.gateStage!,
          ),
        });
      } catch (error) { next(error); }
    },
  );

  return router;
}
