import {
  Router,
  type NextFunction,
  type Request,
  type Response,
} from 'express';
import { z } from 'zod';
import { ForensicApiError } from '../errors/ForensicApiError';
import type { ForensicRequestContext } from '../models/orchestrationTypes';
import { ForensicChainService } from '../services/forensicChainService';
import { ForensicOrchestrationRepository } from
  '../repositories/forensicOrchestrationRepository';
import { principalOf } from '../auth/forensicAuthorization';
import { resolveCorrelationId } from '../../../lib/http/correlationId';
import {
  requireRouteParam,
  requireUuidRouteParam,
} from '../../../lib/http/routeParams';

const idempotency = z.string().min(8).max(200);

function context(req: Request): ForensicRequestContext {
  return {
    principal: principalOf(req),
    correlationId: resolveCorrelationId(req),
  };
}

export function createForensicChainRouter(
  service: ForensicChainService,
  repo: ForensicOrchestrationRepository,
): Router {
  const router = Router();

  router.post('/chains', async (req, res, next) => {
    try {
      const body = z.object({
        chainType: z.string().min(1).max(80),
        policyVersionId: z.string().uuid().optional(),
        retentionPolicyId: z.string().uuid().optional(),
        metadata: z.record(z.string(), z.unknown()).default({}),
        idempotencyKey: idempotency,
      }).parse(req.body);
      res.status(201).json(await service.create(context(req), body));
    } catch (error) { next(error); }
  });

  router.get('/chains/:chainId', async (req, res, next) => {
    try {
      res.json(await service.get(
        context(req),
        requireUuidRouteParam(req, 'chainId'),
      ));
    } catch (error) { next(error); }
  });

  router.get('/chains/:chainId/timeline', async (req, res, next) => {
    try {
      res.json(await service.timeline(
        context(req),
        requireUuidRouteParam(req, 'chainId'),
      ));
    } catch (error) { next(error); }
  });

  router.post('/chains/:chainId/assess/:stage', async (req, res, next) => {
    try {
      res.json(await service.assess(
        context(req),
        requireUuidRouteParam(req, 'chainId'),
        requireRouteParam(req, 'stage', 80),
      ));
    } catch (error) { next(error); }
  });

  router.post('/chains/:chainId/transition', async (req, res, next) => {
    try {
      const body = z.object({
        toStage: z.string().min(1).max(80),
        idempotencyKey: idempotency,
      }).parse(req.body);
      res.json(await service.transition(
        context(req),
        requireUuidRouteParam(req, 'chainId'),
        body,
      ));
    } catch (error) { next(error); }
  });

  router.post('/chains/:chainId/manifests', async (req, res, next) => {
    try {
      const body = z.object({
        manifestType: z.string().min(1).max(100),
        idempotencyKey: idempotency,
      }).parse(req.body);
      res.status(202).json(await service.requestManifest(
        context(req),
        requireUuidRouteParam(req, 'chainId'),
        body,
      ));
    } catch (error) { next(error); }
  });

  router.get('/health', (_req, res) => {
    res.json({ status: 'ok', domain: 'forensic', slice: '7A.3-R3' });
  });

  router.get('/ready', async (_req, res, next) => {
    try {
      const checks = await repo.readiness();
      const ready = Boolean(checks.active_policy && checks.a1 && checks.a2);
      res.status(ready ? 200 : 503).json({
        status: ready ? 'ready' : 'not_ready',
        checks,
      });
    } catch (error) { next(error); }
  });

  return router;
}

export function forensicErrorMiddleware(
  error: unknown,
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (error instanceof z.ZodError) {
    res.status(400).json({
      error: 'VALIDATION_FAILED',
      details: error.issues,
    });
    return;
  }
  if (error instanceof ForensicApiError) {
    res.status(error.statusCode).json({
      error: error.code,
      message: error.message,
      details: error.details,
    });
    return;
  }
  const status = typeof (error as { status?: unknown })?.status === 'number'
    ? Number((error as { status: number }).status)
    : undefined;
  if (status) {
    res.status(status).json({
      error: String((error as { code?: unknown }).code ?? 'DOMAIN7_ERROR'),
      message: error instanceof Error ? error.message : String(error),
    });
    return;
  }
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('idempotency key payload conflict')) {
    res.status(409).json({ error: 'IDEMPOTENCY_CONFLICT', message });
    return;
  }
  if (message.includes('chain not found')) {
    res.status(404).json({ error: 'CHAIN_NOT_FOUND', message });
    return;
  }
  next(error);
}
