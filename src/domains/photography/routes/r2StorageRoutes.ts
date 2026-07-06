import { Router } from 'express';
import type { Pool } from 'pg';
import type { S3Client } from '@aws-sdk/client-s3';
import { R2CostAnalyticsService } from '../services/r2CostAnalyticsService';
import { R2PrivateAccessService } from '../services/r2PrivateAccessService';
import { listR2Guardrails } from '../storage/r2Guardrails';

export function createR2StorageRoutes(pool: Pool, s3: S3Client): Router {
  const router = Router();

  router.get('/photography/r2/cost/current', async (_req, res, next) => {
    try { res.json(await new R2CostAnalyticsService(pool).currentSummary()); } catch (e) { next(e); }
  });

  router.post('/photography/r2/private-url', async (req, res, next) => {
    try {
      const service = new R2PrivateAccessService(s3, pool);
      const url = await service.createSignedReviewUrl({
        bucketName: req.body.bucketName,
        objectKey: req.body.objectKey,
        actorId: req.body.actorId,
        actorName: req.body.actorName,
        purpose: req.body.purpose ?? 'review',
        expiresSeconds: req.body.expiresSeconds ?? 900,
        requestId: req.headers['x-request-id']?.toString(),
      });
      res.json({ url, expiresSeconds: Math.min(req.body.expiresSeconds ?? 900, 3600) });
    } catch (e) { next(e); }
  });

  router.get('/photography/r2/guardrails', (_req, res) => res.json({ unsupportedFeatures: listR2Guardrails() }));

  router.get('/photography/r2/ready', async (_req, res, next) => {
    try {
      const result = await pool.query(`SELECT count(*)::int AS objects FROM arb.r2_object_registry`);
      res.json({ ok: true, registryObjects: result.rows[0].objects, version: 'domain5-r2-v4.0.0' });
    } catch (e) { next(e); }
  });

  return router;
}
