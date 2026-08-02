import { Router, type Request, type Response, type NextFunction } from 'express';
import type { DeliveryEvidenceService } from '../services/deliveryEvidenceService';
import { principalOf } from '../../auth/forensicAuthorization';
import { requireUuidRouteParam } from '../../../../lib/http/routeParams';

export function createDeliveryEvidenceRouter(
  service: DeliveryEvidenceService,
): Router {
  const router = Router();

  router.post('/:linkId/reconcile', async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      res.json({
        ok: true,
        data: await service.reconcile(
          principalOf(req),
          requireUuidRouteParam(req, 'linkId'),
        ),
      });
    } catch (error) { next(error); }
  });

  router.post('/:linkId/assess', async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const data = await service.assess(
        principalOf(req),
        requireUuidRouteParam(req, 'linkId'),
      );
      res.status(data.result === 'BLOCKED' ? 409 : 200).json({
        ok: data.result !== 'BLOCKED',
        data,
      });
    } catch (error) { next(error); }
  });

  return router;
}
