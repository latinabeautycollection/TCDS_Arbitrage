import type { Request, Response, Router } from 'express';
import { Router as createRouter } from 'express';
import type { Logger } from '../services/logger';
import { MetricsService } from '../services/metricsService';

export function createMetricsRouter(input: {
  metricsService: MetricsService;
  logger: Logger;
}): Router {
  const router = createRouter();

  router.get('/metrics', async (_req: Request, res: Response) => {
    try {
      const body = await input.metricsService.buildPrometheusText();
      res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
      res.status(200).send(body);
    } catch (error) {
      input.logger.error('metrics endpoint failed', {
        component: 'metricsRoute',
        operation: 'GET /metrics',
        error: error instanceof Error
          ? { name: error.name, message: error.message, stack: error.stack }
          : { value: String(error) },
      });

      res.status(503).type('text/plain').send('metrics_collection_failed\n');
    }
  });

  return router;
}
