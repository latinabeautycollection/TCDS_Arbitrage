import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import type { ShippingCustodyService } from '../services/shippingCustodyService';
import { principalOf } from '../../auth/forensicAuthorization';
import { resolveCorrelationId } from '../../../../lib/http/correlationId';
import { requireUuidRouteParam } from '../../../../lib/http/routeParams';

export function createShippingCustodyRouter(
  service: ShippingCustodyService,
): Router {
  const router = Router();

  router.get('/:linkId', async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      res.json({
        ok: true,
        data: await service.get(
          principalOf(req),
          requireUuidRouteParam(req, 'linkId'),
        ),
      });
    } catch (error) { next(error); }
  });

  router.post('/:linkId/evaluate', async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const correlationId = resolveCorrelationId(req);
      const body = z.object({
        idempotencyKey: z.string().min(8).max(250),
      }).parse(req.body);
      const data = await service.evaluate(
        principalOf(req),
        requireUuidRouteParam(req, 'linkId'),
        body.idempotencyKey,
        correlationId,
      );
      res.status(data.result === 'PASSED' ? 200 : 409).json({
        ok: data.result === 'PASSED',
        data,
      });
    } catch (error) { next(error); }
  });

  return router;
}
