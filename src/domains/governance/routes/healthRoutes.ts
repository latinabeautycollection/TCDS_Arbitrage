import { randomUUID } from "node:crypto";
import { Router, type NextFunction, type Request, type RequestHandler, type Response } from "express";
import type { AuthenticatedHealthPrincipal } from "../models/healthTypes";
import type { HealthMetrics } from "../observability/healthMetrics";
import { HealthQueryRepository } from "../repositories/healthQueryRepository";
import { HealthObservationService } from "../services/healthObservationService";
import { assertHealthPrincipal, assertUuid, parseCorrelationId, parsePushHealthSignal } from "../validators/healthValidators";

export interface HealthRouteDependencies {
  authorizeRead: RequestHandler;
  authorizeWrite: RequestHandler;
  resolvePrincipal: (req: Request) => AuthenticatedHealthPrincipal;
  observations: HealthObservationService;
  queries: HealthQueryRepository;
  metrics: HealthMetrics;
}

export function createHealthRoutes(deps: HealthRouteDependencies): Router {
  const router = Router();
  router.get("/governance/health/registry", deps.authorizeRead, async (_req: Request, res: Response, next: NextFunction) => {
    try { res.json({ items: await deps.queries.listRegistry() }); } catch (e) { next(e); }
  });
  router.get("/governance/health/components/:componentId", deps.authorizeRead, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const componentId = String(req.params.componentId ?? "");
      assertUuid(componentId, "componentId");
      const item = await deps.queries.getComponentHealth(componentId);
      if (!item) { res.status(404).json({ error: "COMPONENT_NOT_FOUND" }); return; }
      res.json(item);
    } catch (e) { next(e); }
  });
  router.get("/governance/health/dependencies", deps.authorizeRead, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const componentId = typeof req.query.componentId === "string" ? req.query.componentId : undefined;
      if (componentId) assertUuid(componentId, "componentId");
      res.json({ items: await deps.queries.listDependencies(componentId) });
    } catch (e) { next(e); }
  });
  router.get("/governance/health/metrics", deps.authorizeRead, (_req: Request, res: Response) => { res.json(deps.metrics.snapshot()); });
  router.post("/governance/health/observations", deps.authorizeWrite, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const signal = parsePushHealthSignal(req.body);
      const principal = assertHealthPrincipal(deps.resolvePrincipal(req));
      const correlationId = parseCorrelationId(req.headers["x-correlation-id"]) ?? randomUUID();
      await deps.observations.recordPushSignal(signal, principal, correlationId);
      res.status(202).json({ accepted: true, correlationId });
    } catch (e) { next(e); }
  });
  return router;
}
