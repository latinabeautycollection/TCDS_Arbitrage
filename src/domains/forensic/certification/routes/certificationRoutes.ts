import { Router } from 'express';
import { z } from 'zod';
import type { CertificationService } from '../services/certificationService';

const uuid = z.uuid();
const evidence = z.record(z.string(), z.unknown());

export function createCertificationRoutes(service: CertificationService) {
  const router = Router();

  router.post('/certifications', async (req, res, next) => {
    try {
      const body = z.object({
        releaseCode: z.literal('DOMAIN7_COMPLETE_R5'),
        sourceCommit: z.string().min(7),
        environment: z.string().min(2),
        buildArtifactSha256: z.string().regex(/^[0-9a-f]{64}$/),
        idempotencyKey: uuid,
        processRunId: uuid,
      }).strict().parse(req.body);
      res.status(201).json(await service.startAndRun(req.accessPrincipal!, body));
    } catch (error) { next(error); }
  });

  router.post('/certifications/:id/installation-certificate', async (req, res, next) => {
    try {
      const body = z.object({
        databaseName: z.string().min(1),
        serverVersion: z.string().min(1),
        migrationManifest: evidence,
        buildReport: evidence,
        smokeReport: evidence,
        routeReport: evidence,
        workerReport: evidence,
        queueReport: evidence,
        cloneFingerprint: z.string().min(8),
      }).strict().parse(req.body);
      res.status(201).json(await service.certificate(req.accessPrincipal!, req.params.id!, body));
    } catch (error) { next(error); }
  });

  router.post('/certifications/:id/seal', async (req, res, next) => {
    try { res.json(await service.seal(req.accessPrincipal!, req.params.id!)); }
    catch (error) { next(error); }
  });

  router.post('/certifications/:id/decision', async (req, res, next) => {
    try {
      const body = z.object({
        decision: z.enum(['APPROVE', 'REJECT']),
        reason: z.string().min(20),
      }).strict().parse(req.body);
      res.json(await service.decide(
        req.accessPrincipal!, req.params.id!, body.decision, body.reason,
      ));
    } catch (error) { next(error); }
  });

  router.get('/certifications/:id', async (req, res, next) => {
    try { res.json(await service.get(req.accessPrincipal!, req.params.id!)); }
    catch (error) { next(error); }
  });

  router.get('/certifications/:id/attempts', async (req, res, next) => {
    try { res.json(await service.attempts(req.accessPrincipal!, req.params.id!)); }
    catch (error) { next(error); }
  });

  return router;
}
