import {
  Router,
  type NextFunction,
  type Request,
  type Response,
} from 'express';
import { z } from 'zod';
import { principalOf } from '../../auth/forensicAuthorization';
import { resolveCorrelationId } from '../../../../lib/http/correlationId';
import { requireUuidRouteParam } from '../../../../lib/http/routeParams';
import { WarehouseForensicError } from '../errors/WarehouseForensicError';
import { WarehouseForensicService } from '../services/warehouseForensicService';

const key = z.string().min(8).max(250);
const sessionSchema = z.object({
  chainId: z.string().uuid(),
  workflowType: z.enum([
    'RECEIVING', 'IDENTITY', 'TESTING', 'PHOTO_STATION', 'PACKING', 'RETURN',
  ]),
  linkType: z.enum(['RECEIVING', 'IDENTITY', 'TESTING', 'PHOTO', 'PACKING', 'RETURN']),
  linkRefs: z.record(z.string(), z.string().uuid().optional()),
  idempotencyKey: key,
  metadata: z.record(z.string(), z.unknown()).optional(),
});
const artifactSchema = z.object({
  artifactId: z.string().uuid(),
  evidenceRole: z.string().min(2).max(100),
  sourceSchema: z.string().max(63).optional(),
  sourceTable: z.string().max(63).optional(),
  sourceRecordId: z.string().max(250).optional(),
  warehouseMediaAssetId: z.string().uuid().optional(),
  sequenceNo: z.number().int().positive().default(1),
  idempotencyKey: key,
  metadata: z.record(z.string(), z.unknown()).optional(),
});
const conditionSchema = z.object({
  itemId: z.string().uuid(),
  inspectionId: z.string().uuid().optional(),
  conditionStage: z.string().min(2).max(64),
  conditionGrade: z.string().max(64).optional(),
  severity: z.enum(['NONE', 'MINOR', 'MODERATE', 'MAJOR', 'CRITICAL']),
  defectCodes: z.array(z.string().max(64)).default([]),
  narrative: z.string().min(3).max(4000),
  artifactLinkIds: z.array(z.string().uuid()).min(1),
  attestedAt: z.string().datetime(),
  idempotencyKey: key,
});
const sealSchema = z.object({
  packingTaskId: z.string().uuid(),
  packageId: z.string().uuid(),
  sealCodeHmac: z.string().min(32).max(256),
  maskedSealCode: z.string().min(3).max(100),
  sealType: z.string().min(2).max(100),
  artifactLinkId: z.string().uuid().optional(),
  occurredAt: z.string().datetime(),
  idempotencyKey: key,
  metadata: z.record(z.string(), z.unknown()).optional(),
});
const packingSchema = z.object({
  packingTaskId: z.string().uuid(),
  packageId: z.string().uuid(),
  itemId: z.string().uuid(),
  packingTaskItemId: z.string().uuid(),
  idempotencyKey: key,
});
const continuitySchema = z.object({
  reason: z.string().min(3).max(500),
  details: z.record(z.string(), z.unknown()).default({}),
  idempotencyKey: key,
});
const supervisorSchema = z.object({
  decisionType: z.enum([
    'CONTINUITY_EXCEPTION',
    'IDENTITY_CONFLICT',
    'MISSING_EVIDENCE',
    'MEASUREMENT_EXCEPTION',
    'PACKING_EXCEPTION',
    'MANUAL_GATE_REVIEW',
  ]),
  decision: z.enum(['APPROVED', 'REJECTED', 'REMEDIATION_REQUIRED']),
  warehouseOverrideId: z.string().uuid().optional(),
  reason: z.string().min(5).max(2000),
  supersedesDecisionId: z.string().uuid().optional(),
  idempotencyKey: key,
});

export function createWarehouseForensicRouter(
  service: WarehouseForensicService,
): Router {
  const router = Router();

  router.post('/sessions', wrap(async (req, res) => {
    const correlationId = resolveCorrelationId(req);
    const data = await service.startSession(
      principalOf(req),
      sessionSchema.parse(req.body),
      correlationId,
    );
    res.status(201).json({ ok: true, data });
  }));

  router.get('/sessions/:sessionId', wrap(async (req, res) => {
    const data = await service.getSession(
      principalOf(req),
      requireUuidRouteParam(req, 'sessionId'),
    );
    res.json({ ok: true, data });
  }));

  router.post('/sessions/:sessionId/artifacts', wrap(async (req, res) => {
    const correlationId = resolveCorrelationId(req);
    const body = artifactSchema.parse(req.body);
    const data = await service.linkArtifact(
      principalOf(req),
      {
        sessionId: requireUuidRouteParam(req, 'sessionId'),
        ...body,
      },
      correlationId,
    );
    res.status(201).json({ ok: true, data });
  }));

  router.post('/sessions/:sessionId/conditions', wrap(async (req, res) => {
    const correlationId = resolveCorrelationId(req);
    const data = await service.recordCondition(
      principalOf(req),
      {
        sessionId: requireUuidRouteParam(req, 'sessionId'),
        ...conditionSchema.parse(req.body),
      },
      correlationId,
    );
    res.status(201).json({ ok: true, data });
  }));

  router.post('/sessions/:sessionId/continuity-exceptions', wrap(async (req, res) => {
    const correlationId = resolveCorrelationId(req);
    const data = await service.setContinuityException(
      principalOf(req),
      {
        sessionId: requireUuidRouteParam(req, 'sessionId'),
        ...continuitySchema.parse(req.body),
      },
      correlationId,
    );
    res.status(201).json({ ok: true, data });
  }));

  router.post('/sessions/:sessionId/tamper-seals', wrap(async (req, res) => {
    const correlationId = resolveCorrelationId(req);
    const data = await service.applySeal(
      principalOf(req),
      {
        sessionId: requireUuidRouteParam(req, 'sessionId'),
        ...sealSchema.parse(req.body),
      },
      correlationId,
    );
    res.status(201).json({ ok: true, data });
  }));

  router.post('/sessions/:sessionId/packing-attestations', wrap(async (req, res) => {
    const correlationId = resolveCorrelationId(req);
    const data = await service.recordPackingAttestation(
      principalOf(req),
      {
        sessionId: requireUuidRouteParam(req, 'sessionId'),
        ...packingSchema.parse(req.body),
      },
      correlationId,
    );
    res.status(201).json({ ok: true, data });
  }));

  router.post('/sessions/:sessionId/supervisor-decisions', wrap(async (req, res) => {
    const correlationId = resolveCorrelationId(req);
    const data = await service.recordSupervisorDecision(
      principalOf(req),
      {
        sessionId: requireUuidRouteParam(req, 'sessionId'),
        ...supervisorSchema.parse(req.body),
      },
      correlationId,
    );
    res.status(201).json({ ok: true, data });
  }));

  router.post('/sessions/:sessionId/evaluate', wrap(async (req, res) => {
    const correlationId = resolveCorrelationId(req);
    const body = z.object({ idempotencyKey: key }).parse(req.body);
    const data = await service.evaluateGate(
      principalOf(req),
      requireUuidRouteParam(req, 'sessionId'),
      body.idempotencyKey,
      correlationId,
    );
    res.status(data.result === 'PASSED' ? 200 : 409).json({
      ok: data.result === 'PASSED',
      data,
    });
  }));

  router.use((
    error: unknown,
    _req: Request,
    res: Response,
    next: NextFunction,
  ): void => {
    if (error instanceof WarehouseForensicError) {
      res.status(error.status).json({
        ok: false,
        error: error.code,
        message: error.message,
        details: error.details,
      });
      return;
    }
    if (error instanceof z.ZodError) {
      res.status(400).json({
        ok: false,
        error: 'VALIDATION_ERROR',
        issues: error.issues,
      });
      return;
    }
    next(error);
  });

  return router;
}

function wrap(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<void>,
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    void handler(req, res, next).catch(next);
  };
}
